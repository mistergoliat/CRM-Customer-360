---
title: ACS-R1-03 Customer 360 Acceptance Audit
doc_id: audit-acs-r1-03-customer-360-acceptance
status: historical
version: "1.0.0"
owner: architecture
audited_at: 2026-07-08
immutable_snapshot: true
source_of_truth_for:
  - ACS-R1-03 acceptance
  - Customer 360 implementation audit
depends_on:
  - docs/releases/ACS-R1-03-customer-360.md
  - docs/architecture/adr/ADR-008-customer-360-boundary.md
  - docs/data/customer-360-contract.md
  - docs/data/customer-address-contract.md
  - docs/data/customer-lifecycle-event-contract.md
tags:
  - audit
  - acceptance
  - customer-360
---

# ACS-R1-03 - Auditoria de aceptacion

Fecha: 2026-07-08. Rama / worktree auditado: `develop` con worktree sucio.

## Veredicto

**Clasificacion:** `accepted_with_debt`.

La implementacion actual de Customer 360 cumple el contrato funcional central: existe un read model consolidado, la identidad sigue siendo provisional, la UI y la API consumen el snapshot y no ensamblan tablas por su cuenta, la degradacion parcial existe, no aparece una tabla monolitica `customer_360`, y no se observa uso de `n8n_*` ni fixtures en el camino nuevo.

La deuda restante no bloqueante es real:

- `ps_orders` sigue consultandose directamente dentro del adapter local, no tras un `OrdersPort` dedicado.
- El timeline no aplica una deduplicacion semantica entre fuentes distintas que describen el mismo hecho.
- El orden del timeline es newest-first, no cronologico ascendente.
- No hay cobertura directa para algunos casos pedidos explicitamente: cliente inexistente, fuente vacia, quotes ausentes, orders no configuradas y timeline deduplicado a nivel de snapshot.
- `lib/brain/commercial/native-cycle/runCatalogCapabilityStage.ts` fue restaurado como compatibilidad de runtime adyacente, pero su procedencia historica no es verificable en este repo.

## 1. Diff exacto

### Archivos creados para ACS-R1-03

- `docs/releases/ACS-R1-03-customer-360.md`
- `docs/architecture/adr/ADR-008-customer-360-boundary.md`
- `docs/capabilities/customer-360-read-model.md`
- `docs/capabilities/customer-addresses.md`
- `docs/data/customer-360-contract.md`
- `docs/data/customer-address-contract.md`
- `docs/data/customer-lifecycle-event-contract.md`
- `lib/domains/customer-360/types.ts`
- `lib/domains/customer-360/assembler.ts`
- `lib/domains/customer-360/ports.ts`
- `lib/domains/customer-360/local-adapter.ts`
- `lib/domains/customer-360/service.ts`
- `lib/domains/customer-360/index.ts`
- `app/api/customers/[id]/360/route.ts`
- `tests/domains/customer360.test.ts`

### Archivos modificados para ACS-R1-03

- `app/(hub)/customers/[id]/page.tsx`
- `docs/product/autonomous-commerce-capability-map.md`
- `docs/product/autonomous-commerce-current-state.md`

### Archivos eliminados

- Ninguno.

### Migraciones

- Ninguna migracion atribuible a ACS-R1-03.
- El worktree contiene una migracion no relacionada `migrations/022_crm_capability_executions.sql`, pero no forma parte del alcance de Customer 360.

### Cambios en runtime

- Nuevo runtime read-model de Customer 360 en `lib/domains/customer-360/*`.
- Nuevo endpoint read-only `GET /api/customers/:customerId/360`.
- La pagina de customer detail pasa a consumir el snapshot consolidado y deja de ensamblar fuentes.
- No se modifica el runtime canónico de ACS-R1-01 desde el camino de Customer 360.

### Cambios en UI

- `app/(hub)/customers/[id]/page.tsx` ahora consume `getCustomer360Snapshot(...)`, muestra identidad provisional, frescura, completitud y secciones consolidadas, y deja de incluir el formulario legacy de alta en esa pantalla.
- El formulario legacy sigue existiendo en la lista de customers, por lo que la funcionalidad de alta no se pierde del producto, solo se saca de la vista read-only.

### Cambios en documentacion

- Se agregaron release, ADR, capabilities y contratos de datos para Customer 360.
- Se actualizo la capability map para reflejar Customer 360 y addresses como capacidades de producto read-only.
- Se actualizo el estado actual del producto para registrar la nueva superficie de Customer 360.

### Cambios no relacionados

El worktree sigue teniendo un conjunto grande de modificaciones previas y no relacionadas con ACS-R1-03, entre ellas:

- `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts`
- `lib/brain/commercial/policy/evaluateCommercialToolRequests.ts`
- `lib/domains/customers/repository.ts`
- `lib/integrations/customer-master/customer-repository.ts`
- `tests/domains/customers.test.ts`
- `scripts/manual-test/README.md`
- varios documentos historicos en `docs/product/*`, `docs/architecture/adr/*` y `docs/verification/*`
- `lib/brain/commercial/capability-gateway/*`
- `lib/catalog/*`
- `tests/catalog/*`
- `tests/native/catalogCapabilityCycle.test.ts`
- `tests/native/catalogConversationFlow.test.ts`

Esos cambios existen en el worktree actual, pero no forman parte del diff funcional de Customer 360 que este audit evalua.

### Por que se restauro `runCatalogCapabilityStage.ts`

`lib/brain/commercial/native-cycle/runCatalogCapabilityStage.ts` no existe en `eada4d9` ni tiene historial rastreable en este repo para ese path. `git show eada4d9:lib/brain/commercial/native-cycle/runCatalogCapabilityStage.ts` falla con "exists on disk, but not in `eada4d9`", y `git log --all -- lib/brain/commercial/native-cycle/runCatalogCapabilityStage.ts` no devuelve commits.

Conclusiones:

- No se puede afirmar que provenga de una version previa versionada en este repositorio.
- No se puede demostrar que sea identico a un archivo de ACS-R1-01 porque no hay base historica local para comparar.
- No se observaron cambios funcionales de Customer 360 dentro de ese archivo; su rol es auxiliar del runtime de catalogo / native cycle.
- Faltaba porque el path no estaba presente en el worktree/HEAD actual, pese a que la pila de runtime adyacente lo esperaba como modulo cargable.
- ACS-R1-03 no depende de el de forma funcional; el path de Customer 360 usa `Customer360QueryService`. El modulo restaurado es una deuda / compatibilidad adyacente del runtime mas amplio.

## 2. Invariantes de arquitectura

### No existe tabla `customer_360`

- No hay migracion nueva para `customer_360`.
- No hay DDL nuevo que introduzca una tabla monolitica en el alcance de ACS-R1-03.
- El ADR de boundary lo prohibe explicitamente: [ADR-008](../architecture/adr/ADR-008-customer-360-boundary.md).

### Customer 360 es read model

- `Customer360Snapshot` se define como contrato de snapshot versionado en [lib/domains/customer-360/types.ts](../../lib/domains/customer-360/types.ts).
- `Customer360QueryService` solo compone y devuelve snapshots; no escribe dominios fuente en [lib/domains/customer-360/service.ts](../../lib/domains/customer-360/service.ts).
- La pagina consume el snapshot y no ensambla tablas por su cuenta en [app/(hub)/customers/[id]/page.tsx](../../app/(hub)/customers/%5Bid%5D/page.tsx).

### No escribe en dominios fuente

- El nuevo servicio no llama a comandos de escritura de `master_customer`, `customer_addresses`, `conversation`, `crm_*` ni `ps_orders`.
- El unico write path visible en la pagina de customer fue eliminado de la vista read-only; el alta sigue en la lista de customers.

### `master_customer` sigue siendo provisional

- La identidad se marca como `provisional` en [lib/domains/customer-360/local-adapter.ts](../../lib/domains/customer-360/local-adapter.ts).
- La UI lo expone como "Identidad provisional" en [app/(hub)/customers/[id]/page.tsx](../../app/(hub)/customers/%5Bid%5D/page.tsx).

### `customer_addresses` queda encapsulado tras `AddressBookPort`

- El contrato esta definido en [lib/domains/customer-360/types.ts](../../lib/domains/customer-360/types.ts).
- El adapter local dedicado esta en [lib/domains/customer-360/local-adapter.ts](../../lib/domains/customer-360/local-adapter.ts).
- La pagina y el route no consultan `customer_addresses` directamente.

### UI y API no consultan repositories individuales directamente

- El route solo autentica y delega al servicio en [app/api/customers/[id]/360/route.ts](../../app/api/customers/%5Bid%5D/360/route.ts).
- La UI solo consume el snapshot en [app/(hub)/customers/[id]/page.tsx](../../app/(hub)/customers/%5Bid%5D/page.tsx).
- La unica capa que consulta tablas directas es el adapter local, que es el boundary permitido.

### No se consulta `n8n_*`

- No hay coincidencias de `n8n_` en `lib/domains/customer-360`.
- El snapshot nuevo no depende de legacy n8n.

### No se utilizan fixtures

- El dominio nuevo usa tablas reales y objetos de prueba construidos en memoria para tests.
- No hay fixtures introducidos para simular Customer 360 productivo.

### No se habilito multi-request

- ACS-R1-03 no agrega flags ni activa el runtime multi-request.
- El path de Customer 360 no depende de `runMultiRequestAutonomousCycle`.

### No se modifico el comportamiento del runtime canonico

- El runtime canonico de WhatsApp sigue entrando por el camino existente; Customer 360 se cuelga como lectura.
- Los cambios de Customer 360 no alteran `processNativeWhatsAppInbound`.
- El worktree tiene drift preexistente en `runNativeAutonomousCycle.ts`, pero no es una mutacion introducida por Customer 360.

## 3. Fuentes reales

| Seccion | Port | Adapter | Tabla / servicio real | Estado ante fallo |
| --- | --- | --- | --- | --- |
| Customer profile | `CustomerProfilePort` | `LocalCustomerProfileAdapter` | `master_customer` | `partial` / `unavailable`; si no existe fila, el snapshot devuelve `null` y el route responde `404 customer_not_found`. |
| External identities | `CustomerProfilePort` | `LocalCustomerProfileAdapter` | `customer_external_identity` | `partial` / `unavailable`; se conserva lo demas. |
| Addresses | `AddressBookPort` | `LocalAddressBookAdapter` | `customer_addresses` | `error` para ID invalido, `unavailable` si la tabla no existe, `error` si la query falla. |
| Conversations | `CustomerProfilePort` | `LocalCustomerProfileAdapter` | `conversation` + `conversation_message` | `partial` / `unavailable`. |
| Opportunities | `CustomerProfilePort` | `LocalCustomerProfileAdapter` | `crm_opportunities` | `partial` / `unavailable`. |
| Need profiles | `CustomerProfilePort` | `LocalCustomerProfileAdapter` | `crm_sales_need_profiles` | `partial` / `unavailable`. |
| Actions | `CustomerProfilePort` | `LocalCustomerProfileAdapter` | `crm_agent_actions` | `partial` / `unavailable`. |
| Outcomes | `CustomerProfilePort` | `LocalCustomerProfileAdapter` | `crm_action_outcomes` | `partial` / `unavailable`. |
| Quotes | `CustomerProfilePort` | `LocalCustomerProfileAdapter` | `crm_quotes` | `partial` / `unavailable`. |
| Orders | No hay port dedicado aun | `LocalCustomerProfileAdapter` | `ps_orders` | `unavailable` / `error`; la lectura sigue aislada en el adapter, pero no tras un `OrdersPort` propio. |
| Lifecycle timeline | `LifecycleEventAssembler` | Assembler en `Customer360QueryService` | Derivado de las secciones del snapshot | `partial` si no hay eventos; `real` si hay eventos; no consulta una tabla fisica propia. |

### Observacion critica sobre orders

`ps_orders` se consulta directamente dentro de `LocalCustomerProfileAdapter` en [lib/domains/customer-360/local-adapter.ts](../../lib/domains/customer-360/local-adapter.ts). Eso cumple una aislacion de adapter a nivel agregado, pero no cumple una portabilidad de fuente tan fina como `CustomerProfilePort` / `AddressBookPort`. Es deuda, no bloqueante, pero debe quedar visible.

## 4. Contrato de degradacion

- **Datos disponibles vacios:** el snapshot puede devolver secciones `real` con `total = 0` e `items = []`.
- **Fuente no configurada:** los loaders devuelven estados `unavailable` con warnings como `customer_addresses_unavailable`, `ps_orders_unavailable` o `..._unavailable`.
- **Fuente no disponible:** el adapter conserva el fallo en `warnings` y marca la seccion `partial` / `unavailable`.
- **Fuente stale:** `freshness.state` pasa a `stale` cuando el ultimo evento queda fuera de la ventana de 7 dias.
- **Error de contrato:** `invalid_customer_id` en addresses o `customer_not_found` / error de query en profile se devuelven de forma explicita.
- **Cliente inexistente:** el profile port devuelve `null` y el route responde `404 customer_not_found`.
- **Conflicto de identidad:** no se inventa un master nuevo; el snapshot mantiene la identidad provisional y el conflicto debe resolverse en la capa de identidad, no dentro del read model.

No se acepta un fallback generico que convierta todos los errores en arrays vacios sin advertencias. Aqui los fallos se exponen con `warnings` y estados de seccion.

## 5. Seguridad

- **Autenticacion del endpoint:** el route de Customer 360 usa `requireOperator` en [app/api/customers/[id]/360/route.ts](../../app/api/customers/%5Bid%5D/360/route.ts).
- **Autorizacion para consultar `customerId`:** la ruta hace auth de operador, no ACL por cliente. El alcance es de operador interno.
- **Aislamiento entre clientes:** el adapter consulta por `customerId` y `customer_addresses` valida el ID numerico; no hay join cruzado sin filtro.
- **Exposicion de RUT, telefono, email y direcciones:** no hay campo RUT en el snapshot. Email, telefono y direcciones si aparecen por diseno operativo en la identidad provisional y en la address book; no hay enmascarado adicional en este read model.
- **Sanitizacion de errores:** los accesos usan `safeQueryRows` y warnings estructurados; las fallas se exponen como warnings / estados de seccion.
- **Ausencia de datos de otro cliente:** el snapshot esta parametrizado por `customerId`; no se observa mezcla deliberada de clientes en el boundary nuevo.
- **ID invalido:** el address port marca `invalid_customer_id`; el route del snapshot responde `404` cuando no hay snapshot para ese customer.

## 6. Timeline

- **IDs estables:** los IDs del timeline se derivan de claves estables (`conversation:...`, `message:...`, `opportunity:...`, `quote:...`, `address:...`, `commercial:...`) en [lib/domains/customer-360/assembler.ts](../../lib/domains/customer-360/assembler.ts).
- **Orden cronologico:** la implementacion actual ordena newest-first con `compareIsoDesc`; no es cronologia ascendente.
- **Deduplicacion:** no existe deduplicacion semantica entre fuentes distintas; hechos equivalentes pueden coexistir si vienen de entidades diferentes.
- **Source explicita:** cada evento lleva `source` y `entityType` / `entityId`.
- **Referencia a entidad original:** cada evento conserva `entityId` y metadata relevante de la entidad origen.
- **Dos fuentes para el mismo hecho:** hoy se preservan ambas perspectivas en lugar de colapsarlas. Esto es trazabilidad, pero deja deuda de dedupe semantico.
- **Limites de cantidad / paginacion:** el snapshot usa limites fijos, no paginacion de timeline: `LIMIT 120` para mensajes y eventos comerciales, `LIMIT 40` para orders, y el assembler no pagina.

## 7. UI

La pagina de detalle de customer ahora:

- consume `getCustomer360Snapshot(...)` en [app/(hub)/customers/[id]/page.tsx](../../app/(hub)/customers/%5Bid%5D/page.tsx);
- no ensambla fuentes por su cuenta;
- no usa fixtures;
- muestra identidad provisional (`title={identity.displayName}` y la seccion de identidad provisional);
- muestra `partial` / `unavailable` via `SurfaceBadge`, `StatusChip` y `metadata`;
- conserva el valor operativo de la vista read-only;
- no pierde funcionalidad necesaria por haber sacado el formulario legacy, porque el alta sigue en la lista de customers.

La pagina muestra claramente la metadata de frescura y completitud en [app/(hub)/customers/[id]/page.tsx](../../app/(hub)/customers/%5Bid%5D/page.tsx) y la seccion de direcciones como conteo separado.

## 8. Capability Matrix

La matriz de capacidad de negocio si quedo alineada, pero con un matiz importante:

- `Project Customer 360` aparece como capacidad de producto read-only e implementada en [docs/product/autonomous-commerce-capability-map.md](../product/autonomous-commerce-capability-map.md).
- `Manage customer addresses` tambien aparece como capacidad de producto, no como tool del agente.
- Customer 360 **no** debe tratarse como capability ejecutable del agente ni como entrada del Capability Gateway.
- En el runtime, las capabilities registradas siguen siendo las del gateway (por ejemplo `search_products` / `get_product_details`); Customer 360 no esta registrada como capability ejecutable por el agente.

Ese encuadre es correcto: Customer 360 es read model de producto, no tool del agente.

## 9. Tests

### Resultado exacto de la suite

- **Comando:** `npm run test`
- **Total:** 739
- **Passed:** 739
- **Failed:** 0
- **Skipped:** 0
- **Duracion:** 27941.2175 ms

### Cobertura especifica observada

- **Snapshot completo:** cubierto en `tests/domains/customer360.test.ts:269`.
- **Cliente inexistente:** no hay test directo especifico en la suite actual para este snapshot.
- **Aislamiento:** cubierto de forma parcial / indirecta por `tests/domains/customerAddresses.test.ts:103` y por los tests de customer repository; no hay un test Customer360 cross-customer dedicado.
- **Fuente caida:** cubierto en `tests/domains/customer360.test.ts:336`.
- **Fuente vacia:** no hay test directo especifico para el snapshot actual.
- **Identidad provisional:** cubierta en `tests/domains/customer360.test.ts:269` y en `lib/domains/customer-360/local-adapter.ts:423-437`.
- **Varias direcciones:** cubierto en `tests/domains/customerAddresses.test.ts:103`.
- **Quotes ausentes:** no hay test directo especifico.
- **Orders no configuradas:** no hay test directo especifico.
- **Timeline deduplicado:** cobertura indirecta en tests del dominio/eventos comerciales y del timeline, pero no un test Customer360 dedicado.
- **Autorizacion del route:** cubierta en `tests/domains/customer360.test.ts:368-382`.

### Evidencia adicional relacionada

- `tests/native/native-whatsapp.test.ts:198` y `tests/native/whatsapp-webhook-auth.test.ts:239` cubren deduplicacion de `CommercialEvent` en el runtime nativo.
- `tests/domains/conversationThread.test.ts:71` cubre dedupe de la proyeccion de timeline de conversaciones.

### Validaciones adicionales

- `npm run typecheck` paso.
- `npm run lint` paso con warnings existentes en el repo, sin errores.

## 10. Bloqueos, deuda y cambios fuera de alcance

### Bloqueos

- Ninguno que obligue a rechazar ACS-R1-03 hoy.

### Deuda no bloqueante

- `ps_orders` no tiene `OrdersPort` propio.
- Falta dedupe semantico del timeline cuando dos fuentes describen el mismo hecho.
- El timeline actual es newest-first, no ascendente.
- Faltan tests directos para cliente inexistente, fuente vacia, quotes ausentes y orders no configuradas.
- La procedencia historica de `runCatalogCapabilityStage.ts` no es verificable localmente.

### Cambios fuera de alcance

- `lib/brain/commercial/native-cycle/runCatalogCapabilityStage.ts` fue restaurado como compatibilidad de runtime adyacente.
- `lib/catalog/httpCatalogAdapter.ts` y el resto del ecosistema de capability gateway / catalog aparecen en el worktree, pero son cambios de runtime adyacente, no del read model Customer 360.

### Regresiones

- No se detecta una regresion funcional de ACS-R1-03 en el camino nuevo.
- El principal riesgo es de trazabilidad / mantenimiento, no de comportamiento roto.

### Proximo paso permitido

- Si se quiere elevar de `accepted_with_debt` a `accepted`, el siguiente paso deberia ser un PR separado para:
  1. encapsular orders tras un port propio o justificar formalmente por que no hace falta;
  2. agregar tests directos de inexistencia, fuentes vacias, orders no configuradas y timeline deduplicado;
  3. definir una politica explicita de dedupe / orden del timeline.
