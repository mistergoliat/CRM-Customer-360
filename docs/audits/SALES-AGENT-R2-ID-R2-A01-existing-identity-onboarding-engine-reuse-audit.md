# SALES-AGENT-R2 / ID-R2-A01 - Existing Identity & Onboarding Engine Reuse Audit

Fecha: 2026-08-24
Repos auditados: `CRM-Customer-360`
Scope: identidad, onboarding, Customer Service authority, Agent Tool Loop y CommercialWork R2.
No incluye implementacion, migraciones ni cambios funcionales.

Baseline leido:

- `AGENTS.md`
- `docs/PRODUCT_NORTH_STAR.md`
- `docs/ACTIVE_RELEASE.md`
- `docs/data/customer-onboarding-identity-contract.md`
- `docs/data/customer-creation-linking-authority-contract.md`
- `docs/releases/ACS-R1-04-customer-identity-onboarding.md`
- Auditoria relacionada: `docs/audits/SALES-AGENT-R2-CP-R2-A01-customer-profile-identity-integration-audit.md`

## Veredicto

`IDENTITY_ENGINE_HYBRID_REUSE`

La decision no es construir un motor nuevo desde cero. La base canonica de ACS-R1-04 ya tiene buenas separaciones:

- resolucion local read-only;
- estado de onboarding versionado y persistido;
- autoridad de create/link delegada a Customer Service;
- Gateway con ejecucion server-side, no expuesta como tool del LLM;
- projection gate contra `master_customer`;
- auditoria durable de outcomes de identidad sobre `commercial_event`.

Pero tampoco esta lista para R2 como "reuse as-is". El resolver conectado solo cubre `wa_id` y telefono normalizado; el resolver rico de `lib/customer-identity/*` vive en un arbol paralelo/legacy; el post-plan onboarding se ejecuta solo en el runtime legacy/Agent Tool Loop; no existe un modelo unificado de evidence; email, orden, PrestaShop, correcciones, niveles explicitos de identidad y omnicanalidad estan incompletos o ausentes.

La estrategia recomendada es evolucion hibrida: reutilizar la espina dorsal canonica de ACS-R1-04 y adaptar o reemplazar las piezas legacy en slices pequenos.

## Root Cause

La causa estructural es una separacion incompleta entre dos preguntas distintas:

1. "Quien es este interlocutor en CRM?" -> `master_customer.id`.
2. "Que identidades externas verificadas posee ese master?" -> `customer_external_identity`, incluyendo futuros links a PrestaShop, WhatsApp, Instagram, Facebook, email verificado u orden validada.

ACS-R1-04 resolvio bien la autoridad de create/link y dejo de fabricar clientes, pero el runtime conectado aun usa una resolucion minima (`wa_id`/telefono) y no ha absorbido el candidate engine historico que sabe mirar email, PrestaShop y ordenes. R2 recibe un contexto reducido de sesion, pero no ejecuta el onboarding post-plan ni tiene un nivel explicito de identidad para decidir requisitos por objetivo.

## Evidencia De Codigo

| Area | Evidencia |
|---|---|
| Resolucion local canonica | `lib/domains/customer-identity/types.ts:1`, `service.ts:41`, `service.ts:75-100` |
| Fuentes telefonicas descartadas | `lib/domains/customer-identity/local-adapter.ts:11-17` |
| Phone lookup cross-provider | `lib/domains/customer-identity/local-adapter.ts:36`, `lib/integrations/customer-external-identity/repository.ts:67-74` |
| `customer_external_identity` | `migrations/010_native_whatsapp_identity_and_conversation_controls.sql:12-25`, `migrations/024_reconcile_unresolved_customer_external_identity.sql:14-19` |
| Onboarding canonico | `migrations/023_crm_customer_onboarding_state.sql:58-101`, `lib/domains/customer-onboarding/service.ts:28-35` |
| Legacy onboarding | `migrations/007_customer_onboarding_links.sql:4-32`, `lib/brain/commercial/customer-onboarding/state.ts:10` |
| Native inbound no inicia onboarding | `lib/brain/native-whatsapp/service.ts:1070-1071` |
| Session resolver | `lib/brain/commercial/native-cycle/customer-session/resolveNativeCustomerSession.ts:148`, `:213`, `:261`, `:268`, `:284` |
| Post-plan onboarding | `lib/brain/commercial/native-cycle/customer-session/runCustomerOnboardingPostPlanStage.ts:114`, `:169-223`, `:258-270` |
| Gateway identity capabilities | `lib/brain/commercial/capability-gateway/customerIdentityCapabilities.ts:67-73`, `:126-129`, `:386` |
| Consent/current message only | `lib/brain/commercial/native-cycle/customer-session/consentEvidence.ts:4-8`, `extractCustomerOnboardingFields.ts:5` |
| Customer Service fail-closed | `lib/integrations/customer-service/http-adapter.ts:22-29`, `:264-282` |
| Projection gate | `lib/brain/commercial/identity/master-customer/resolveMasterCustomerIdentity.ts:64-90`, `:136-150` |
| R2 capabilities actuales | `lib/brain/commercial/work/stepTypes.ts` |
| R2 recibe contexto reducido | `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts:323-430`, `:783-800` |
| Resolver legacy/composite | `lib/customer-identity/resolveCustomerCandidate.ts:42-52`, `:435-445`, `:471` |
| PrestaShop readers legacy | `lib/customer-identity/sourceReaders.ts:221-265`, `:271-338`, `:344-420` |
| Tests de autoridad | `tests/commercial/createCustomerCapability.test.ts:202-308`, `tests/commercial/linkExternalIdentityCapability.test.ts:176-247` |
| Tests de privacy/gates | `tests/commercial/customerSessionCustomer360Gate.test.ts:244-257`, `tests/native/nativeInboundIdentityBoundary.test.ts:106-120` |

## Arquitectura Actual

El runtime moderno esta partido en capas:

```text
WhatsApp inbound
-> processNativeWhatsAppInbound
   -> resolveOrPersistNativeExternalIdentity
      -> customer_external_identity exact/phone/unresolved
   -> conversation/message persistence
-> runNativeAutonomousCycle
   -> resolveNativeCustomerSession
      -> CustomerIdentityResolutionService
      -> CustomerOnboardingService
      -> optional Customer Service resolve_customer
      -> consent parser
      -> Customer360 context gate
      -> master customer projection resolver
   -> selected commercial runtime
      -> CommercialWork R2 / multi-request / Agent Tool Loop / legacy loop
   -> legacy post-plan onboarding stage only
      -> create_customer or link_external_identity through Capability Gateway
```

El `processNativeWhatsAppInbound` ya no crea `master_customer` provisional. Si no existe match, persiste una identidad externa no resuelta (`customer_id = NULL`) y deja el onboarding para `resolveNativeCustomerSession`/`CustomerOnboardingService`.

## Mapa De Identidad Real

### `master_customer.id`

`master_customer.id` representa el identificador canonico local de CRM para el cliente maestro. En los contratos modernos se trata como `customerMasterId`, no como un `customerId` generico. El resolver de master valida formato de BIGINT positivo en string y, cuando viene desde Customer Service, exige que exista fila local en `master_customer` antes de considerar la identidad resuelta.

Garantias observadas:

- Es el id que referencian `customer_external_identity.customer_id` y `crm_customer_onboarding_state.customer_id`.
- Es proyeccion local, no autoridad de escritura.
- ACS no debe insertar ni actualizar `master_customer`; Customer Service es la autoridad.
- `master_customer.id` no equivale a `ps_customer.id_customer`.

### `customer_external_identity`

Tabla de links externos hacia `master_customer`:

- `provider`
- `identity_type`
- `external_id`
- `normalized_value`
- `is_verified`
- `customer_id`, nullable desde migration 024 para identidades observadas aun no vinculadas.

Garantias observadas:

- `UNIQUE(provider, external_id)` evita duplicar el mismo identificador externo exacto.
- `normalized_value` esta indexado, no es unico.
- Un mismo `customer_id` puede tener multiples identidades externas.
- Un `external_id` observado puede existir sin `customer_id`, lo que modela "canal observado, customer no resuelto".

Riesgos:

- No hay constraint de unicidad para un futuro `provider = 'prestashop'` + `id_customer` si no se modela como `external_id` exacto.
- El writer `upsertExternalIdentity` puede actualizar `customer_id` en `ON DUPLICATE KEY UPDATE`; debe quedar bajo autoridad de Customer Service para links verificados.
- No hay historico/supersede de links si un telefono cambia de dueno.

### PrestaShop Customer ID

En el runtime canonico conectado no existe hoy un bridge verificado desde `master_customer.id` hacia `ps_customer.id_customer`.

Hay evidencia de lectores legacy que consultan `ps_customer`, `ps_address` y `ps_orders` por `id_customer`, email, telefono, orden o factura, pero esos readers devuelven candidatos/provisional identity, no un link canonico usable por R2.

Por la auditoria de Customer Profile relacionada, la fuente canonica futura para pasar de `master_customer.id` a `ps_customer.id_customer` debe ser DB-backed en CRM, preferentemente `customer_external_identity` con un provider/identity type explicito para PrestaShop, o un campo/proyeccion local existente si el repo lo demuestra. En este repo, el arbol canonico no demuestra aun un writer activo que cree filas `customer_external_identity` para PrestaShop.

### Diagrama

```text
external channel identity
  provider=whatsapp, external_id=wa_id, normalized_value=phone
  provider=prestashop, external_id=ps_customer.id_customer (futuro/canonico requerido)
        |
        v
customer_external_identity
  unique(provider, external_id)
  customer_id -> master_customer.id
        |
        v
master_customer.id
        |
        v
identity level / bridge result
        |
        +--> CommercialWork R2 identity facts
        +--> Customer Profile only if prestashop id is linked
```

## Dos Subsistemas De Identidad

### A. `lib/domains/customer-identity/*`

| Dimension | Resultado |
|---|---|
| Proposito | Boundary canonico ACS-R1-04 para clasificar inbound WhatsApp contra identidades externas locales. |
| Productores | `customer_external_identity`, native inbound, Customer Service link/create via proyeccion. |
| Consumidores | `resolveNativeCustomerSession`, gates de Customer360, context reducido para runtimes. |
| Tablas | `customer_external_identity`, `master_customer` via FK/proyeccion indirecta. |
| API | `resolveIdentity({ channel, externalId, phoneNumber })`. |
| Ownership | CRM lee; Customer Service gobierna create/link. |
| Runtime | Vivo en native autonomous cycle. |
| Conoce PrestaShop IDs | No de forma conectada. Explicitamente descarta `ps_customer` porque no hay bridge verificado. |
| Dashboard | No es el resolver dashboard historico; sirve al runtime comercial nativo. |
| Sales Agent | Si, antes de los runtimes por `resolveNativeCustomerSession`. |
| Decision | `REUSE_WITH_ADAPTATION`. |

### B. `lib/customer-identity/*`

| Dimension | Resultado |
|---|---|
| Proposito | Resolver compuesto read-only/provisional de era P1J/P1M para recolectar candidatos desde MariaDB, PrestaShop, ordenes, direcciones y n8n. |
| Productores | Lectores `sourceReaders.ts` sobre tablas detectadas; input sintetico del mensaje. |
| Consumidores | Herramientas/evaluaciones legacy; no es el inbound canonico moderno. |
| Tablas | `master_customer`, `ps_customer`, `ps_address`, `ps_orders`, fuentes n8n legacy. |
| API | `resolveCustomerCandidate`, `CustomerSourceObservation`, `sourceMatches`, `writePolicy`. |
| Ownership | Read-only composite; no autoridad de escritura. |
| Runtime | Paralelo/legacy; no usado como boundary canonico de ACS-R1-04. |
| Conoce PrestaShop IDs | Si como candidatos, no como link canonico master->PrestaShop. |
| Dashboard | Es cercano al bridge historico/candidate resolver, pero no al runtime R2. |
| Sales Agent | No conectado al pre-plan/post-plan canonico. |
| Decision | `LEGACY_ONLY` como runtime; `REUSE_WITH_ADAPTATION` como material para un candidate/evidence model nuevo. |

### Fuente Canonica Recomendada

La fuente canonica para identidad operacional debe ser:

```text
Customer Service authority
-> local master_customer projection
-> customer_external_identity links
-> CustomerOnboardingService state
```

No debe ser el resolver legacy tal como esta, porque produce candidatos/provisional keys y aun incluye estados como `created_provisional`. Tampoco debe ser una query directa a `ps_customer` desde Sales Agent. El arbol legacy puede aportar readers y taxonomia de fuentes, pero la autoridad y persistencia deben converger en el modelo ACS-R1-04.

## Flow Actual De WhatsApp

### Inbound

1. `processNativeWhatsAppInbound` recibe `wa_id`, telefono normalizado, mensaje y contexto de proveedor.
2. `resolveOrPersistNativeExternalIdentity` busca `customer_external_identity` por `(provider, external_id)`.
3. Si existe fila con `customer_id`, carga el customer.
4. Si existe fila sin `customer_id`, no la trata como candidato.
5. Si no existe exact match, revisa telefono normalizado por provider en el inbound pre-layer.
6. Si detecta multiples customers, devuelve conflicto.
7. Si no resuelve, persiste/actualiza una identidad externa unresolved con `customer_id = NULL`.
8. Persiste conversacion y mensaje.
9. No inicia ni completa onboarding.

### Pre-plan Session

1. `runNativeAutonomousCycle` llama `resolveNativeCustomerSession` una vez por turno.
2. Se carga la fila actual de `crm_customer_onboarding_state`, si existe.
3. Se ejecuta `CustomerIdentityResolutionService` por `wa_id` exacto y telefono cross-provider.
4. Si hay onboarding activo y localmente no se identifica, puede llamar `resolve_customer` de Customer Service con `channel`, `externalId`, `phoneNumber` y email recolectado.
5. Parseo de consentimiento ocurre sobre el mensaje actual.
6. Se calcula `contextAccess`.
7. Se resuelve `masterCustomerIdentity`.
8. Se entrega a los runtimes un `CustomerSessionDecisionContext` minimizado, sin PII ni candidates crudos.

### Post-plan

`runCustomerOnboardingPostPlanStage` solo corre despues del planner legacy/Agent Tool Loop, no como paso de CommercialWork R2. Puede:

- activar onboarding si una operacion estructurada lo requiere;
- capturar campos deterministas del mensaje actual;
- ejecutar `create_customer` si hay no_match fresco y consentimiento actual;
- ejecutar `link_external_identity` si hay identidad resuelta y consentimiento actual.

## Estado Actual Roto Para R2

CommercialWork R2 recibe `customerSession` reducido, pero sus step types/capabilities son producto, shipping y quote. No existen steps de identidad ni post-plan onboarding dentro de R2.

Resultado:

- R2 puede saber que hay `identity.status`, `pendingFields` y `contextAccess`.
- R2 no inicia onboarding de forma canonica.
- R2 no ejecuta create/link.
- R2 no puede elevar identidad de `master_customer.id` a PrestaShop id para Customer Profile.
- R2 no persiste evidence propia de identity facts dentro de `CommercialWork`.

## State Machine De Onboarding

La tabla canonica es `crm_customer_onboarding_state`.

Campos relevantes:

- `conversation_id`, unico.
- `opportunity_id`, nullable.
- `status`.
- `purpose`.
- `collected_json`.
- `pending_json`.
- `customer_id`.
- `failed_verification_attempts`.
- `version`.
- timestamps.

Estados persistidos observados:

- `required`
- `collecting`
- `resolving`
- `completed`
- `conflict`
- `temporarily_blocked`
- `temporarily_unavailable`

Ausencia de fila equivale a `not_required`; no se persiste `not_required`.

Transiciones observadas:

- `collectFields`: `required|collecting|conflict -> collecting`
- `markResolving`: `required|collecting -> resolving`
- `completeOnboarding`: `resolving -> completed`
- `markConflict`: `resolving -> conflict`
- `markTemporarilyUnavailable`: `resolving -> temporarily_unavailable`
- `retryResolution`: `temporarily_unavailable -> resolving`
- `recordVerificationFailure`: desde `resolving`, bloquea al tercer intento.

Fortalezas:

- Version optimistic locking.
- One-row-per-conversation.
- Campo `purpose`.
- No `saveAnyState`.
- FK a `master_customer` con `ON DELETE RESTRICT`.

Gaps:

- Sin TTL/cancelacion/handoff.
- Sin history append-only.
- Correcciones sobreescriben `collected_json`.
- No evidence normalizada por campo.
- `conflict -> collecting` existe para capturar campos, pero requiere reglas mas explicitas para resolucion de conflicto futura.

Decision: `REUSE_WITH_ADAPTATION`.

## Candidate Resolution

### Conectado Hoy

El resolver vivo decide:

- `wa_id` exacto por `provider + external_id`.
- telefono normalizado contra `customer_external_identity.normalized_value` cross-provider.
- exact match + telefono coherente -> `identified`.
- exact match + telefono contradictorio -> `conflict`.
- un phone candidate -> `identified`.
- multiples phone candidates -> `conflict`.
- nada -> `identification_required`.
- input invalido -> `invalid_input`.
- fallo tecnico -> `temporarily_unavailable`.

No usa:

- email;
- orden/factura;
- `ps_customer`;
- `ps_address`;
- nombre;
- direccion;
- heuristicas LLM.

### Legacy Composite

`lib/customer-identity/sourceReaders.ts` sabe leer:

- `master_customer` por id/email;
- `ps_customer` por `id_customer`/email;
- `ps_address` por `id_customer`/telefono;
- `ps_orders` por `id_customer`/orden/factura/email;
- tablas n8n legacy.

`resolveCustomerCandidate.ts` rankea observaciones, detecta conflictos y puede devolver estados como `resolved_existing`, `linked_identity`, `created_provisional` o `skipped_read_only`. Esto lo hace util como evidencia forense y diseno de candidate model, pero riesgoso como motor canonico actual.

Decision:

- Reutilizar el vocabulario de observaciones/fuentes con adaptacion.
- No reutilizar el runtime legacy tal cual.
- No permitir `created_provisional` en R2.

## Email Semantics

El contrato dice que email puede ser una senal fuerte, pero no prueba posesion por si solo. El codigo conectado captura email para onboarding y lo envia a Customer Service durante `resolve_customer` si hay onboarding activo.

El runtime canonico no hace lookup local por email. El arbol legacy si tiene `lookupCustomerByEmail` y readers por email, y los fixtures locales de `ps_customer` incluyen `UNIQUE KEY uq_ps_customer_email`, pero este repo no demuestra por si solo que el PrestaShop productivo tenga esa garantia activa ni que ese email este verificado por el canal actual.

Semantica recomendada:

- Email declarado: candidate evidence, no ownership proof.
- Email exacto unico: `NEEDS_VERIFICATION` o `RESOLVED_CANDIDATE`, no `VERIFIED_FOR_SENSITIVE_ACTION`.
- Email + control de WhatsApp ya vinculado al mismo master: puede reforzar confianza.
- Email contradice `wa_id` resuelto: `IDENTITY_CONFLICT`.
- Email multiple en mensaje: `AMBIGUOUS`.
- Cambio de email principal: requiere verificacion reforzada u operador.

## Phone Y Multiples Numeros

El modelo soporta multiples identidades externas por `customer_id`. El telefono aparece como `normalized_value`, no como columna canonica de `master_customer`.

Comportamiento actual:

- `provider + external_id` exacto es unico.
- `normalized_value` no es unico.
- El servicio canonico detecta multiples masters para un mismo telefono normalizado y devuelve conflicto.
- La capa inbound pre-session usa lookup por provider para telefono; el resolver canonico usa cross-provider.

Recomendacion:

- Mantener `normalized_value` no unico para permitir historial y multi-canal.
- Usar conflict si un telefono apunta a mas de un master.
- Distinguir telefono observado, telefono verificado y telefono controlado en este turno.
- No mover ownership de un telefono automaticamente; link/relink requiere Customer Service y consentimiento.
- Agregar historico de supersede/revocation en un slice futuro, no dentro de esta auditoria.

## Address Semantics

La identidad canonica conectada no debe usar direcciones de despacho como prueba de identidad. El adapter moderno lo dice explicitamente: `customer_addresses.recipient_phone` es contacto de despacho, no identidad verificada del titular.

El legacy composite lee `ps_address` como candidate source. Eso puede servir para sugerir candidatos o enriquecer evidencia, pero no como fuente canonica de ownership.

Regla recomendada:

- Direccion/telefono de direccion: `DERIVED_CANDIDATE`, no `VERIFIED_IDENTITY`.
- Shipping address pertenece al dominio de despacho/cotizacion, no al identity bridge.
- Direccion puede levantar conflicto si contradice un master resuelto, pero no resolver por si sola.

## Order Evidence

El contrato exige orden/reclamo/garantia/devolucion con referencia de entidad. El extractor moderno puede capturar `orderReference`, y `contextAccess` declara que `validated_entity` nunca se concede en T06 porque no existe validacion de ownership de entidad.

Actualmente:

- `orderReference` se guarda en `collected_json`.
- No se pasa a `CustomerService.resolveCustomer`.
- No hay validator canonico que pruebe que la orden pertenece al interlocutor.
- Hay capacidades legacy/read de orden (`ps_orders`) y readers legacy, pero no estan integradas al identity/onboarding canonico.

Recomendacion:

- Orden/factura debe ser evidencia transaccional fuerte si se valida contra ownership.
- Sin ownership validator, solo es dato recolectado.
- Para "que paso con mi pedido", el objetivo puede requerir `LEVEL_4_VERIFIED_FOR_SENSITIVE_ACTION`.
- Nunca crear customer para justificar una orden historica no encontrada.

## Evidence Model

### Existente

No hay un `IdentityEvidence` central. Hay piezas parciales:

- `CustomerResolutionEvidence` para Customer Service, fresco y usado en create.
- `freshExternalResolutionEvidence` en sesion, de vida del turno.
- `commercial_event` para audit events de identidad/onboarding.
- summaries redactados en `crm_capability_executions`.
- `CustomerSourceObservation` legacy con source/table/matchedBy/confidence.

### Faltante

Falta un contrato durable que represente:

```ts
type IdentityEvidence = {
  evidenceId: string;
  conversationId: string;
  masterCustomerId: string | null;
  source: "customer_external_identity" | "customer_service" | "prestashop" | "order" | "email" | "phone" | "manual";
  sourceRecordRef: string | null;
  signalType: "wa_id" | "phone" | "email" | "prestashop_customer_id" | "order_reference" | "manual_assertion";
  signalValueRedacted: string | null;
  strength: "observed" | "candidate" | "strong" | "verified" | "conflict";
  observedAt: string;
  verifiedAt: string | null;
  supersededAt: string | null;
  freshness: "current_turn" | "persisted_current" | "historical" | "stale";
};
```

No se debe persistir payloads completos ni PII innecesaria. Para R2 basta con facts normalizados y referencias de fuente.

Decision: `MISSING`.

## Conflict Model

### Cubierto Hoy

- `wa_id` vs telefono diferente.
- telefono ambiguo.
- conversacion existente con customer distinto al resuelto.
- onboarding completado con otro customer.
- conflicto devuelto por Customer Service.
- Customer Service success contra proyeccion local ausente/inconsistente.

### No Cubierto Canonicalmente

- email apunta a A y telefono/wa_id a B.
- orden/factura apunta a A y email a B.
- dos `ps_customer` candidates para el mismo email/telefono.
- mismo PrestaShop id vinculado a dos masters.
- master con multiples PrestaShop links activos.
- correccion de email/nombre/orden durante onboarding.
- transfer/revocation de telefono.
- merge de masters.

Outcomes recomendados:

- `RESOLVED`
- `NOT_FOUND`
- `AMBIGUOUS`
- `NEEDS_VERIFICATION`
- `IDENTITY_CONFLICT`
- `SYSTEM_FAILURE`

Regla: conflicto no se resuelve con LLM y no debe degradar a `WAITING_CUSTOMER` salvo que falte informacion que el cliente pueda entregar legitimamente.

## Authority Model

El contrato de autoridad es reutilizable:

- LLM puede proponer, no decidir.
- Capability policy valida.
- Customer Service crea/vincula.
- ACS no escribe `master_customer`.
- ACS no escribe PrestaShop.
- Customer Service timeout no equivale a `no_match`.
- `create_customer != link_external_identity`.

En codigo:

- `resolve_customer` es read-only y server-invoked.
- `create_customer` y `link_external_identity` ignoran inputs sensibles del LLM y usan `trustedCustomerSession`.
- Las tres capabilities estan registradas en Gateway, pero no expuestas como aliases del LLM.
- Idempotency key se deriva de `correlationId`, no de input del modelo.

Decision: `REUSE_AS_IS` para la regla de autoridad; `REUSE_WITH_ADAPTATION` para ampliar fuentes/canales.

## Create Customer

Semantica actual correcta:

- Solo para propositos permitidos: quote/purchase/checkout/account request.
- Requiere onboarding activo.
- Requiere datos minimos.
- Requiere `resolve_customer = no_match` fresco.
- Requiere consentimiento explicito del turno actual.
- Requiere Customer Service disponible.
- No vincula automaticamente WhatsApp.
- No crea cuenta login PrestaShop.
- Si Customer Service responde `matched_existing`, se trata como carrera/deduplicacion valida.
- Antes de completar onboarding, se verifica `master_customer` local.

Gaps:

- R2 no invoca este post-plan.
- No hay interfaz explicita de objective/step en CommercialWork.
- No hay evidence model reusable para explicar por que create fue autorizado.

Decision: `REUSE_WITH_ADAPTATION`.

## Link External Identity

Semantica actual correcta:

- Requiere `identity.customerId` resuelto.
- Requiere control del `wa_id` del inbound actual.
- Requiere consentimiento explicito del turno actual.
- Requiere Customer Service.
- Projection gate antes de completar onboarding.
- Conflicto aterriza onboarding en `conflict`.

Gaps:

- Canal tipado como WhatsApp.
- No cubre Instagram/Facebook/email/PrestaShop como identity providers.
- El pre-layer nativo aun tiene writer local de identity rows para unresolved y algunos links no verificados; hay que asegurar que ningun link verificado salte la autoridad de Customer Service.

Decision: `REUSE_WITH_ADAPTATION`.

## Persistence

Persistencia utilizable:

- `customer_external_identity`: observed/linked external identities.
- `crm_customer_onboarding_state`: estado operacional multi-turn.
- `commercial_event`: audit trail descriptivo de identidad/onboarding.
- `crm_capability_executions`: summaries redactados de Gateway.

Persistencia legacy que debe quedar fuera:

- `crm_customer_onboarding`: usa `conversation_case_id`, estado incompatible, PII plana y payloads arbitrarios.
- `customer_conversation_link`: legacy P1M; no debe ser autoridad R2.
- `lib/brain/commercial/customer-onboarding/*`: email-first legacy orchestrator.

Persistencia faltante:

- evidence durable normalizada por senal.
- correction/supersede.
- identity level snapshot por CommercialWork.
- bridge verificado `master_customer.id -> ps_customer.id_customer`.

## Cross-turn, Restart Y Reprojection

Lo que ya sobrevive restart:

- onboarding state por `conversation_id`;
- collected fields;
- pending fields;
- status/version;
- customer_id completado;
- retries desde `temporarily_unavailable`;
- audit events sobre `commercial_event`.

Lo que no sobrevive como contrato fuerte:

- fresh `no_match` evidence, porque es deliberadamente del turno actual;
- candidate sets completos;
- historial de cambios de campos;
- motivo field-level de cada resolucion;
- bridge PrestaShop;
- identity level calculado.

Recomendacion:

- Mantener fresh evidence para autorizacion de create.
- Agregar evidence durable para auditoria y reprojection, sin reutilizar evidence fresco como permiso de mutacion.

## Corrections

Hoy `collectFields` normaliza email y mergea patches dentro de `collected_json`. Si el cliente corrige su email o nombre, el valor anterior se pierde en la fila canonica; puede quedar rastro indirecto en eventos, pero no como modelo auditable de correccion.

Recomendacion:

- Distinguir `current_value` de `historical_observation`.
- Registrar `superseded_by` o `replaced_at`.
- Si una correccion contradice una evidencia verificada, pasar a `NEEDS_VERIFICATION` o `IDENTITY_CONFLICT`.
- No bloquear una venta simple por correccion de email si la operacion no requiere identidad.

Decision: `MISSING`.

## Omnichannel Readiness

El schema de `customer_external_identity` esta cerca de ser omnicanal: `provider`, `identity_type`, `external_id`, `normalized_value`.

El runtime no esta listo:

- `ResolveCustomerIdentityInput.channel` es `"whatsapp"`.
- `CustomerServiceChannel` esta tipado a WhatsApp.
- Consent parser mira texto del inbound WhatsApp.
- Trusted inbound model asume `wa_id`.
- Native inbound es WhatsApp.

Recomendacion:

- Reusar tabla y patrones.
- Expandir contratos de canal en un slice posterior.
- Mantener links por provider exacto.
- No reutilizar WhatsApp consent semantics para Instagram/Facebook sin revisar evidencia de control del canal.

Decision: `REUSE_WITH_ADAPTATION`.

## Identity Levels

El sistema hoy expresa estados (`anonymous`, `identification_required`, `identified`, `conflict`, `temporarily_unavailable`) y `contextAccess`, pero no niveles canonicos de identidad.

Se recomienda introducir estos niveles conceptuales:

| Nivel | Significado | Fuente minima |
|---|---|---|
| `LEVEL_0_ANONYMOUS` | No hay identidad persistida confiable. | Sin row o row unresolved. |
| `LEVEL_1_CHANNEL_OBSERVED` | Canal visto, no vinculado. | `customer_external_identity.customer_id = NULL`. |
| `LEVEL_2_MASTER_RESOLVED` | Interlocutor vinculado a `master_customer.id`. | external identity/phone/Customer Service + proyeccion. |
| `LEVEL_3_PRESTASHOP_LINKED` | Master tiene PrestaShop id verificado. | link externo/proyeccion canonica. |
| `LEVEL_4_VERIFIED_FOR_SENSITIVE_ACTION` | Operacion sensible validada para entidad especifica. | orden/email/canal verificados segun objetivo. |

Estos niveles deben guiar CommercialWork sin exponer PII al LLM.

## Operation Requirements

| Operacion | Nivel requerido | Onboarding |
|---|---:|---|
| Ver catalogo / preguntar precio publico | 0 | No requerido. |
| Recomendar producto por necesidad declarada | 0-1 | No requerido. |
| Estimar despacho con comuna/direccion | 0-1 | No identity; si address persistente, requiere consentimiento/contexto. |
| Crear cotizacion formal | 2 | Requiere onboarding si no hay master. |
| Comprar / checkout asistido | 2 | Requiere onboarding si no hay master. |
| Recompra / "lo mismo de antes" | 3 | Requiere PrestaShop link o historial disponible. |
| RFM / Customer Profile | 3 | Enrichment, no bloqueante salvo objetivo historico. |
| Estado de pedido | 4 | Requiere orden + ownership validation. |
| Reclamo/garantia/devolucion | 4 | Requiere entidad validada. |
| Vincular nuevo canal | 2 + control del canal actual | Requiere consentimiento. |
| Crear master | 1 + no_match fresco + consentimiento | Solo propositos permitidos. |

## Customer Profile Relationship

Customer Profile no debe ser parte del identity engine. Debe consumir identidad ya resuelta.

Regla para R2:

```text
CommercialWork conoce master_customer.id
-> Identity Bridge resuelve prestashop_customer_id canonico
-> Customer Profile se consulta con ps_customer.id_customer
```

Si no hay `prestashop_customer_id`:

- estado business: `NOT_LINKED` / `NO_PROFILE_AVAILABLE`;
- no consultar Customer Profile con `master_customer.id`;
- venta simple continua;
- objetivo historico pide alternativa: solicitar dato verificable o derivar.

Este bridge queda fuera de ID-R2-A01, pero depende directamente del modelo de identity levels propuesto.

## Gateway Vs Context Loader

Para identidad/onboarding R2:

- Create/link/resolve externo deben seguir por Gateway y persistir execution/evidence.
- Pre-plan local identity puede seguir como context/facts de sesion, pero debe emitir evidence durable minima.
- Los datos sensibles no deben entrar completos al prompt.
- CommercialWork debe recibir facts estructurados, no texto oculto.
- Customer Profile comercial debe entrar por Gateway/read model auditable, no por loader silencioso hacia prompt.

## Runtime Coverage

| Operacion / pieza | CommercialWork R2 | Multi-request | Agent Tool Loop | Legacy operational/sales-consultative |
|---|---|---|---|---|
| Pre-plan `resolveNativeCustomerSession` | Parcial: recibe snapshot reducido | Parcial: recibe snapshot reducido | Si | Si |
| Local wa/phone identity | Si upstream | Si upstream | Si | Si |
| Onboarding activation post-plan | No | No | Si en legacy grounded loop | Si |
| Field capture | No directo | No directo | Si post-plan | Legacy email-first tambien |
| `resolve_customer` Customer Service | Solo si onboarding activo upstream | Solo si onboarding activo upstream | Si | Si |
| `create_customer` | No step R2 | No | Si post-plan | Legacy path separado |
| `link_external_identity` | No step R2 | No | Si post-plan | Legacy path separado |
| Customer360 context gate | Si upstream | Si upstream | Si | Si |
| Identity audit events | Si upstream para session | Si upstream para session | Si | Si |
| `crm_customer_onboarding` legacy | No deberia | No deberia | No canonico | Legacy only |
| `lib/customer-identity/*` composite | No | No | No canonico | Legacy/tooling |
| Customer Profile bridge | No | No | Loader puntual en otro bloque, no canonico | No |

## Component Reuse Matrix

| Componente | Decision | Motivo |
|---|---|---|
| `lib/domains/customer-identity/service.ts` | `REUSE_WITH_ADAPTATION` | Buena clasificacion wa/phone; faltan email, orden, PrestaShop y omnichannel. |
| `lib/domains/customer-identity/local-adapter.ts` | `REUSE_WITH_ADAPTATION` | Descarta fuentes inseguras correctamente; necesita semantica verified/unverified mas explicita. |
| `customer_external_identity` | `REUSE_WITH_ADAPTATION` | Buen modelo base de links externos; faltan constraints/historia para PrestaShop y revocation. |
| `lib/domains/customer-onboarding/*` | `REUSE_WITH_ADAPTATION` | State machine y optimistic locking utiles; faltan TTL, correction history y evidence. |
| `crm_customer_onboarding_state` | `REUSE_WITH_ADAPTATION` | Tabla canonica reutilizable; no ampliar como dataset arbitrario. |
| `onboardingTransitions.ts` projection gate | `REUSE_AS_IS` | Fail-closed correcto contra `master_customer`. |
| `resolveNativeCustomerSession.ts` | `REUSE_WITH_ADAPTATION` | Boundary pre-plan correcto; necesita candidate/evidence model extendido. |
| `runCustomerOnboardingPostPlanStage.ts` | `REUSE_WITH_ADAPTATION` | Politica create/link valiosa; debe conectarse a R2 con objectives/steps. |
| `extractCustomerOnboardingFields.ts` | `REUSE_WITH_ADAPTATION` | Determinista/current-turn; ampliar con validators y correction semantics. |
| `consentEvidence.ts` | `REUSE_AS_IS` para WhatsApp | Conservador y current-turn; no portar sin cambios a otros canales. |
| `customerIdentityCapabilities.ts` | `REUSE_WITH_ADAPTATION` | Autoridad server-side correcta; ampliar canales/evidence. |
| `toolAliases.ts` exclusion de identity tools | `REUSE_AS_IS` | Evita que LLM ejecute mutaciones sensibles. |
| `lib/domains/customer-service/*` | `REUSE_AS_IS` | Contrato y policy correctos para create/link/resolve. |
| `http-adapter.ts` Customer Service | `REUSE_AS_IS` | Fail-closed y timeout correctos; operacion real bloqueada por servicio no desplegado. |
| `resolveMasterCustomerIdentity.ts` | `REUSE_WITH_ADAPTATION` | Buen gate conceptual; demasiado estrecho para sources locales verificadas/R2. |
| `lib/customer-identity/sourceReaders.ts` | `REUSE_WITH_ADAPTATION` | Readers utiles como evidencia candidata; no autoridad. |
| `lib/customer-identity/resolveCustomerCandidate.ts` | `LEGACY_ONLY` | Read-only/provisional con estados no aptos para R2. |
| `lib/brain/commercial/customer-onboarding/*` | `LEGACY_ONLY` | Email-first, tabla legacy, mensajes/context arbitrario. |
| `crm_customer_onboarding` | `LEGACY_ONLY` | Incompatible con contrato canonico. |
| `customer_conversation_link` | `LEGACY_ONLY` | No debe gobernar R2. |
| `record_customer_interest` | `MISSING` | Existe policy conceptual, no esta conectado/persistido. |
| Unified `IdentityEvidence` | `MISSING` | Necesario para auditabilidad R2. |
| Order ownership validator | `MISSING` | Necesario para postventa/garantia/estado de pedido. |
| Email conflict resolver canonico | `MISSING` | Solo vive en legacy o Customer Service externo. |
| PrestaShop identity bridge | `MISSING` | Requerido para Customer Profile. |
| R2 onboarding steps/objectives | `MISSING` | CommercialWork no ejecuta identity capabilities. |

## Legacy Que Debe Quedar Fuera

No portar automaticamente:

- `crm_customer_onboarding`.
- `customer_conversation_link`.
- `lib/brain/commercial/customer-onboarding/*`.
- Estados `created_provisional`.
- Lookup email-first que revele existencia de cuenta al cliente.
- Queries directas a `ps_customer` como autoridad.
- `ps_address` como prueba de identidad.
- Cualquier writer local que cree o relinkee `master_customer`.

El arbol `lib/customer-identity/*` puede servir para extraer readers y tipos de observacion, pero debe converger hacia el boundary canonico, no revivir como tercer sistema.

## Privacy Y Data Minimization

Datos que el sistema toca:

- `wa_id` / telefono.
- email.
- nombre/apellido.
- order reference.
- candidate customer ids.
- Customer Service outcomes.
- source matches legacy.

Reglas:

- No meter candidate lists crudas al prompt.
- No persistir mensajes completos dentro de onboarding state.
- No revelar si un email existe.
- No persistir payloads completos de Customer Service si basta con outcome + source ref.
- Redactar telefono/email en `crm_capability_executions`.
- Exponer a R2 solo identity level, required fields, status, business outcome y references auditables.

## Failure Semantics

| Caso | Semantica | Retry |
|---|---|---|
| Sin link externo | Business state: `NOT_LINKED` / `identification_required`. | No retry infinito. |
| Input invalido | `invalid_input`. | Pedir dato corregido si aplica. |
| Phone ambiguo | `IDENTITY_CONFLICT`. | No auto-seleccionar. |
| Email contradice WhatsApp | `IDENTITY_CONFLICT`. | Verificacion/handoff. |
| Customer Service timeout | `temporarily_unavailable`. | Retry system-owned. |
| Customer Service no configurado | `temporarily_unavailable`, fail-closed. | Operacional, no customer wait salvo objetivo bloqueado. |
| Projection missing tras success | `temporarily_unavailable`. | Retry/reprojection. |
| Orden no validada | `NEEDS_VERIFICATION`. | Pedir referencia adicional o handoff. |
| Customer Profile sin link PS | `NO_PROFILE_AVAILABLE` / `NOT_LINKED`. | No llamar CP con master id. |
| CP caido | System-owned retryable; venta simple sigue. | Si objetivo historico, explicar indisponibilidad. |

Regla: technical/system-owned failure no debe convertirse en `WAITING_CUSTOMER`, excepto cuando falta informacion que el cliente si puede entregar.

## Tests Existentes

Inventario relevante:

- `tests/domains/customerIdentity.test.ts`
- `tests/domains/customerOnboarding.test.ts`
- `tests/domains/customerService.test.ts`
- `tests/integrations/customerServiceHttpAdapter.test.ts`
- `tests/commercial/customerSession.test.ts`
- `tests/commercial/customerSessionCustomer360Gate.test.ts`
- `tests/commercial/customerSessionPrivacy.test.ts`
- `tests/commercial/customerOnboardingPostPlanStage.test.ts`
- `tests/commercial/customerOnboardingPostPlanRuntime.test.ts`
- `tests/commercial/customerOnboardingPostPlanPrivacy.test.ts`
- `tests/commercial/extractCustomerOnboardingFields.test.ts`
- `tests/commercial/createCustomerCapability.test.ts`
- `tests/commercial/linkExternalIdentityCapability.test.ts`
- `tests/commercial/customerIdentityCapabilityGateway.test.ts`
- `tests/commercial/customerIdentityAuditEvents.test.ts`
- `tests/commercial/identityCapabilityGatewaySummaries.test.ts`
- `tests/commercial/customerMasterProjectionGate.test.ts`
- `tests/e2e/customerIdentityOnboarding.e2e.test.ts`
- `tests/identity/master-customer/resolveMasterCustomerIdentity.test.ts`
- `tests/native/identity-conflict.test.ts`
- `tests/native/nativeInboundIdentityBoundary.test.ts`

Cobertura fuerte:

- create/link no usan input sensible del LLM.
- no_match fresco requerido para create.
- consentimiento actual requerido.
- Customer Service unavailable no muta.
- projection gate impide completar onboarding sin `master_customer`.
- identity conflict no autoriza Customer360.
- inbound plano no ejecuta create/link.

Gaps de test:

- email vs phone conflict en runtime canonico.
- order reference ownership validation.
- PrestaShop link level.
- corrections/supersede.
- R2 identity step/objective integration.
- no duplicated legacy identity adapters.
- omnichannel provider expansion.

## Test Matrix Propuesta

| ID | Caso | Resultado esperado |
|---|---|---|
| ID01 | WhatsApp exacto vinculado a master | `LEVEL_2_MASTER_RESOLVED`. |
| ID02 | WhatsApp observado sin `customer_id` | `LEVEL_1_CHANNEL_OBSERVED`, onboarding si objetivo lo requiere. |
| ID03 | Telefono apunta a un solo master cross-provider | `RESOLVED`, source phone strong. |
| ID04 | Telefono apunta a multiples masters | `AMBIGUOUS`/`IDENTITY_CONFLICT`, sin Customer360. |
| ID05 | `wa_id` apunta A y telefono apunta B | `IDENTITY_CONFLICT`. |
| ID06 | Email unico declarado sin canal vinculado | candidate only, no ownership proof. |
| ID07 | Email A contradice `wa_id` B | `IDENTITY_CONFLICT`, no create. |
| ID08 | Dos emails en un mensaje | `AMBIGUOUS`, pedir aclaracion. |
| ID09 | Order reference capturada | Persistida como collected, no `validated_entity` sin validator. |
| ID10 | Order reference validada contra master | `LEVEL_4_VERIFIED_FOR_SENSITIVE_ACTION`. |
| ID11 | Customer Service caido | `temporarily_unavailable`, no `no_match`. |
| ID12 | Customer Service created, projection missing | onboarding `temporarily_unavailable`. |
| ID13 | Retry posterior con projection disponible | onboarding `completed`. |
| ID14 | create_customer sin consentimiento actual | denied, no HTTP mutation. |
| ID15 | link_external_identity con input LLM malicioso | ignora input, usa trusted session. |
| ID16 | Cliente corrige email | evidence anterior superseded, current updated. |
| ID17 | Master con PrestaShop link | `LEVEL_3_PRESTASHOP_LINKED`, bridge devuelve ps id. |
| ID18 | Master sin PrestaShop link | `NOT_LINKED`, no llamar Customer Profile. |
| ID19 | CommercialWork simple purchase sin profile | venta continua. |
| ID20 | CommercialWork "que compre antes" | requiere history/profile o responde no disponible. |
| ID21 | No se importa `lib/brain/commercial/customer-onboarding/*` desde R2 | test estatico. |
| ID22 | No se usa `lib/customer-identity/resolveCustomerCandidate` como autoridad | test estatico. |
| ID23 | Instagram/Facebook provider observado | no reutiliza consentimiento WhatsApp. |
| ID24 | Same PrestaShop id en dos masters | `IDENTITY_CONFLICT`, bloqueo tecnico/data quality. |

## Roadmap De Implementacion

### ID-R2-A02 - Canonical Identity Evidence Model

Objetivo: definir y persistir evidence minima de identidad sin PII excesiva.

Repos: `CRM-Customer-360`.

Archivos probables:

- nuevo dominio bajo `lib/domains/customer-identity-evidence/*`;
- migracion nueva o extension controlada de `commercial_event`;
- tests unitarios y DB-backed.

Riesgo: duplicar `commercial_event` o crear una tabla demasiado pesada.

Criterio de aceptacion:

- cada resolucion deja evidence durable con source, strength, observedAt, verifiedAt y freshness;
- no se usa evidence historica como permiso de create.

No incluye: resolver email/orden/PrestaShop.

### ID-R2-A03 - Canonical Candidate Resolver Expansion

Objetivo: adaptar readers legacy utiles hacia el boundary canonico, sin estados provisionales.

Repos: `CRM-Customer-360` y, si aplica, Customer Service.

Archivos probables:

- `lib/domains/customer-identity/*`;
- partes reutilizables de `lib/customer-identity/sourceReaders.ts`;
- tests de conflicto email/phone/order.

Riesgo: revivir `created_provisional` o consultar PrestaShop como autoridad desde Sales Agent.

Criterio de aceptacion:

- email/order/PrestaShop solo producen evidence/candidates;
- resolucion final sigue por Customer Service/proyeccion/local links.

No incluye: create/link nuevos.

### ID-R2-A04 - Order Ownership Verification

Objetivo: validar entidad transaccional para order status, reclamo, garantia y devolucion.

Repos: `CRM-Customer-360` y servicio owner de ordenes si existe.

Archivos probables:

- capability/read model de order ownership;
- `resolveNativeCustomerSession` context access;
- tests `validated_entity`.

Riesgo: mezclar dominio postventa con ventas.

Criterio de aceptacion:

- `validated_entity` se concede solo con ownership validado;
- `orderReference` no resuelve identidad por si solo.

No incluye: UI postventa ni Customer Profile order-status.

### ID-R2-A05 - Corrections And Supersede

Objetivo: permitir que el cliente corrija email/nombre/orden sin perder auditabilidad.

Repos: `CRM-Customer-360`.

Archivos probables:

- `CustomerOnboardingService`;
- evidence model;
- tests de overwrite/supersede/conflict.

Riesgo: almacenar PII innecesaria.

Criterio de aceptacion:

- valor actual claro;
- historial redacted o referenciado;
- contradicciones fuertes generan conflict/verification.

No incluye: merge de masters.

### ID-R2-A06 - CommercialWork R2 Identity Workflow Integration

Objetivo: conectar onboarding al modelo de objectives/steps de R2.

Repos: `CRM-Customer-360`.

Archivos probables:

- `lib/brain/commercial/work/*`;
- `runNativeAutonomousCycle.ts`;
- post-plan stage adaptado o equivalente R2.

Riesgo: convertir Customer Profile/onboarding en bloqueo universal.

Criterio de aceptacion:

- R2 solo exige identidad cuando el objetivo lo requiere;
- create/link siguen por Gateway;
- simple product purchase no depende de Customer Profile.

No incluye: nueva autoridad de Customer Service.

### ID-R2-A07 - PrestaShop Link / Customer Profile Identity Bridge

Objetivo: proveer `master_customer.id -> ps_customer.id_customer` deterministicamente.

Repos: `CRM-Customer-360`; coordinacion con `MS-pesaschile-customer-profile`.

Archivos probables:

- `customer_external_identity` provider/type para PrestaShop o proyeccion demostrada;
- bridge reader;
- CP gateway/read model.

Riesgo: asumir igualdad numerica entre ids.

Criterio de aceptacion:

- `NOT_LINKED` si no hay link;
- `AMBIGUOUS` si hay multiples links activos;
- no se consulta Customer Profile con master id.

No incluye: refactor completo de Customer Profile.

### ID-R2-A08 - Omnichannel Identity Contract

Objetivo: generalizar canal/proveedor sin copiar semantica WhatsApp.

Repos: `CRM-Customer-360`.

Archivos probables:

- `trustedInbound` types;
- consent evidence;
- customer service channel contracts;
- provider-specific tests.

Riesgo: sobre-generalizar antes de tener canales reales.

Criterio de aceptacion:

- cada canal declara prueba de control propia;
- no hay provider hardcoded en policy sensible.

No incluye: integracion Meta/Instagram real.

## Que No Tocar

No proponer en este track:

- reescribir `master_customer`;
- reescribir Capability Gateway core;
- reescribir CommercialWork persistence;
- tocar Catalog, Shipping, Quote o Meta;
- migrar todo Customer Profile;
- crear un identity system paralelo;
- usar LLM para resolver conflictos;
- asumir `master_customer.id == ps_customer.id_customer`;
- reactivar tablas legacy como autoridad.

## Respuestas Al Criterio De Salida

1. Fuente canonica para identidad: Customer Service authority + `master_customer` projection + `customer_external_identity` + `crm_customer_onboarding_state`.
2. Como evitar colisiones: usar provider/type/source explicit, FK/projection gate, no igualdad numerica entre ids, conflict si multiples links.
3. Reuse: reutilizar ACS-R1-04 core con adaptaciones; legacy solo como referencia/readers.
4. Email: candidate/evidence, no ownership por si solo.
5. Phone: multi-link permitido, conflicto si multiples masters, no transferencia automatica.
6. Address: no prueba identidad; solo candidate/shipping.
7. Order: requiere ownership validator; hoy no concede `validated_entity`.
8. Create/link: Customer Service, consentimiento, no_match fresco, fail-closed.
9. R2: falta integracion de onboarding post-plan y identity levels.
10. Evidence: falta contrato unificado durable.
11. Privacy: no prompt con PII/candidates crudos; persistir summaries/redacted facts.
12. Primer slice real: `ID-R2-A02 - Canonical Identity Evidence Model`, seguido por resolver expansion y R2 workflow integration.

