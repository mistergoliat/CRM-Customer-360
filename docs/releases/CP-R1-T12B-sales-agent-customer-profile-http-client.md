---
title: CP-R1-T12B - Sales Agent Customer Profile HTTP Client
doc_id: cp-r1-t12b-sales-agent-customer-profile-http-client
status: implemented_pending_full_suite
tags:
  - release
  - customer-profile
  - commercial
  - integration
---

# CP-R1-T12B - Sales Agent Customer Profile HTTP Client

Fecha de implementacion: 2026-08-05.

## 1. Objetivo

Agregar en `CRM-Customer-360` un cliente HTTP tipado y seguro para el
runtime comercial, capaz de consumir el contrato directo de
`MS-pesaschile-customer-profile` basado en `customerId = ps_customer.id_customer`
sin tocar prompt, model tools, agent loop, Customer Profile, Catalog
Service, RFM ni `master_customer`.

## 2. Auditoria inicial

Repositorio auditado antes de editar:

- `lib/`, `tests/`, `package.json`, `.env.example`, runtime config.
- Clientes HTTP existentes: `lib/catalog/httpCatalogAdapter.ts`,
  `lib/catalog/search-products-v2/httpCatalogSearchProductsV2Client.ts`,
  `lib/integrations/customer-service/http-adapter.ts`,
  `lib/customer-profile/httpCustomerProfileAdapter.ts`.
- Capability Gateway y agent loop: `lib/brain/commercial/capability-gateway/*`,
  `lib/brain/commercial/agent-loop/*`, `tests/agent-loop/*`.
- Observabilidad y sanitizacion: `lib/brain/commercial/redactErrorMessage.ts`,
  `lib/audit.ts`, logs estructurados puntuales en dominios existentes.

Busquedas ejecutadas:

- `fetch(`, `timeout`, `AbortController`, `retry`, `service unavailable`
- `customer profile`, `customerId`, `prestashopCustomerId`, `masterCustomerId`
- `shipping`, `order status`, `observability`, `console.*`

Hallazgos clave:

- El repo no usa `src/`; la convencion real vive en `lib/`.
- Ya existia `lib/customer-profile/httpCustomerProfileAdapter.ts` (T10B1),
  pero responde a otro contrato: `masterCustomerId: string`,
  `CUSTOMER_PROFILE_SERVICE_*` y solo dos endpoints.
- El patron reusable mas robusto del repo para este trabajo era
  `lib/catalog/search-products-v2/httpCatalogSearchProductsV2Client.ts`:
  config estructural estricta, `redirect: "error"`, timeout por request,
  validacion runtime estricta, cliente disabled/fail-closed y tests con
  servidor HTTP local.
- No existe una politica reusable de retry HTTP tecnico para introducir aqui
  sin crear infraestructura nueva. Se mantuvo `sin retry automatico`.
- No existe una infraestructura reusable de metricas para este cliente.
  Se eligio logging estructurado seguro por llamada.

### Matriz inicial

| CAPABILITY | CURRENT IMPLEMENTATION | REUSABLE PATTERN | CONFLICT | TARGET DESIGN | CHANGE REQUIRED |
| --- | --- | --- | --- | --- | --- |
| Customer Profile HTTP | `lib/customer-profile/httpCustomerProfileAdapter.ts`, dos endpoints, `masterCustomerId`, envs legacy `*_SERVICE_*` | fetch + AbortController + parseo defensivo | identidad, envs, endpoints y taxonomy no coinciden con T12B | cliente nuevo directo por `customerId` | modulo nuevo |
| Catalog SearchProducts V2 | cliente estricto con config validada y tests HTTP locales | mejor patron del repo para config/errores/tests | contrato POST y response distintos | reutilizar estructura, no tipos | adaptar patron |
| Customer Service HTTP | puerto + resultado discriminado fail-closed | boundary dominio sin HTTP crudo | menos estricto en URL/provenance | mantener principio | endurecer |
| Capability Gateway / Agent Loop | wiring productivo del modelo y capacidades gobernadas | convencion de naming y boundaries | T12B prohibe exponerlo al modelo ahora | capability interna no registrada | dejar fuera del loop |
| Observabilidad | logs estructurados puntuales, sin capa comun de metricas | logging seguro sin PII | no hay contadores reutilizables | observacion por llamada | logger local del cliente |

## 3. Arquitectura

Se agrego un modulo nuevo en `lib/integrations/customer-profile/` para no
romper el adapter legacy de T10B1:

- `types.ts`
- `schemas.ts`
- `http-client.ts`
- `index.ts`

El puerto de aplicacion implementado es:

```ts
interface CustomerProfileClient {
  getProfile(input: GetCustomerProfileInput): Promise<CustomerProfileResult>;
  getCommercialSummary(input: GetCommercialSummaryInput): Promise<CustomerCommercialSummaryResult>;
  getPurchasedProducts(input: GetPurchasedProductsInput): Promise<CustomerPurchasedProductsResult>;
  getPurchaseBehavior(input: GetPurchaseBehaviorInput): Promise<CustomerPurchaseBehaviorResult>;
  getOrderStatus(input: GetCustomerOrderStatusInput): Promise<CustomerOrderStatusResult>;
  checkReadiness(input?: { requestId?: string }): Promise<CustomerProfileReadinessResult>;
}
```

Implementaciones:

- `createHttpCustomerProfileClient(config)`
- disabled mode via `createCustomerProfileClient()` when
  `CUSTOMER_PROFILE_ENABLED=false`
- singleton lazy para wiring futuro:
  `getSharedCustomerProfileClient()`

Capability interna de aplicacion, todavia no registrada en el Gateway ni en
el model tool loop:

- `lib/brain/commercial/capabilities/customer-profile/*`

## 4. Configuracion

Variables nuevas:

- `CUSTOMER_PROFILE_ENABLED=false`
- `CUSTOMER_PROFILE_BASE_URL=`
- `CUSTOMER_PROFILE_TIMEOUT_MS=3000`
- `CUSTOMER_PROFILE_AUTH_TOKEN=`

Reglas implementadas:

- `CUSTOMER_PROFILE_ENABLED=false` -> cliente disabled, cero llamadas HTTP.
- `CUSTOMER_PROFILE_ENABLED=true` -> `CUSTOMER_PROFILE_BASE_URL` requerido.
- `CUSTOMER_PROFILE_AUTH_TOKEN` es opcional.
- `CUSTOMER_PROFILE_TIMEOUT_MS` debe ser entero positivo `<= 30000`.
- URL absoluta `http/https`, sin credenciales embebidas, query ni fragment.

Archivo actualizado:

- `.env.example`

## 5. Contratos

Se portaron los contratos productivos reales desde
`MS-pesaschile-customer-profile`:

- `GET /v1/customers/:customerId/profile`
- `GET /v1/customers/:customerId/commercial-summary`
- `GET /v1/customers/:customerId/purchased-products`
- `GET /v1/customers/:customerId/purchase-behavior`
- `GET /v1/customers/:customerId/orders/:reference/status`
- `GET /health/ready`

Identidad publica del cliente:

```ts
type CustomerProfileCustomerId = number;
```

Validaciones locales:

- `customerId`: entero, positivo, seguro.
- `limit`: `1..100`
- `offset`: `>= 0`
- `topProducts`: `1..10`
- `topVariants`: `1..10`
- `orderReference`: alfanumerica, `1..32`, sin trim silencioso.

## 6. Provenance

El cliente valida obligatoriamente:

- `provenance.customerIdentity.customerId`
- `provenance.customerIdentity.source`
- `provenance.customerIdentity.externalCustomerId`
- `provenance.customerIdentity.status`
- `provenance.dataSources`
- `provenance.generatedAt`
- `provenance.contractVersion`

Contrato actual aceptado:

- `source = PRESTASHOP`
- `status = DIRECT_SOURCE`
- `contractVersion = customer-profile-prestashop-direct-v1`

Si `requestedCustomerId !== provenance.customerIdentity.customerId`, el
cliente devuelve:

- `CONTRACT_ERROR / PROVENANCE_MISMATCH`

## 7. Mapeo HTTP

Resultado canonico expuesto al dominio:

- `AVAILABLE`
- `NOT_FOUND`
- `INVALID_REQUEST`
- `UNAVAILABLE`
- `CONTRACT_ERROR`

Mapeo aplicado:

- `2xx + JSON valido + schema valido` -> `AVAILABLE`
- `2xx + JSON invalido / body vacio` -> `UNAVAILABLE / CUSTOMER_PROFILE_UNAVAILABLE`
- `2xx + schema incompatible` -> `CONTRACT_ERROR / INVALID_RESPONSE`
- `400` -> `INVALID_REQUEST`
- `404 customer_not_found` -> `NOT_FOUND / CUSTOMER_NOT_FOUND`
- `404 order_not_found` -> `NOT_FOUND / ORDER_NOT_FOUND`
- `408` o timeout local -> `UNAVAILABLE / CUSTOMER_PROFILE_TIMEOUT`
- `429` -> `UNAVAILABLE / CUSTOMER_PROFILE_UNAVAILABLE`, `retryable=true`
- `500/502/504` -> `UNAVAILABLE / CUSTOMER_PROFILE_UNAVAILABLE`, `retryable=true`
- `503 prestashop_unavailable` -> `UNAVAILABLE / PRESTASHOP_UNAVAILABLE`
- `503 prestashop_schema_incompatible` -> `UNAVAILABLE / PRESTASHOP_SCHEMA_INCOMPATIBLE`
- `503 customer_profile_unavailable` -> `UNAVAILABLE / CUSTOMER_PROFILE_UNAVAILABLE`

## 8. Timeout

- Timeout por request con `AbortController`.
- Default: `3000 ms`.
- `redirect: "error"` para no seguir redirecciones automaticas.

## 9. Retry

Decision real de esta tarea:

- `sin retry automatico`

Motivo:

- no existe un helper/politica reusable equivalente en este repo para
  retries HTTP tecnicos;
- introducirlo aqui habria agregado infraestructura nueva no pedida;
- el cliente sigue marcando `retryable=true` en los estados tecnicos para que
  el wiring futuro (`CP-R1-T12C`) decida si reintentar o degradar.

## 10. Seguridad

Medidas implementadas:

- no se loguean token, email, RUT, referencias de orden, nombres completos,
  payloads ni stacks;
- `Authorization` solo se envia si `CUSTOMER_PROFILE_AUTH_TOKEN` existe;
- nunca se envian secretos por query params;
- el cliente no persiste payloads ni los reexpone en errores;
- `redactErrorMessage` se reutiliza como defensa en profundidad en fallas de
  red/captura.

## 11. Observabilidad

Cada llamada registra una observacion estructurada segura:

- `service`
- `operation`
- `requestId`
- `customerId`
- `referencePresent`
- `status`
- `reason`
- `httpStatus`
- `durationMs`
- `contractVersion`
- `identitySource`

Sin PII ni payload completo.

## 12. Capability interna

Se agrego una capability de aplicacion, no model-facing:

- `createCustomerProfileCapabilities(...)`
- `createProductionCustomerProfileCapabilities()`

Exportada desde:

- `lib/brain/commercial/capabilities/customer-profile/`

No se toco:

- `Capability Gateway`
- `tool allowlist`
- `agent loop`
- `prompt`
- `SalesAgentOutput`

## 13. Resultados por endpoint

- `getProfile`: snapshot base, customer/prestashop/recentOrders/provenance.
- `getCommercialSummary`: resumen comercial historico, sin reinterpretarlo
  como RFM/LTV.
- `getPurchasedProducts`: paginacion validada, items historicos intactos.
- `getPurchaseBehavior`: concentracion/repeticion/top products/top variants,
  sin convertirlos en decision comercial.
- `getOrderStatus`: status de orden scoped por `customerId + reference`.
- `checkReadiness`: diagnostico de despliegue, sin uso productivo por request.

## 14. Tests

Archivos nuevos:

- `tests/customer-profile-client/customerProfileSchemas.test.ts`
- `tests/customer-profile-client/httpCustomerProfileClient.test.ts`
- `tests/customer-profile-client/customerProfileCapabilities.test.ts`

Cobertura agregada:

- config disabled/enabled/URL/timeout;
- headers y rutas por endpoint;
- defaults de query params;
- GET sin body;
- disabled client;
- validacion runtime y strict schema;
- contract version;
- provenance mismatch;
- 400 / 404 / 429 / 500 / 503 / timeout / network error;
- logging seguro;
- no retry interno;
- capability interna.

Validacion ejecutada el 2026-08-05:

- `npm run typecheck` -> ok
- `npm run lint` -> ok con warnings preexistentes fuera de T12B
- `npm run build` -> ok con los mismos warnings preexistentes
- `npx --yes tsx@4.20.5 --test "tests/customer-profile-client/**/*.test.ts"` -> ok, `27/27`
- `npm test` -> no quedo verde por baseline externo: tests nativos que requieren
  MySQL local fallan con `ECONNREFUSED 127.0.0.1:3306`

## 15. Smoke test

No se ejecuto smoke test contra un Customer Profile real/local en esta tarea.
La ausencia de ese servicio no bloqueo la validacion del cliente porque toda
la cobertura de CI usa servidor HTTP local sintetico.

## 16. Riesgos

- El repo ahora convive con dos integraciones Customer Profile:
  `lib/customer-profile/*` (legacy `masterCustomerId`) y
  `lib/integrations/customer-profile/*` (nuevo `customerId` directo). Esa
  dualidad es deliberada para no romper T10B1/T10B2/T10B6, pero debe
  converger mas adelante.
- `400` del upstream se clasifica como `INVALID_REQUEST`; como el cliente ya
  valida localmente casi todos los inputs, ese caso deberia ser raro y puede
  merecer afinacion cuando T12C haga wiring real.
- No hay retry automatico; eso queda delegado al wiring futuro.
- La suite completa del repo no es autocontenida en este entorno sin MySQL
  local; el baseline actual falla en tests `native/*` ajenos a este cliente.

## 17. Veredicto

`CUSTOMER_PROFILE_CLIENT_VALIDATED_WITH_CONTRACT_LIMITATIONS`

Condiciones cumplidas:

- `CUSTOMER_PROFILE_CLIENT_AVAILABLE`
- `CUSTOMER_PROFILE_DISABLED_MODE_AVAILABLE`
- `CUSTOMER_PROFILE_RESPONSES_RUNTIME_VALIDATED`
- `PROVENANCE_VALIDATED`
- `CONTRACT_VERSION_VALIDATED`
- `ERRORS_SANITIZED`
- `PII_SAFE_LOGGING`
- `READY_FOR_AGENT_LOOP_WIRING`
- `RFM_NOT_EXPOSED`
- `MASTER_CUSTOMER_NOT_REQUIRED`

## 18. Siguiente tarea

`CP-R1-T12C - Customer Profile Commercial Context Wiring`
