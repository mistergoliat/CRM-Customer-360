# SALES-AGENT-R2 CP-R2-A01 - Customer Profile Identity & Integration Audit

Fecha: 2026-08-24

Repos auditados:

- `CRM-Customer-360`, branch `develop`, HEAD `3decd40`.
- `MS-pesaschile-customer-profile`, branch `main`, HEAD `61f6d94`.

Baseline:

- `docs/audits/SALES-AGENT-R2-cross-service-integration-contract-audit.md`.

Alcance:

- Solo auditoria documental.
- No implementa codigo.
- No modifica Catalog, Quote, Shipping/Carrier, Meta/WhatsApp ni Customer Profile Service completo.

## Veredicto

`CUSTOMER_PROFILE_R2_INTEGRATION_PARTIAL`

Customer Profile Service esta funcional y expone endpoints maduros para perfil, resumen comercial, historial, comportamiento, estado de pedido, RFM, clustering y copilot. La integracion con CommercialWork R2 no esta lista porque el runtime comercial recibe `master_customer.id` y los endpoints principales de Customer Profile esperan `ps_customer.id_customer`.

La integracion es parcial, no totalmente bloqueada, porque CRM ya tiene una tabla DB-backed capaz de representar identidades externas (`customer_external_identity`) y Customer360 ya usa `identity_type = 'prestashop_customer_id'` como puente hacia PrestaShop. Falta convertir ese patron en un puente canonico, auditable y fail-closed para Sales Agent/R2, y falta registrar capacidades Customer Profile via Capability Gateway.

## Root Cause Exacta

El error raiz es una mezcla de espacios de identidad numericos:

1. `master_customer.id` es el identificador interno CRM.
2. `ps_customer.id_customer` es el identificador nativo PrestaShop.
3. Ambos son numericos, pero no comparten secuencia ni ownership.
4. El Agent Tool Loop convierte `trustedCustomerSession.identity.customerId` a numero y lo envia al loader de Customer Profile.
5. El Customer Profile HTTP client llama `v1/customers/:customerId/...`.
6. En Customer Profile, ese `customerId` se valida contra `ps_customer.id_customer`, no contra `master_customer.id`.

Evidencia principal:

- CRM `master_customer` define `id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY`, sin columna `prestashop_customer_id` en las migraciones CRM vigentes (`migrations/006_master_customer_platform_origin.sql:4`, `migrations/006_master_customer_platform_origin.sql:5`).
- CRM `customer_external_identity` linkea identidades externas con `customer_id` y tiene unicidad por `(provider, external_id)` (`migrations/010_native_whatsapp_identity_and_conversation_controls.sql:12`, `migrations/010_native_whatsapp_identity_and_conversation_controls.sql:14`, `migrations/010_native_whatsapp_identity_and_conversation_controls.sql:23`).
- El runtime de identidad comercial declara que `ps_customer` no tiene puente verificado hacia `master_customer.id` y que tratar `ps_customer.id_customer` como master id inventaria una relacion prohibida (`lib/domains/customer-identity/local-adapter.ts:14`, `lib/domains/customer-identity/local-adapter.ts:17`).
- El Agent Tool Loop parsea `session.identity.customerId`, pasa `customerId` y `masterCustomerId` al context loader, y el loader invoca Customer Profile (`lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts:219`, `lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts:290`, `lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts:449`).
- El cliente vivo llama `v1/customers/:customerId/profile`, `commercial-summary`, `purchased-products`, `purchase-behavior`, `orders/:reference/status`; su RFM llama `v1/customers/:masterCustomerId/rfm`, lo que tambien cruza identidades (`lib/integrations/customer-profile/http-client.ts:512`, `lib/integrations/customer-profile/http-client.ts:523`, `lib/integrations/customer-profile/http-client.ts:539`, `lib/integrations/customer-profile/http-client.ts:555`, `lib/integrations/customer-profile/http-client.ts:571`, `lib/integrations/customer-profile/http-client.ts:590`).
- Customer Profile documenta que la ruta primaria RFM y las otras rutas `v1/customers/:customerId` usan `ps_customer.id_customer`, y que la ruta legacy separada usa `master_customer.id` (`src/http/routes/index.ts:98`, `src/http/routes/index.ts:101`, `src/http/routes/index.ts:502`, `src/http/routes/index.ts:542`).
- Customer Profile resuelve identidad con `SELECT id_customer FROM ps_customer WHERE id_customer = ?` y provenance `PRESTASHOP/DIRECT_SOURCE` (`src/infrastructure/prestashop/mysql-prestashop-customer-identity-repository.ts:18`, `src/infrastructure/prestashop/mysql-prestashop-customer-identity-repository.ts:20`, `src/infrastructure/prestashop/mysql-prestashop-customer-identity-repository.ts:43`).

## 1. Mapa Real De Identidad

### Que representa `master_customer.id`

`master_customer.id` representa el identificador interno CRM. Es `BIGINT UNSIGNED AUTO_INCREMENT` y vive en la tabla CRM `master_customer`.

No es `ps_customer.id_customer`. No hay evidencia en las migraciones CRM de que comparta secuencia, ownership o garantia de equivalencia con PrestaShop.

### Donde vive `prestashop_customer_id`

Hay dos lugares relevantes:

1. En CRM, la forma vigente y normalizada para identidades externas es `customer_external_identity`. La tabla tiene `provider`, `identity_type`, `external_id`, `normalized_value`, `is_verified` y `customer_id`.
2. En Customer Profile existe una migracion `migrations/001_add_master_customer_prestashop_customer_id.sql` que agregaria `master_customer.prestashop_customer_id`, pero el propio runbook dice no aplicarla porque pertenece a un track futuro y altera una tabla que ese schema no posee (`docs/runbooks/CP-R1-customer-profile-ec2-production-deployment.md:124`). Por lo tanto, no es fuente real vigente para CRM.

Customer360 ya interpreta identidades externas `prestashop_customer_id` desde `customer_external_identity` y las usa para consultar ordenes PrestaShop (`lib/domains/customer-360/local-adapter.ts:184`, `lib/domains/customer-360/local-adapter.ts:189`, `lib/domains/customer-360/local-adapter.ts:704`, `lib/domains/customer-360/local-adapter.ts:726`).

### Normalizacion o duplicacion

`customer_external_identity` normaliza la relacion por identidad externa y no por columna dedicada en `master_customer`. La unicidad `(provider, external_id)` evita que un mismo id externo apunte a multiples master customers si se escribe correctamente.

No existe evidencia de una columna CRM vigente `master_customer.prestashop_customer_id`. La migracion que la agregaria vive en el repo de Customer Profile como artefacto de diseno no aplicado, y el lector RFM de Customer Profile incluso tiene readiness contra esa columna (`src/infrastructure/crm/crm-pool.ts:50`, `src/infrastructure/crm/crm-pool.ts:55`), lo que confirma que ese camino no debe asumirse disponible en CRM.

### Quien escribe y actualiza el link

Para WhatsApp, el subsistema `lib/domains/customer-identity` lee `customer_external_identity` pero no crea links canonicos definitivos. La migracion 024 permite `customer_external_identity.customer_id NULL` para filas no resueltas de primer contacto (`migrations/024_reconcile_unresolved_customer_external_identity.sql:19`).

No se encontro un writer actual que cree de forma canonica filas `provider = 'prestashop'` e `identity_type = 'prestashop_customer_id'` para Sales Agent. Esto es deuda de implementacion: el puente recomendado puede leer esa fuente, pero el primer slice debe asegurar poblacion/ownership del link.

### Si no existe link PrestaShop

Si existe `master_customer.id` pero no existe exactamente una identidad externa verificada PrestaShop asociada, el resultado del puente debe ser `NOT_LINKED`. No es error tecnico y no debe llamar a Customer Profile.

### Multiples identidades externas

Es valido que un cliente tenga varias identidades externas: WhatsApp, email, PrestaShop, orden, etc. La unicidad por `(provider, external_id)` protege contra que una misma identidad externa quede duplicada entre customers. Pero un mismo `master_customer.id` podria tener mas de una identidad PrestaShop si no se impone una regla adicional por `(customer_id, provider, identity_type)`.

Para Customer Profile, si un `master_customer.id` tiene cero links PrestaShop verificados, outcome `NOT_LINKED`; si tiene mas de uno, outcome `AMBIGUOUS`.

### Cliente sin cuenta PrestaShop

Un cliente WhatsApp puede existir en CRM y no tener cuenta PrestaShop. En ese caso Customer Profile no esta disponible para ese customer. CommercialWork debe continuar sin enriquecimiento y no debe inventar, inferir ni consultar `/v1/customers/:masterCustomerId/...`.

### Riesgo de colision numerica accidental

El riesgo es real. `master_customer.id = 123` y `ps_customer.id_customer = 123` pueden existir por coincidencia y representar personas distintas. Si el runtime envia `master_customer.id` a `v1/customers/:customerId/profile`, Customer Profile validara contra `ps_customer.id_customer` y podria devolver datos de otro cliente en vez de 404.

### Diagrama

```text
WhatsApp wa_id / phone / email / prestashop id
  -> customer_external_identity(provider, identity_type, external_id, normalized_value)
  -> customer_external_identity.customer_id
  -> master_customer.id
  -> bridge lookup:
       customer_external_identity
       provider = 'prestashop'
       identity_type = 'prestashop_customer_id'
       is_verified = 1
  -> ps_customer.id_customer
  -> Customer Profile /v1/customers/:customerId/...
```

## 2. Dos Subsistemas De Identidad En CRM

| Subsistema | Proposito | Productores | Consumidores | Tablas | API/runtime | Conoce PrestaShop IDs | Dashboard | Sales Agent | Estado |
|---|---|---|---|---|---|---|---|---|---|
| `lib/customer-identity/*` | Resolver candidatos read-only desde multiples fuentes historicas/parciales | Lectores sobre `master_customer`, `ps_customer`, `ps_address`, `ps_orders`, legacy conversations/inbound | Auditorias, exploracion/candidate resolution | Varias fuentes read-only, no ownership unico | `resolveCustomerCandidate`, version `p1j-001-readonly-1` | Si, como observacion/candidato | No es el bridge Customer360 vigente | No es el runtime nativo actual | `LEGACY_DEBT` / candidate discovery |
| `lib/domains/customer-identity/*` | Boundary read-only ACS-R1-04 para identidad inbound WhatsApp | `customer_external_identity` ya persistida | Native customer session / Sales Agent entry | `customer_external_identity` | `createCustomerIdentityResolutionService` | No resuelve PrestaShop por si mismo; advierte que no hay puente verificado | Indirectamente compatible por tabla | Si, para `identity.customerId` | `CURRENT` para identidad CRM inbound |
| `lib/domains/customer-360/*` | Read model Customer360/dashboard | `master_customer`, `customer_external_identity`, address book, ordenes | Dashboard/Customer360 | `master_customer`, `customer_external_identity`, `ps_orders` | Query service local | Si, lee `identity_type = 'prestashop_customer_id'` | Si | No | `CURRENT` como read model, no como resolver dedicado |

### Fuente canonica recomendada

La fuente canonica para el puente R2 debe ser `customer_external_identity`.

Razon:

- Es tabla CRM vigente, DB-backed y auditable.
- Ya es el boundary usado por la identidad inbound.
- Ya es el mecanismo que Customer360 usa para extraer `prestashop_customer_id`.
- Tiene unicidad por identidad externa.
- No requiere asumir igualdad numerica ni consultar PrestaShop directamente.

`lib/customer-identity/*` no debe ser fuente canonica para R2. Lee demasiadas fuentes, produce candidatos y conflictos, y esta disenado como resolucion read-only/provisional. Puede ayudar a diagnosticar o poblar links en un proceso controlado, pero no debe decidir en runtime comercial.

`master_customer.prestashop_customer_id` no debe ser fuente canonica actual porque no existe como migracion CRM aplicada. Si se decide adoptar esa columna mas adelante, debe moverse al repo owner CRM, definirse su writer y migracion real, y entonces podria reemplazar o complementar el puente. Hoy no.

No hay razon valida para mantener dos subsistemas paralelos como fuentes activas de verdad. Si ambos siguen existiendo, deben tener roles separados:

- `lib/domains/customer-identity`: runtime canonical boundary.
- `lib/customer-identity`: legacy/candidate discovery, no runtime comercial.

## 3. Inventario Real Del Customer Profile Service

| Endpoint | Identity input | Data source | Realtime/Snapshot | Error semantics | Commercial relevance |
|---|---|---|---|---|---|
| `GET /v1/customers/:customerId/profile` | `ps_customer.id_customer` | `ps_customer`, `ps_orders` recent orders | `NEAR_REALTIME` direct DB read | `available` 200, `customer_not_found` 404, `degraded` 503 | Alta para datos basicos y compras recientes, con minimizacion |
| `GET /v1/customers/:customerId/commercial-summary` | `ps_customer.id_customer` | `ps_customer`, `ps_orders`, `ps_order_detail` | `DERIVED` from current DB read | 200, 404, 503 | Alta; mejor primera fuente para senales agregadas |
| `GET /v1/customers/:customerId/purchased-products` | `ps_customer.id_customer` | `ps_orders`, `ps_order_detail`, `ps_product` | `DERIVED` from current DB read, paginado | 200, 404, 503 | Media/alta para "comprar lo mismo"; no cada turno |
| `GET /v1/customers/:customerId/purchase-behavior` | `ps_customer.id_customer` | `ps_orders`, `ps_order_detail`, `derived_purchase_behavior` | `DERIVED` from current DB read | 200, 404, 503 | Alta para patrones/top productos |
| `GET /v1/customers/:customerId/orders/:reference/status` | `ps_customer.id_customer` + order reference | `ps_orders`, order state/carrier | `NEAR_REALTIME`; no tracking realtime | 200, `customer_not_found`/`order_not_found` 404, 503 | Separada; postventa/SAC u objetivo explicito |
| `GET /v1/customers/:customerId/rfm` | `ps_customer.id_customer` | `customer_rfm_snapshot`, `customer_rfm_snapshot_row`, `ps_customer` only to classify missing | `SNAPSHOT` | 200, `customer_not_found`/`rfm_not_available` 404, 503 | Enriquecimiento no bloqueante |
| `GET /v1/master-customers/:masterCustomerId/rfm` | `master_customer.id` | RFM snapshot rows with `master_customer_id` | `SNAPSHOT`, legacy/secondary | 200, `customer_not_found`/`rfm_not_available` 404, 503 | No integrar a R2 salvo migracion controlada; ruta legacy |
| `GET /v1/customers/:customerId/cluster` | `ps_customer.id_customer` | `customer_cluster_snapshot*`, `ps_customer` | `SNAPSHOT` latest published | 200, `customer_not_found`/`cluster_not_available` 404, 503 | No R2 directo |
| `GET /v1/clustering/snapshots/latest/summary` | Ninguna identidad customer | Cluster snapshots | `SNAPSHOT` aggregate | 200, no snapshot 404, 503 | Analytics, no R2 |
| `GET /v1/clustering/snapshots/:snapshotId/summary` | Snapshot id | Cluster snapshots | `HISTORICAL/SNAPSHOT` | 200, not found 404, 503 | Analytics, no R2 |
| `GET /v1/clustering/snapshots/latest/rfm-cross-tab` | Ninguna identidad customer | Latest cluster + latest RFM snapshots joined by `prestashop_customer_id` | `SNAPSHOT` aggregate | 200, no compatible snapshot 404, 503 | Analytics, no R2 |
| `POST /v1/customer-intelligence/copilot` | Pregunta + contexto/sesion, no per-customer runtime simple | Feature/RFM/cluster snapshots | `SNAPSHOT/DERIVED` | 200, 422, 502, 503, 504 | Marketing/analytics, no R2 |
| Copilot sessions lifecycle | Session id | Copilot session store + snapshots | `SNAPSHOT/DERIVED` | lifecycle statuses | No R2 |

Evidencia:

- Rutas y status handlers en `src/http/routes/index.ts:353`, `src/http/routes/index.ts:382`, `src/http/routes/index.ts:418`, `src/http/routes/index.ts:460`, `src/http/routes/index.ts:507`, `src/http/routes/index.ts:546`, `src/http/routes/index.ts:583`, `src/http/routes/index.ts:621`, `src/http/routes/index.ts:651`, `src/http/routes/index.ts:681`, `src/http/routes/index.ts:715`.
- Identidad primaria Customer Profile via `ps_customer` en `src/infrastructure/prestashop/mysql-prestashop-customer-identity-repository.ts:18`.
- RFM primary vs legacy separado en comentarios de rutas `src/http/routes/index.ts:502` y `src/http/routes/index.ts:542`.

## 4. Semantica De Datos

| Dato | Clasificacion | Timestamp/freshness | Cambia durante conversacion | Nota |
|---|---|---|---|---|
| `profile` | `NEAR_REALTIME` | `ps_customer.date_upd` y lectura actual de DB; replica freshness no versionada | Si, si cambia cuenta/email/estado | No es snapshot |
| `commercial-summary` | `DERIVED` sobre DB actual | `generatedAt` del servicio y agregados de ordenes | Si, si entra orden/validez cambia | Fuente primaria agregada para ventas |
| `purchased-products` | `DERIVED` sobre DB actual | Calculado al fetch, filas de ordenes validas | Si, si cambia historial/validacion | Paginado, no persistir completo |
| `purchase-behavior` | `DERIVED` sobre DB actual | `calculatedAt` del servicio | Si, si cambian ordenes | Resume comportamiento/top productos |
| `order-status` | `NEAR_REALTIME` | `lastRecordedUpdateAt`; `isRealTimeTracking = false` | Si, estado de pedido cambia | No es carrier tracking realtime |
| `RFM` | `SNAPSHOT` | `snapshotId`, `calculationVersion`, `referenceTime`, `publishedAt` | No dentro del mismo snapshot | No tratar como realtime |
| `cluster` | `SNAPSHOT` | `snapshotId`, `modelVersion`, `generatedAt`, `publishedAt` | No dentro del mismo snapshot | Marketing/analytics |
| clustering summary/cross-tab | `SNAPSHOT/HISTORICAL` | snapshot published/superseded | No | Aggregate analytics |
| customer intelligence copilot | `DERIVED` desde snapshots | feature snapshot anchor + latest RFM/cluster <= feature reference time | No para snapshots, si para respuesta generada | No R2 |

RFM y clustering se sirven desde snapshots publicados. La lectura RFM busca el ultimo snapshot `status = 'published'` (`src/infrastructure/rfm/mysql-rfm-snapshot-reader.ts:66`) y luego la fila por `prestashop_customer_id` (`src/infrastructure/rfm/mysql-rfm-snapshot-reader.ts:91`). Clustering tambien usa ultimo snapshot publicado (`src/infrastructure/clustering/mysql-cluster-snapshot-reader.ts:20`) y nunca recomputa en serving (`src/application/customer-clustering/get-customer-cluster.ts:12`).

## 5. Clientes HTTP Existentes En CRM

| Client/Adapter | Env vars | Consumers | Identity expected by code | Status |
|---|---|---|---|---|
| `lib/customer-profile/httpCustomerProfileAdapter.ts` | `CUSTOMER_PROFILE_SERVICE_BASE_URL`, `CUSTOMER_PROFILE_SERVICE_API_KEY`, `CUSTOMER_PROFILE_SERVICE_TIMEOUT_MS` | Sin callers vigentes segun auditoria baseline | Parametro llamado `masterCustomerId`, pero llama `/v1/customers/:id/purchased-products` y `/purchase-behavior` | `DEAD_CODE` / `LEGACY_DEBT` |
| `lib/integrations/customer-profile/http-client.ts` | `CUSTOMER_PROFILE_ENABLED`, `CUSTOMER_PROFILE_BASE_URL`, `CUSTOMER_PROFILE_AUTH_TOKEN`, `CUSTOMER_PROFILE_TIMEOUT_MS` | `lib/brain/commercial/capabilities/customer-profile/*`, loader Agent Tool Loop | `customerId` para rutas `/v1/customers/:customerId`; `masterCustomerId` para RFM pero lo envia a `/v1/customers/:id/rfm` | `CURRENT` pero `RISKY` por identidad |
| `lib/brain/commercial/capabilities/customer-profile/*` | Usa cliente vivo | Wrapper interno de capacidades, no Capability Gateway | Hereda identidad del cliente | `CURRENT` para loader, no R2 |
| `lib/brain/commercial/customer-profile-context/*` | `CUSTOMER_PROFILE_CONTEXT_ENABLED`, `CUSTOMER_PROFILE_PURCHASED_PRODUCTS_LIMIT`, `CUSTOMER_PROFILE_TOP_PRODUCTS_LIMIT`, `CUSTOMER_PROFILE_TOP_VARIANTS_LIMIT`, `CUSTOMER_PROFILE_RECENT_PURCHASES_LIMIT` | `runNativeAgentToolLoopCycle` | Usa `customerId` numerico y `masterCustomerId` opcional desde trusted session | `CURRENT` pero `RISKY`; prompt context oculto |
| Capability Gateway R2 | N/A | CommercialWork R2 | No existe operacion Customer Profile registrada | `MISSING` |

Evidencia:

- Bloque A legacy env y paths en `lib/customer-profile/httpCustomerProfileAdapter.ts:46`, `lib/customer-profile/httpCustomerProfileAdapter.ts:48`, `lib/customer-profile/httpCustomerProfileAdapter.ts:442`, `lib/customer-profile/httpCustomerProfileAdapter.ts:454`.
- Bloque B config y paths en `lib/integrations/customer-profile/http-client.ts:133`, `lib/integrations/customer-profile/http-client.ts:136`, `lib/integrations/customer-profile/http-client.ts:512`, `lib/integrations/customer-profile/http-client.ts:590`.
- Bloque C context flag en `lib/brain/commercial/customer-profile-context/config.ts:31`.
- Gateway actual solo registra Catalog, knowledge, recommendation, shipping y quote; no Customer Profile (`lib/brain/commercial/capability-gateway/registry.ts:488`, `lib/brain/commercial/capability-gateway/registry.ts:532`).

## 6. Flow Actual Del Sales Agent

Flow observado:

```text
WhatsApp inbound
  -> native customer session
  -> lib/domains/customer-identity resolves external identity
  -> trustedCustomerSession.identity.customerId = master_customer.id
  -> runNativeAgentToolLoopCycle parses it as number
  -> loadCustomerCommercialHistoryContext
  -> Customer Profile HTTP client
  -> /v1/customers/:customerId/...
  -> prompt context summary
  -> LLM
```

Respuestas:

1. ID enviado hoy: `identity.customerId`, que en el runtime nativo corresponde a `master_customer.id`.
2. Endpoint: `v1/customers/:customerId/commercial-summary`, luego `purchased-products`, `purchase-behavior`, `profile`; RFM usa `v1/customers/:masterCustomerId/rfm`.
3. Si se habilita el flag, puede haber 404 si no existe `ps_customer.id_customer = master_customer.id`; peor, puede haber lectura cruzada si existe por colision.
4. El fallo podria ser `404 customer_not_found`, `CONTRACT_ERROR` si provenance no coincide, o exito contra cliente equivocado por colision numerica.
5. Datos que llegan al prompt: summary comercial, purchased products acotados, purchase behavior, recent orders y RFM summary segun loader/context.
6. Datos descartados: payload completo/provenance detallada se condensa a context/signals.
7. Informacion no persistida/auditable: los datos exactos vistos por el LLM no quedan como `crm_capability_executions` ni evidence CommercialWork.
8. Retry: el cliente maneja timeouts/errores como resultados, pero el loader no es un step R2 con retry durable.
9. Ocurre en Agent Tool Loop/context loader. CommercialWork R2 no consume Customer Profile hoy.

## 7. Identity Bridge Correcto

### Opciones evaluadas

| Opcion | Evaluacion | Decision |
|---|---|---|
| A. Leer `master_customer.prestashop_customer_id` | Seria simple y con unicidad fuerte si existiera. Pero no existe en migraciones CRM vigentes; la migracion en Customer Profile es artefacto no aplicado y no owner de la tabla. | No elegir ahora |
| B. Usar subsystem dashboard Customer360 | El read model ya demuestra el patron, pero no es un resolver reusable ni fail-closed; carga mas datos que el puente necesita. | Reusar semantica, no adapter completo |
| C. Usar `customer_external_identity` | Tabla CRM vigente, auditable, DB-backed, con uniqueness por identidad externa; compatible con Customer360. | Elegida |
| D. Fuente derivada por email/phone/order | Fragil, heuristica y con riesgo de colision/cambios. | Prohibida para runtime R2 |

### Mecanismo recomendado

Entrada: `masterCustomerId`.

Pasos:

1. Validar `masterCustomerId` como bigint positivo en string.
2. Verificar que `master_customer.id = masterCustomerId` exista.
3. Consultar `customer_external_identity`:

```sql
SELECT external_id, normalized_value, is_verified
FROM customer_external_identity
WHERE customer_id = ?
  AND provider = 'prestashop'
  AND identity_type = 'prestashop_customer_id'
  AND is_verified = 1;
```

4. Parsear `external_id` o `normalized_value` como entero positivo seguro.
5. Si hay exactamente un id valido, devolver `RESOLVED`.
6. Si no hay filas, `NOT_LINKED`.
7. Si hay mas de un id valido distinto, `AMBIGUOUS`.
8. Si DB falla, contrato invalido o valores no parseables, `SYSTEM_FAILURE`.

Contrato de salida:

```ts
type CustomerProfileIdentityBridgeResult =
  | {
      status: "RESOLVED";
      masterCustomerId: string;
      prestashopCustomerId: number;
      source: "customer_external_identity";
      identityExternalId: string;
      verified: true;
      resolvedAt: string;
    }
  | { status: "NOT_LINKED"; masterCustomerId: string; reason: "NO_VERIFIED_PRESTASHOP_IDENTITY" }
  | { status: "AMBIGUOUS"; masterCustomerId: string; reason: "MULTIPLE_PRESTASHOP_IDENTITIES" }
  | { status: "SYSTEM_FAILURE"; masterCustomerId: string; reason: string; retryable: boolean };
```

Este puente evita colisiones porque nunca usa igualdad numerica. Solo llama Customer Profile despues de resolver un link explicito CRM-owned.

## 8. Cliente Sin Cuenta PrestaShop

Caso:

```text
WhatsApp customer identificado en CRM
master_customer.id existe
no existe customer_external_identity prestashop verificada
```

Resultado:

- Bridge: `NOT_LINKED`.
- Estado comercial: `NO_PROFILE_AVAILABLE` o `NOT_LINKED`, segun nivel de API.
- No es `SYSTEM_FAILURE`.
- No es `WAITING_CUSTOMER` por defecto.
- CommercialWork continua si el objetivo es compra, cotizacion o discovery.

Solo debe pedir informacion al cliente si el objetivo explicito la requiere. Ejemplos: order status sin referencia de pedido, o "quiero comprar lo mismo" sin link ni descripcion suficiente.

No se debe:

- Consultar `/v1/customers/:masterCustomerId/...`.
- Inferir por email/telefono.
- Crear una identidad PrestaShop.
- Tratar el caso como outage tecnico.

## 9. Capabilities Recomendadas Para R2

No conviene exponer un endpoint como una capability. La superficie comercial debe ser estable y menos chatty.

Decision recomendada: opcion B, read model comercial consolidado.

| Capability R2 | Usa endpoints CP | Tipo | Uso |
|---|---|---|---|
| `get_customer_commercial_profile` | `profile`, `commercial-summary`, `purchase-behavior`, opcional `purchased-products` con limite bajo | Gateway read capability | Enriquecimiento comercial y objetivos de historial |
| `get_customer_rfm` | `rfm` primary por `ps_customer.id_customer` | Gateway read capability separada | Segmento/senal snapshot no bloqueante |
| `get_customer_order_status` | `orders/:reference/status` | Gateway read capability separada | Objetivo explicito de pedido/postventa |

No integrar en R2 ahora:

- `GET /v1/master-customers/:masterCustomerId/rfm`: legacy/secondary, perpetua la confusion de espacios de identidad.
- `GET /v1/customers/:customerId/cluster`: marketing/analytics snapshot, no decision comercial R2 clara.
- clustering summary / RFM cross-tab: agregados poblacionales, no per-turn.
- customer intelligence copilot: copilot de analytics/marketing con su propia gobernanza, no debe meterse como decision comercial directa.

## 10. Gateway Vs Context Loader

### Debe pasar por Capability Gateway y persistirse

- `get_customer_commercial_profile` cuando alimente una decision o step R2.
- `get_customer_rfm` si se usa para adaptar follow-up, prioridad o tono comercial.
- `get_customer_order_status` cuando el objetivo explicito sea estado de pedido.

Estos resultados deben quedar en `crm_capability_executions` y/o evidence CommercialWork con payload minimizado.

### Puede seguir como prompt context opcional

- En Agent Tool Loop legacy, solo despues de arreglar el puente de identidad y con flags apagados por defecto.
- Contexto resumido no determinante, por ejemplo "hay historial disponible" o "cliente recurrente", sin IDs ni datos personales completos.

### Debe convertirse en facts/evidence CommercialWork

- Identidad resuelta: `masterCustomerId`, `prestashopCustomerId`, source, fetchedAt/resolvedAt.
- Resumen comercial: totales/ultima compra/top senales limitadas.
- RFM: snapshot metadata y segmento.
- Order status: referencia, estado, timestamps, ownership.

### No consumirse

- Copilot, clustering summary, cross-tab y datasets completos.
- Payloads completos de productos u ordenes si no son requeridos por el objetivo.

## 11. Modelo De Uso CommercialWork

### Enrichment no bloqueante

Ejemplo: el cliente quiere comprar un producto.

Customer Profile puede aportar historial, recompra, frecuencia, top products o segmento RFM. Si el bridge da `NOT_LINKED` o el servicio esta caido, la venta debe seguir. El objective no debe pasar a `WAITING_CUSTOMER` por falla tecnica.

### Objective explicito

Ejemplos:

- "Que compre la ultima vez?"
- "Quiero volver a comprar lo mismo."
- "Que paso con mi pedido?"

En estos casos la capability puede ser requerida por el objective:

- Historial/recompra: `get_customer_commercial_profile`.
- Estado de pedido: `get_customer_order_status` y order reference si falta.

### Prefetch deterministico

Puede hacerse una prelectura no bloqueante al iniciar work si:

- Hay `masterCustomerId`.
- Bridge `RESOLVED`.
- El objective comercial se beneficia de historial.
- El resultado se registra como evidence o se marca como unavailable con semantica clara.

## 12. RFM

Ruta primaria:

- `GET /v1/customers/:customerId/rfm`, donde `customerId = ps_customer.id_customer`.

Ruta legacy:

- `GET /v1/master-customers/:masterCustomerId/rfm`, donde `masterCustomerId = master_customer.id`.

RFM es snapshot. El servicio lee el ultimo snapshot publicado y la fila por `prestashop_customer_id`. Si no hay snapshot, devuelve degradado/no disponible; si no hay fila, distingue customer inexistente de RFM no disponible.

Evidence minimo recomendado, usando nombres reales del contrato:

```json
{
  "masterCustomerId": "9001",
  "prestashopCustomerId": 123,
  "sourceCapability": "get_customer_rfm",
  "sourceEndpoint": "GET /v1/customers/:customerId/rfm",
  "fetchedAt": "2026-08-24T00:00:00.000Z",
  "freshness": {
    "semantics": "SNAPSHOT",
    "snapshotId": "42",
    "calculationVersion": "rfm-v1",
    "referenceTime": "2026-08-23T00:00:00.000Z",
    "publishedAt": "2026-08-23T01:00:00.000Z",
    "stale": false
  },
  "segment": {
    "code": "loyal",
    "version": "segment-v1"
  },
  "rfm": {
    "recencyDays": 30,
    "frequencyOrders": 4,
    "grossOrderValueTaxIncl": "199990.00",
    "averageOrderValueTaxIncl": "49997.50",
    "recencyScore": 4,
    "frequencyScore": 3,
    "monetaryScore": 5,
    "rfmCode": "435"
  }
}
```

RFM puede influir en follow-up, priorizacion o enriquecimiento LLM. No debe bloquear ninguna venta. Si una politica deterministica futura usa RFM, debe definir comportamiento para `NO_RFM`, snapshot stale y service unavailable.

## 13. Purchase History

Solapamiento:

- `commercial-summary` agrega conteos, gasto, fechas y resumen. Es la fuente primaria para una vista rapida comercial.
- `purchase-behavior` agrega comportamiento, productos top y variantes top. Es la fuente primaria para patrones de recompra.
- `purchased-products` entrega detalle paginado producto/variante. Es util para "comprar lo mismo" o preguntas especificas, no para cada turno.

Recomendacion:

- `get_customer_commercial_profile` debe llamar primero `commercial-summary`.
- Agregar `purchase-behavior` si el objective o la politica de enrichment lo justifica.
- Llamar `purchased-products` solo con limites bajos y cuando haya necesidad real.
- No duplicar agregaciones en CRM; el CRM debe orquestar, resumir y persistir evidence reducido.

## 14. Order Status

`order-status` valida pertenencia por `id_customer` y `reference`, no por referencia sola (`src/infrastructure/prestashop/mysql-customer-order-status-reader.ts:34`). El resultado dice `source = 'prestashop_current_state'` e `isRealTimeTracking = false` (`src/application/customer-order-status/get-customer-order-status.ts:96`, `src/application/customer-order-status/get-customer-order-status.ts:97`).

Ownership recomendado:

- Dominio primario: Postventa/SAC u order inquiry.
- En R2: capability separada para objetivo explicito.
- No incluir en `get_customer_commercial_profile`.

## 15. Copilot Y Clustering

No deben entrar directamente a CommercialWork R2.

Razones:

- Clustering es snapshot/analytics, no una lectura operacional necesaria por turno.
- Summary y cross-tab son agregados poblacionales, no datos del cliente para resolver una venta.
- Customer intelligence copilot usa feature snapshots y selecciona RFM/cluster publicados alrededor del feature snapshot; no recalcula ni opera como servicio transaccional de ventas (`src/application/customer-intelligence/resolve-customer-intelligence-context.ts:23`, `src/application/customer-intelligence/resolve-customer-intelligence-context.ts:43`).
- Meter otro copilot dentro del Sales Agent duplicaria decision-making y trazabilidad.

## 16. Evidence Contract Minimo

Contrato base para cualquier evidencia Customer Profile:

```ts
type CustomerProfileEvidence = {
  evidenceType: "customer_profile";
  masterCustomerId: string;
  prestashopCustomerId: number;
  identityBridge: {
    status: "RESOLVED";
    source: "customer_external_identity";
    identityExternalId: string;
    resolvedAt: string;
  };
  sourceCapability: "get_customer_commercial_profile" | "get_customer_rfm" | "get_customer_order_status";
  sourceEndpoint: string;
  fetchedAt: string;
  sourceUpdatedAt?: string | null;
  freshness: {
    semantics: "REALTIME" | "NEAR_REALTIME" | "SNAPSHOT" | "DERIVED" | "HISTORICAL";
    snapshotId?: string | null;
    calculationVersion?: string | null;
    referenceTime?: string | null;
    publishedAt?: string | null;
    stale?: boolean;
  };
  payload: Record<string, unknown>;
};
```

Reglas:

- Persistir payload comercial relevante, no datasets completos.
- Mantener `masterCustomerId` y `prestashopCustomerId` juntos para auditoria.
- Guardar endpoint/capability y timestamps.
- Guardar snapshot metadata cuando exista.
- No perder provenance del origen PrestaShop.

## 17. Failure Semantics

| Caso | Semantica | Retry | CommercialWork |
|---|---|---|---|
| Bridge `NOT_LINKED` | Business state: no hay cuenta/link PrestaShop | No retry infinito | Venta continua; profile no disponible |
| Bridge `AMBIGUOUS` | Identity conflict | No automatic retry | Fail-closed, system-owned/manual resolution |
| Bridge `SYSTEM_FAILURE` | DB/config/system failure | Si si retryable | `WAITING_SYSTEM`/retry, no `WAITING_CUSTOMER` |
| CP 404 `customer_not_found` despues de bridge `RESOLVED` | Link stale o bug de identidad | No infinito; alertar | System-owned, fail-closed para ese enrichment |
| CP 404 `rfm_not_available` | Snapshot/fila no disponible | No | RFM absent, venta continua |
| CP 404 `order_not_found` | Pedido no pertenece/no existe para ese cliente | No tecnico | Objetivo order status no resuelto; puede pedir referencia si falta/erronea |
| CP 503/timeout/network | Service unavailable | Si | Enrichment no bloqueante; objetivo explicito puede quedar `WAITING_SYSTEM` |
| Contract/provenance mismatch | Invalid contract | No automatic | `FAILED` system-owned, no usar payload |

Regla: una falla tecnica o system-owned nunca debe convertirse en `WAITING_CUSTOMER`, salvo que realmente falte una informacion que el cliente puede entregar, como una referencia de pedido para un objetivo de estado.

## 18. Privacy Y Data Minimization

Datos personales observados:

- `profile`: nombre, apellido, email, estado de cuenta, shop, fechas y ordenes recientes.
- `commercial-summary`: importes, conteos, fechas, productos agregados.
- `purchased-products`: historial por producto/variante, cantidades, gasto.
- `purchase-behavior`: patrones/top productos y variantes.
- `order-status`: referencia, estado de pedido, timestamps, carrier/order state.

Recomendaciones:

- Sales necesita senales, no dumps: cliente recurrente, ultima compra relevante, top productos acotados, frecuencia, segmento.
- Mantener email completo y listas largas server-side; no meterlas completas al prompt.
- Persistir evidence reducido con IDs y provenance; no persistir todo el historial si no es necesario.
- Para prompts, usar summaries acotados y evitar identificadores internos, email completo, montos detallados innecesarios y raw JSON.
- No usar copilot/analytics outputs como prompt bruto de ventas.

## 19. Env / Flags

| Flag/env | Bloque | Estado | Recomendacion |
|---|---|---|---|
| `CUSTOMER_PROFILE_SERVICE_BASE_URL` | A legacy | Muerto/deuda | Eliminar cuando se haga cleanup |
| `CUSTOMER_PROFILE_SERVICE_API_KEY` | A legacy | Muerto/deuda | Eliminar |
| `CUSTOMER_PROFILE_SERVICE_TIMEOUT_MS` | A legacy | Muerto/deuda | Eliminar |
| `CUSTOMER_PROFILE_ENABLED` | B vivo | Kill switch HTTP actual | Mantener como kill switch real, pero no permitir produccion sin bridge |
| `CUSTOMER_PROFILE_BASE_URL` | B vivo | Config HTTP actual | Mantener |
| `CUSTOMER_PROFILE_AUTH_TOKEN` | B vivo | Auth opcional | Mantener y alinear con service |
| `CUSTOMER_PROFILE_TIMEOUT_MS` | B vivo | Timeout | Mantener con limites |
| `CUSTOMER_PROFILE_CONTEXT_ENABLED` | C context | Context loader | Mantener apagado hasta bridge; separar de R2 Gateway |
| `CUSTOMER_PROFILE_PURCHASED_PRODUCTS_LIMIT` | C context | Limite | Mantener solo para loader/context |
| `CUSTOMER_PROFILE_TOP_PRODUCTS_LIMIT` | C context | Limite | Mantener |
| `CUSTOMER_PROFILE_TOP_VARIANTS_LIMIT` | C context | Limite | Mantener |
| `CUSTOMER_PROFILE_RECENT_PURCHASES_LIMIT` | C context | Limite | Mantener |

Combinacion peligrosa:

```text
CUSTOMER_PROFILE_ENABLED=true
CUSTOMER_PROFILE_CONTEXT_ENABLED=true
sin bridge master_customer -> prestashop_customer_id
```

Esa combinacion puede generar 404 masivo o lectura de cliente equivocado por colision numerica. Regla de rollout: no activar Customer Profile en produccion para Sales Agent/R2 mientras el bridge no exista y no falle cerrado.

## 20. Legacy Vs R2

| Customer Profile operation | CommercialWork R2 | Multi-request runtime | Agent Tool Loop | Legacy operational/sales-consultative |
|---|---|---|---|---|
| profile | No hoy; target via `get_customer_commercial_profile` | No Gateway CP | Si via hidden context loader si flags | No usar como referencia |
| commercial-summary | No hoy; target primary summary | No Gateway CP | Si via hidden context loader | No usar |
| purchased-products | Solo cuando objetivo historia/recompra | No Gateway CP | Si via context loader con limite | Legacy adapter muerto |
| purchase-behavior | Target como parte consolidada | No Gateway CP | Si via context loader | No usar |
| order-status | Separado, objetivo explicito Postventa/SAC | No Gateway CP | Cliente existe pero no flow R2 | No portar automatico |
| RFM primary | Target `get_customer_rfm` snapshot | No Gateway CP | Intento actual via path equivocado para master id | No portar |
| RFM legacy master | No integrar | No | No deberia usarse | Legacy/deuda |
| cluster | No | No | No | Analytics |
| clustering summary/cross-tab | No | No | No | Analytics |
| customer intelligence copilot | No | No | No | Marketing/analytics |

Bypasses identificados:

- Agent Tool Loop puede alimentar prompt con Customer Profile sin Capability Gateway ni evidence durable.
- Bloque A legacy puede inducir a usar env vars muertas y parametros `masterCustomerId` contra endpoints `customers`.
- Customer Profile RFM legacy por `masterCustomerId` podria parecer una solucion rapida, pero no cubre profile/history/order-status y preserva dos sistemas de identidad.

## 21. Test Matrix Propuesta

| ID | Caso | Esperado |
|---|---|---|
| CP01 | `master_customer` con identidad externa `prestashop_customer_id` verificada | Bridge `RESOLVED`, usa `ps_customer.id_customer` |
| CP02 | `master_customer` sin `prestashop_customer_id` | `NOT_LINKED`, no HTTP Customer Profile |
| CP03 | `master_customer.id` numericamente igual a un `ps_customer.id_customer` ajeno | Nunca asumir igualdad; no consulta sin link |
| CP04 | Wrong master ID enviado a endpoint `customerId` | Test falla si se intenta llamar `/v1/customers/:masterCustomerId/...` |
| CP05 | profile success | Evidence incluye endpoint, fetchedAt, ids y payload minimizado |
| CP06 | purchase behavior success | Payload acotado, no raw dataset excesivo |
| CP07 | RFM success con snapshot metadata | Evidence incluye `snapshotId`, `calculationVersion`, `referenceTime`, `publishedAt` |
| CP08 | Service unavailable | Retryable/system-owned; no `WAITING_CUSTOMER` |
| CP09 | Profile no disponible durante compra simple | Venta sigue; enrichment absent |
| CP10 | Restart/reprojection | Evidence durable permite reconstruir que vio el sistema |
| CP11 | Customer cambia link de identidad | Evidence anterior queda con stale semantics y source identity |
| CP12 | No duplicated HTTP clients used | Solo Bloque B/Gateway adapter activo |
| CP13 | CommercialWork no requiere Customer Profile para compra simple | Objective puede completar sin CP |
| CP14 | "Que compre antes?" | Historial/perfil requerido; si no linked, pedir alternativa solo si hace falta |
| CP15 | RFM stale snapshot | Visible como stale/not-current; no bloquea venta |
| CP16 | `CUSTOMER_PROFILE_ENABLED=true` sin bridge | Startup/config o runtime gate bloquea uso productivo |
| CP17 | Multiple PrestaShop identities para un master | Bridge `AMBIGUOUS`, fail-closed |

## 22. Plan De Implementacion

### CP-R2-A02 - Canonical PrestaShop Identity Bridge

- Objetivo: implementar el puente `master_customer.id -> ps_customer.id_customer` usando `customer_external_identity`.
- Repos: `CRM-Customer-360`.
- Archivos probables: nuevo modulo en `lib/domains/customer-profile-identity/*` o `lib/brain/commercial/customer-profile/identityBridge.ts`; tests unitarios.
- Tests: CP01, CP02, CP03, CP04, CP17.
- Riesgo: ausencia de writer/poblacion para links PrestaShop.
- Criterio de aceptacion: ninguna llamada Customer Profile puede usar `master_customer.id` como `customerId`.
- Dependencias: definir/confirmar owner que escribe `provider='prestashop'`.
- No incluye: Gateway, prompts, RFM policy.

### CP-R2-A03 - Customer Profile Gateway Read Model

- Objetivo: registrar capabilities `get_customer_commercial_profile`, `get_customer_rfm`, `get_customer_order_status`.
- Repos: `CRM-Customer-360`.
- Archivos probables: `lib/brain/commercial/capability-gateway/*`, adapter Customer Profile Gateway, schemas/evidence mapper.
- Tests: CP05, CP06, CP07, CP08, CP12, CP16.
- Riesgo: chatty fanout o payload excesivo.
- Criterio de aceptacion: resultados auditables en capability executions con payload minimizado.
- Dependencias: CP-R2-A02.
- No incluye: usar estas capabilities en planner R2.

### CP-R2-A04 - CommercialWork Integration

- Objetivo: conectar objectives R2 a las capabilities cuando corresponde.
- Repos: `CRM-Customer-360`.
- Archivos probables: `deriveCommercialWorkSteps.ts`, objective/requirement resolvers, evidence/facts mapping.
- Tests: CP09, CP10, CP13, CP14.
- Riesgo: volver bloqueante un enrichment opcional.
- Criterio de aceptacion: compras simples no dependen de Customer Profile; objetivos explicitos si usan evidence.
- Dependencias: CP-R2-A03.
- No incluye: clustering/copilot.

### CP-R2-A05 - RFM Semantics And Policy

- Objetivo: integrar RFM como snapshot evidence con stale semantics visibles.
- Repos: `CRM-Customer-360`.
- Archivos probables: evidence mapper, policy/follow-up integration, tests.
- Tests: CP07, CP15.
- Riesgo: tratar snapshot como realtime o usar segmento como regla dura sin fallback.
- Criterio de aceptacion: RFM nunca bloquea venta y siempre expone snapshot metadata.
- Dependencias: CP-R2-A03.
- No incluye: recalcular RFM ni cambiar Customer Profile Service.

### CP-R2-A06 - Legacy Cleanup And Flag Hardening

- Objetivo: retirar Bloque A, documentar flags vivos y bloquear combinaciones peligrosas.
- Repos: `CRM-Customer-360`.
- Archivos probables: `.env.example`, `lib/customer-profile/*`, config Customer Profile, docs.
- Tests: CP12, CP16.
- Riesgo: romper algun import historico oculto.
- Criterio de aceptacion: un solo cliente HTTP Customer Profile vivo; production cannot enable unsafe CP path.
- Dependencias: CP-R2-A02 o gate temporal equivalente.
- No incluye: refactor masivo de Agent Tool Loop.

### CP-R2-A07 - Order Status Domain Decision

- Objetivo: decidir si `get_customer_order_status` queda bajo R2 mixto o bajo Postventa/SAC.
- Repos: principalmente `CRM-Customer-360`; Customer Profile solo si falta contrato.
- Tests: order reference, not linked, wrong order, unavailable.
- Riesgo: mezclar ventas con postventa sin ownership.
- Criterio de aceptacion: order status no contamina enrichment comercial.
- Dependencias: CP-R2-A03.
- No incluye: carrier realtime tracking.

## 23. Que No Tocar

No proponer ni iniciar:

- Reescritura de `master_customer`.
- Nuevo identity system paralelo.
- Reescritura del Capability Gateway core.
- Cambios a CommercialWork persistence.
- Cambios a Catalog, Shipping, Quote o Meta.
- Reescritura completa de Customer Profile Service.
- Integracion directa de clustering/copilot a R2.
- Uso de heuristicas por email/telefono/order para resolver identidad en runtime.

## Criterio De Salida

1. Fuente canonica: `customer_external_identity`, filtrando `provider='prestashop'`, `identity_type='prestashop_customer_id'`, `is_verified=1`, desde `master_customer.id`.
2. Colisiones evitadas: nunca se asume igualdad numerica; solo se llama CP con link explicito DB-backed.
3. Endpoints a integrar: profile, commercial-summary, purchase-behavior y purchased-products via capability consolidada; RFM separado; order-status separado por objetivo explicito.
4. Endpoints a no integrar: master-customer legacy RFM, cluster, clustering summary, RFM cross-tab, customer intelligence copilot.
5. Capabilities CommercialWork: `get_customer_commercial_profile`, `get_customer_rfm`, `get_customer_order_status`.
6. Evidence durable: ids de ambos espacios, bridge source, endpoint/capability, fetchedAt, sourceUpdatedAt/snapshot metadata, payload comercial reducido.
7. Realtime vs snapshot: profile/order-status near realtime; commercial summary/history/behavior derived from current DB; RFM/cluster snapshots; copilot derived from snapshots.
8. Sin cuenta PrestaShop: `NOT_LINKED`/`NO_PROFILE_AVAILABLE`, venta continua.
9. Customer Profile caido: system-owned retryable; no `WAITING_CUSTOMER` salvo informacion faltante real del cliente.
10. Flags seguros: mantener `CUSTOMER_PROFILE_ENABLED` como kill switch, pero bloquear uso productivo sin bridge; mantener context off hasta arreglar identidad; retirar `CUSTOMER_PROFILE_SERVICE_*`.
11. Legacy fuera: Bloque A, master-customer RFM legacy para R2, `lib/customer-identity/*` como runtime source, copilot/clustering analytics.
12. Primer slice real: CP-R2-A02, Canonical PrestaShop Identity Bridge.

