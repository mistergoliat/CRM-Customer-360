---
title: Master Customer Identity Resolution
doc_id: integration-master-customer-identity-resolution
status: implemented_not_wired
tags:
  - integration
  - identity
  - recommendations
---
# Master Customer Identity Resolution

## Relaciones

- Implementa: `lib/brain/commercial/identity/master-customer/resolveMasterCustomerIdentity.ts`,
  `lib/brain/commercial/identity/master-customer/types.ts`.
- Consume (sin modificar su lógica): `verifyCustomerMasterProjection`
  (`lib/brain/commercial/native-cycle/customer-session/onboardingTransitions.ts`,
  ACS-R1-04-T08.1) - el único puerto de verificación local ya existente,
  reutilizado tal cual, nunca reimplementado.
- Integra (cambio aditivo): `NativeCustomerSessionExecutionContext`
  (`lib/brain/commercial/native-cycle/customer-session/types.ts`) gana un
  campo nuevo `masterCustomerIdentity`; `resolveNativeCustomerSession.ts` lo
  calcula una vez por turno.
- Task: `CP-R1-T10B8A` - see
  `docs/releases/CP-R1-T10B8A-master-customer-identity-resolution.md`.
- Reemplaza: none. No modifica T10B1 (Customer Profile client), T10B2
  (`CustomerRecommendationContext`), T10B5, T10B6, T10B7, Capability Gateway,
  Agent Loop, `recentCatalogContext`, `pendingCatalogAction`.

## Alcance

Resolver interno, determinístico, que traduce la identidad ya resuelta del
turno CRM a un `masterCustomerId` contractual (`master_customer.id`)
**solo** cuando existe evidencia estructural de pertenencia a ese espacio de
ID. No llama Customer Profile, no llama Catalog Service, no resuelve
identidad por email/teléfono/DNI/wa_id. Produce `resolved` o
`identity_unresolved` - nunca un tercer estado ambiguo.

## Espacios de identidad (hallazgo de la auditoría previa)

Se confirmaron **tres espacios de ID distintos** en el runtime, con nombres
peligrosamente similares:

1. `conversation.customer_id` / `customerMasterId` (mayúscula M) - PK local
   del customer del CRM, resuelto por `resolveOrPersistNativeExternalIdentity`
   (wa_id -> customer). Nunca demostrado equivalente a `master_customer.id`.
2. `NativeCustomerSessionExecutionContext.identity.customerId` - identidad
   "de este turno" resuelta por `resolveNativeCustomerSession`. Puede venir
   de 5 fuentes distintas (`identity.source`), y **solo una** de ellas tiene
   proveniencia demostrada hacia `master_customer.id` (ver "Verified
   sources" abajo).
3. `masterCustomerId` (minúscula, el que Customer Profile/T10B5/T10B6/T10B7
   contractualmente esperan) - `master_customer.id`, BIGINT UNSIGNED
   AUTO_INCREMENT, confirmado por `onboardingTransitions.ts`'s propio
   `CUSTOMER_MASTER_ID_PATTERN = /^[1-9]\d*$/`.

Este resolver existe exclusivamente para decidir, con evidencia y sin
adivinar, si el espacio 2 (o un futuro candidato directo de Customer
Service) realmente pertenece al espacio 3.

## Customer Profile contract (heredado, no modificado)

- `masterCustomerId` representa `master_customer.id`.
- Se transporta como string, nunca `Number` (evita pérdida de precisión en
  un BIGINT UNSIGNED de hasta 20 dígitos).
- Máximo 20 dígitos (bound de T10B1/T10B2).
- Customer Profile no crea ni resuelve identidad - exige un
  `masterCustomerId` ya resuelto por el llamador.
- Customer Profile no acepta IDs inferidos - de ahí Caso D (`no puede
  probarse -> identity_unresolved`, nunca un ID probable).
- **La validación de formato (1-20 dígitos) es sintáctica, no semántica**:
  por sí sola nunca demuestra existencia real ni que el valor esté dentro
  del rango real de la columna `BIGINT UNSIGNED` (un valor decimal de 20
  dígitos puede exceder el máximo real de BIGINT). La existencia real en
  `master_customer` y el projection gate (`verifyCustomerMasterProjection`)
  son la verificación final - ninguna vía puede producir `status: "resolved"`
  solo por tener formato válido, sin provenance contractual o proyección
  verificada. No se agrega una comparación numérica local del rango: hacerlo
  exigiría parsear el string como número (reintroduciendo el riesgo de
  coerción/pérdida de precisión que este validador existe para evitar) y
  duplicaría una regla que la propia columna `BIGINT UNSIGNED` de
  `master_customer` ya aplica en la fuente de verdad.
- **Asimetría deliberada entre las 3 vías de evidencia**: el regex propio
  del resolver (`/^[1-9]\d{0,19}$/`, con tope de 20 dígitos) solo se aplica
  en la vía de sesión nativa y en `customerServiceIdentity` cuando el
  llamador ya afirma `verifiedAgainstProjection: true` (ninguna de las dos
  toca la base de datos en ese punto). La tercera vía -
  `customerServiceIdentity` sin `verifiedAgainstProjection` - nunca aplica
  ese tope localmente: reenvía el candidato tal cual al puerto reutilizado
  `verifyCustomerMasterProjection`, que usa su propio regex sin tope de
  longitud y luego consulta `master_customer` de verdad. Un candidato de 21
  dígitos en esa vía específica llega al projection check real - como
  ningún `master_customer.id` real puede tener 21 dígitos, un reader
  correcto siempre responde `not_found` -> `projection_not_confirmed`,
  nunca `invalid_master_customer_id` ni `resolved`.

## Verified sources

Solo dos vías de evidencia se aceptan como "verificado":

### `native_session_verified_projection`

`NativeCustomerSessionExecutionContext.identity.customerId` con
`identity.source === "customer_service"` **y** `identity.status ===
"identified"`. Este es el único valor de `source` donde el propio
`resolveNativeCustomerSession.ts` ya pasó `evidence.result.customerMasterId`
por `completeOnboardingWithVerifiedCustomer` ->
`verifyCustomerMasterProjection` (el gate de proyección local) **antes** de
asignarlo a `identity.customerId` - confirmado leyendo el código fuente
línea por línea, no por similitud de nombres. Por eso este resolver **no
vuelve a consultar la proyección** para esta fuente: ya se verificó una vez,
este mismo turno, aguas arriba.

### `customer_service_verified`

Un candidato `customerServiceIdentity.customerMasterId` crudo (para un
futuro caller directo de Customer Service que no pase por
`resolveNativeCustomerSession`). Formato válido + proyección local
confirmada por este resolver mismo (reutilizando
`verifyCustomerMasterProjection`, la única consulta SQL nueva que esta
tarea puede disparar, como máximo una vez por invocación) -> verificado. Si
el caller ya afirma `verifiedAgainstProjection: true` (verificación hecha
aguas arriba por él), el resolver confía en esa aserción y **no** vuelve a
consultar - pero sí re-valida el formato de forma independiente.

## Unsupported sources

Ninguna de estas cuenta como evidencia de `master_customer.id`, aunque
`identity.status === "identified"`:

- `identity.source === "external_identity"` / `"normalized_phone"` -
  resolución local por teléfono/wa_id (`identityService.resolveIdentity()`),
  sin verificación contra `master_customer`.
- `identity.source === "onboarding_state"` - **riesgo real detectado**:
  `onboarding.customerId` puede haberse fijado por
  `completeOnboardingWithVerifiedCustomer` (verificado) **o** por
  `completeOnboardingWithCustomer` (sin gate, con el ID local de
  `mapLocalResolution`) en un turno previo - el tipo no distingue cuál de
  los dos caminos lo produjo, así que nunca se trata como verificado aquí.
- `identity.source === "customer_created"` - sin verificación demostrada en
  este código.

Cualquier `customerId` con una de estas fuentes produce
`identity_source_unsupported` - nunca `resolved`, sin importar cuán
"identified" luzca `identity.status`.

## Resolution states

Mapeo completo de `identity.status` (cuando no hay proveniencia
verificada):

| `identity.status` | resultado |
|---|---|
| `anonymous` | `identity_unresolved` / `identity_absent` |
| `identification_required` | `identity_unresolved` / `identity_not_verified` |
| `conflict` | `identity_unresolved` / `identity_conflict` (nunca `resolved`, incluso si `customerId` está presente) |
| `temporarily_unavailable` | `identity_unresolved` / `identity_temporarily_unavailable` |
| `identified`, fuente no soportada | `identity_unresolved` / `identity_source_unsupported` |
| `identified`, `customerId` con formato inválido | `identity_unresolved` / `invalid_master_customer_id` |
| `identified`, fuente `customer_service`, formato válido | `resolved` |

## Projection verification

Puerto reutilizado tal cual: `verifyCustomerMasterProjection` +
`CustomerMasterProjectionReader.exists(id): Promise<boolean>`
(`lib/domains/customer-service/customerMasterProjection.ts`, sin
modificar). Respuestas mapeadas:

| `verifyCustomerMasterProjection` | resultado del resolver |
|---|---|
| `verified` | evidencia verificada |
| `invalid` | `invalid_master_customer_id` |
| `not_found` / `inconsistent` | `projection_not_confirmed` |
| `check_failed` | `identity_temporarily_unavailable` (fail-closed, nunca tratado como luz verde) |

La verificación ocurre **como máximo una vez por invocación** del resolver,
y solo para la vía `customerServiceIdentity` sin `verifiedAgainstProjection`
ya afirmado - la vía de sesión nativa nunca dispara una segunda consulta SQL
(ver "Verified sources" arriba).

## Conflict handling

Si ambas fuentes (`nativeCustomerSession` y `customerServiceIdentity`)
están **independientemente verificadas**:

- mismo `masterCustomerId` -> `resolved` (source
  `native_session_verified_projection`);
- distinto `masterCustomerId` -> `identity_unresolved` /
  `identity_conflict` - nunca se elige una por precedencia silenciosa.

Si solo una está verificada, se usa esa - **nunca se comparan valores de un
espacio no demostrado como si fueran equivalentes** al de uno verificado.

## Runtime placement

Calculado **una vez por turno**, dentro de `resolveNativeCustomerSession.ts`,
justo antes de construir el objeto `execution` final - reutilizando el mismo
`identity` ya resuelto y el mismo `projectionReader` de dependencia que ya
existía para el gate de onboarding (nunca una segunda instancia). Expuesto
como `NativeCustomerSessionExecutionContext.masterCustomerIdentity` - un
campo **nuevo y explícito**, nunca un renombre ni una reinterpretación de
`identity.customerId` (que conserva exactamente su semántica anterior).

No conectado todavía a SearchProducts V2, `CustomerRecommendationContext`,
ni a ninguna tool - eso es explícitamente trabajo de tareas posteriores.

## Security

Nunca se registra `masterCustomerId`, `customerId` candidato, email,
teléfono, RUT, wa_id, la respuesta cruda de Customer Service, SQL, ni PII -
este módulo no agrega logging propio (mismo criterio que T10B7: ninguna
capability de este repo loguea directamente). El resultado
`identity_unresolved` es estructuralmente incapaz de portar un ID (la unión
discriminada no tiene ese campo en esa rama) - verificado por test
(`JSON.stringify(result)` nunca contiene el candidato).

## Non-blocking identity resolution

**La resolución de `masterCustomerId` es una mejora de personalización y
contexto, nunca un gate global del bot.** Invariante operativa congelada,
no un detalle de implementación:

- `masterCustomerIdentity.status === "resolved"` -> `masterCustomerId`
  disponible -> personalización identificada permitida (para quien lo
  consuma en el futuro - T10B8A no lo consume todavía en ningún lado).
- `masterCustomerIdentity.status === "identity_unresolved"` (cualquiera de
  sus 7 `reason`) -> `masterCustomerId` se omite -> el turno continúa
  normalmente -> modo genérico -> el bot permanece completamente operativo.

`identity_unresolved` **nunca** produce, ni hoy ni por diseño futuro
previsto: una excepción; un handoff automático; un bloqueo global;
cancelación del Agent Loop; interrupción de la conversación;
indisponibilidad de catálogo, búsqueda o recomendaciones genéricas;
creación automática de cliente; fabricación de un `masterCustomerId`; ni una
clasificación automática como "cliente inexistente". `resolveNativeCustomerSession`
retorna exactamente la misma forma `execution`/`decision`/`warnings` que ya
retornaba antes de esta tarea - `masterCustomerIdentity` es metadata
aditiva, nunca una condición que algún branch existente evalúe.

**`identity_unresolved` y `customer_not_found` son estados distintos, nunca
colapsados:** `identity_unresolved` significa "todavía no identificado
contractualmente" (este resolver simplemente no tiene prueba de un
`master_customer.id` - el cliente perfectamente puede existir); una
determinación real de "el cliente no existe" es una decisión de negocio del
resolver/onboarding canónico (los propios estados `no_match`/
`identification_required` de `resolve_customer`), sujeta a su propia
política y confirmación - este resolver ni la toma ni la implica.

Para capacidades públicas y de catálogo: `identity_unresolved` ->
`customerMode: "generic"` - exactamente el mismo `customerMode: "generic"`
que T10B6/T10B7 ya producen cuando no se provee `masterCustomerId`. Para
acciones privadas o que requieren vinculación a un cliente específico: el
flujo existente de identificación/onboarding (sin modificar por esta tarea)
es lo que eventualmente debe correr, por sus propios méritos, solo cuando
esa acción concreta lo requiera - nunca disparado globalmente por un
`masterCustomerIdentity` no resuelto. Nunca se debe enviar un ID
probable/no verificado a Catalog Service ni a Customer Profile - ese es el
Caso D congelado por esta tarea.

Verificado por `tests/commercial/customerSession.test.ts` (casos de no
bloqueo agregados en el cierre de esta tarea): para cada estado unresolved
alcanzable en runtime, `resolveNativeCustomerSession` retorna sin excepción,
`identity`/`contextAccess`/transiciones de onboarding son idénticos al
comportamiento previo a T10B8A, y `masterCustomerIdentity` es la única
información nueva presente.

## Explicitly out of scope

Llamar Customer Profile, llamar Catalog Service, resolver identidad por
PII (email/teléfono/DNI/wa_id), registrar una tool, modificar el Agent Loop
o su pool de tools, modificar `recentCatalogContext`/`pendingCatalogAction`,
modificar `search_products`/`get_product_details`, modificar Capability
Gateway, modificar T10B1/T10B2/T10B5/T10B6/T10B7, conectar SearchProducts V2.

## Next task

`CP-R1-T10B8B` - Catalog Recommendation Gateway Adapter.
