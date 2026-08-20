# SALES-AGENT-R2-A11.3 - Integration Contract Audit (Catalog / Quote / Customer Profile / Shipping)

Estado: auditoria transversal, sin cambios de codigo. Alcance: confirmar el patron que
[A11.2](./SALES-AGENT-R2-A11.2-catalog-service-integration-audit.md) encontro en Catalog
Service (microservicio real evoluciona -> CRM conserva un adapter/contrato viejo -> el
Gateway/CommercialWork "parecen integrados" pero consumen una capacidad inferior) en los otros
tres microservicios reales que CommercialWork ya usa o podria usar: Quote Service, Customer
Profile, Shipping/Carrier MS. No rediseña nada - solo clasifica cada servicio como
`CURRENT` / `OUTDATED` / `PARTIAL` / `NOT_WIRED` con evidencia de codigo.

## Resumen

| Servicio | Clasificacion | Una linea |
|---|---|---|
| Catalog | **OUTDATED / PARTIAL** | `search_products` apunta al endpoint legacy simple; T12 (el resolver de lenguaje natural que ya existe) nunca se conecta. Ver A11.2. |
| Quote | **PARTIAL (por alcance explicito, no por drift)** | Solo `create_quote` existe como capability - el ciclo de vida completo (aceptar, marcar pagada, cancelar, revisar, consultar estado) esta implementado en el servicio real y sin cablear en CRM. |
| Customer Profile | **NOT_WIRED como capability activa** (los datos basicos SI llegan, pero solo como contexto pasivo de prompt) | Ni Gateway, ni step de CommercialWork, ni herramienta consultable - y ademas usa la ruta de RFM vieja (`masterCustomerId`) en vez de la nueva primaria (`customerId`) que el propio servicio ya declara canonica. |
| Shipping | **CURRENT** (con una salvedad de auditabilidad) | `calculate_shipping` esta completo y cableado en ambos runtimes; no hay repo local de Carrier MS para verificar contra una fuente de verdad real, a diferencia de los otros tres. |

La lectura que el usuario propuso antes de esta auditoria (Catalog PARTIAL/outdated
confirmado, Quote probablemente PARTIAL, Customer Profile NOT WIRED, Shipping probablemente
CURRENT) **se confirma en los cuatro casos**, con un matiz importante: Quote no es drift (el
servicio no "evoluciono y CRM no se dio cuenta") sino alcance deliberadamente angosto,
documentado en el propio codigo desde el dia uno. Customer Profile si tiene un caso de drift
identico al de Catalog (RFM: ruta legacy vs primaria).

---

## CATALOG

Ya auditado en profundidad en A11.2 y A11.2-A2 - no se repite aqui. Resumen de una linea para
la matriz: `search_products` -> `/v1/products/search` (legacy, con un bug de stopwords real,
probado en vivo) en vez de `/api/v2/catalog/resolve-product-intent` (T12, disenado para
lenguaje natural, con sinonimos y clarificacion estructurada, ya existente y sin conectar).
`RECOMMEND_PRODUCTS`/`explore_catalog` registrados en el Gateway pero sin step ejecutable en
CommercialWork.

---

## QUOTE

### 1. Que expone realmente hoy el microservicio

`MS-pesaschile-quote-service/src/http/routes/quote-route.ts:217-687`, prefijo `/v1/quotes`,
autenticado por `Authorization` (service token, `service-auth.ts`) + `Idempotency-Key` en toda
mutacion. 15 endpoints reales:

`POST /` (crear draft), `GET /by-number/:quoteNumber`, `GET /` (listar, con filtros
opportunityId/status/revisionRootId), `PUT /:quoteId/draft` (actualizar draft),
`POST /:quoteId/issue`, `POST /:quoteId/accept`, `POST /:quoteId/mark-paid`,
`POST /:quoteId/cancel`, `POST /:quoteId/expire`, `POST /:quoteId/revisions`,
`GET /:quoteId/documents`, `GET /:quoteId/audit`, `POST /:quoteId/send-email`,
`GET /:quoteId/deliveries`, `GET /:quoteId/deliveries/:deliveryId`, `GET /:quoteId`.

Es un ciclo de vida completo con maquina de estados real (draft -> issued -> accepted/
mark-paid/cancelled/expired, mas revisiones), auditoria (`/audit`), documentos emitidos
(`/documents`) y entrega por email con tracking (`/deliveries`).

### 2-3. Que consume CRM hoy / capability del Gateway

`lib/domains/quote-service/ports.ts:29-38` (`QuoteServicePort`) implementa exactamente **8 de
los 15** endpoints reales: `createQuote`, `updateDraft`, `issueQuote`, `sendQuoteEmail`,
`getQuote`, `getQuoteByNumber`, `getQuoteDelivery`, `listQuoteDeliveries`. El propio comentario
del port (lineas 14-27) lo dice explicitamente: "No acceptQuote/markQuotePaid/cancelQuote/
expireQuote/createRevision/listQuotes/getQuoteDocuments/getQuoteAuditEvents - all real
endpoints on the actual service today, intentionally not wrapped here to keep this port's
surface matched to what T1 was asked to deliver."

Del lado del Gateway, **solo existe una capability**: `create_quote`
(`lib/brain/commercial/capability-gateway/createQuoteCapability.ts:68-181`). No hay
`accept_quote`, `check_quote_status`, `cancel_quote`, ni ninguna otra - confirmado contra el
inventario completo de `CAPABILITY_GATEWAY_REGISTRY` (A11.2 Parte 2).

### 4. Step de CommercialWork

`CREATE_QUOTE` unicamente - esta en `EXECUTABLE_STEP_TYPES`
(`commercialWorkExecutor.ts:23`), derivado desde el objective `CREATE_QUOTE`
(`deriveCommercialObjectives.ts`/`semanticIntentAdapter.ts:88-91`, disparado por el intent
`create_quote` del planner). No existe ningun step ni objective para consultar, aceptar,
cancelar o revisar una cotizacion ya creada.

### 5. Contrato CRM actualizado o desactualizado

**Ni una cosa ni la otra - deliberadamente incompleto por alcance, no por desactualizacion.**
A diferencia de Catalog (donde el servicio agrego T12 despues de que CRM ya se habia
integrado, sin que nadie volviera a conectar), aqui el propio T1 (SALES-AGENT-R1-T1) documento
en su propio codigo que dejaba fuera 7 endpoints reales que ya existian. Es deuda tecnica
reconocida desde el origen, no un descubrimiento de esta auditoria.

### 6. Que evidencia persiste

`lib/domains/created-quote/service.ts` (`setCreatedQuoteForOpportunity`/
`getActiveCreatedQuoteForOpportunity`): `quoteId`, `quoteNumber`, `status`, `currency`,
`total`, `validUntil`, `selectionFactId` (para detectar si la seleccion cambio y evitar
reusar una cotizacion obsoleta), `idempotencyKey`. Mecanismo de reuso: si la seleccion
comercial activa coincide con la que genero la ultima cotizacion, `create_quote` devuelve
`status: "reused"` sin llamar de nuevo al servicio (`createQuoteCapability.ts:118-128`) -
bien disenado, sin duplicacion de cotizaciones.

### 7. Errores/retries que entiende

`classifyQuoteServiceErrorCode`/`isRetryableQuoteServiceErrorClass`
(`lib/domains/quote-service/errors.ts`) mapean codigos HTTP/de negocio del servicio a
retryable/no-retryable. Errores de **ensamblado** (`assembleQuoteInput`, ej. seleccion
faltante, catalogo no disponible) se distinguen de errores **tecnicos del servicio real**
(`mapQuoteServiceErrorToOutcome`) - los primeros nunca son "system-owned catalogado como
customer-owned" por error, los segundos se marcan `temporarily_blocked`/`failed` segun la
clase. `maxRetries: 0` a nivel de capability (createQuoteCapability.ts:78) - el reintento, si
existe, es responsabilidad exclusiva del Gateway.

### 8. Funcionalidad nueva del servicio invisible para R2

Toda la posterior a la creacion: aceptacion del cliente, marca de pago, cancelacion,
expiracion, revisiones (ej. el cliente pide cambiar el `validUntil`), consulta de estado por
numero de cotizacion fuera del flujo de creacion, historial de auditoria, y tracking de si el
email con la cotizacion realmente se entrego. Para un sistema cuyo objetivo es cerrar ventas,
esto es una brecha real: hoy el agente puede crear una cotizacion pero es ciego a que pasa con
ella despues - no puede confirmarle al cliente "tu cotizacion fue aceptada" ni reenviarla ni
saber si expiro, aunque el servicio ya soporta todo eso.

---

## CUSTOMER PROFILE

### 1. Que expone realmente hoy el microservicio

`MS-pesaschile-customer-profile/src/http/routes/index.ts:128-757`. Mucho mas alla de RFM:

- `GET /v1/customers/:customerId/profile` - perfil general + ordenes recientes.
- `GET /v1/customers/:customerId/commercial-summary` - resumen comercial (ordenes totales,
  primera/ultima compra, gasto historico).
- `GET /v1/customers/:customerId/purchased-products` - productos comprados, paginado.
- `GET /v1/customers/:customerId/purchase-behavior` - top productos/variantes, concentracion
  de gasto, productos repetidos.
- `GET /v1/customers/:customerId/orders/:reference/status` - estado de una orden especifica.
- `GET /v1/customers/:customerId/rfm` - **RFM path PRIMARIO**, identidad `customerId =
  ps_customer.id_customer` (CRM-independiente). Comentario propio del servicio (linea 502-506):
  "consistent with the other five endpoints above and CRM-independent."
- `GET /v1/master-customers/:masterCustomerId/rfm` - **RFM path LEGACY/SECUNDARIO**, identidad
  `masterCustomerId = master_customer.id` (espacio CRM). Comentario propio (linea 542-545):
  movido a su propio prefijo de ruta explicitamente para que nunca se confunda con el
  primario.
- `GET /v1/customers/:customerId/cluster` - clustering de comportamiento (CP-R2-T02),
  snapshot publicado mas reciente.
- `GET /v1/clustering/snapshots/latest/summary` y `/rfm-cross-tab` - analitica de clustering
  (CP-R2-T03): distribucion poblacional, perfiles por cluster, cruce cluster x RFM.
- `GET /v1/clustering/snapshots/:snapshotId/summary` - reproducibilidad historica.
- `POST /v1/customer-intelligence/copilot` + `/copilot/sessions/*` (crear, mensaje, refresh,
  reset, delete, export a xlsx) - un **copiloto de analitica en lenguaje natural**, con
  sesiones persistentes y export de queries, protegido por un token interno separado
  (`x-internal-copilot-token`).

### 2-3. Que consume CRM hoy / capability del Gateway

`lib/integrations/customer-profile/index.ts` (cliente HTTP unico, consumido via
`getSharedCustomerProfileClient`) expone exactamente 6 operaciones de lectura: `getProfile`,
`getCommercialSummary`, `getPurchasedProducts`, `getPurchaseBehavior`, `getOrderStatus`,
`getRfm`. **Cero** wiring para `getCustomerCluster`, `getClusterSnapshotSummary`,
`getRfmClusterCrossTab`, o el customer-intelligence-copilot (ese ultimo si tiene su propio
consumidor, pero es `lib/marketing/customerIntelligenceCopilot.ts` - Marketing, no
CommercialWork/Sales Agent; fuera del alcance de esta auditoria, mencionado solo para
que quede registrado que no es "no wireado en ningun lado", es "no wireado en el dominio
comercial").

**No existe ninguna capability de Customer Profile en `CAPABILITY_GATEWAY_REGISTRY`.**
`lib/brain/commercial/capabilities/customer-profile/customerProfileCapabilities.ts` (notese:
carpeta `capabilities/`, NO `capability-gateway/` - una capa distinta, mas antigua/interna,
que tambien aloja `catalog-recommendation`) es un wrapper tipado simple sobre el cliente HTTP,
consumido exclusivamente por `loadCustomerCommercialHistoryContext`
(`lib/brain/commercial/customer-profile-context/loader.ts:204-404`) para construir contexto
de prompt - nunca pasa por `executeGovernedCapability`, nunca queda en
`crm_capability_executions`, nunca es una decision que el LLM pueda tomar ("consulta el
perfil de este cliente") ni un step de CommercialWork.

### 4. Step de CommercialWork

**Ninguno.** Confirmado por grep: cero referencias a `loadCustomerCommercialHistoryContext`,
`customerProfileCapabilities`, `getCustomerCluster` o `customerIntelligenceCopilot` en todo
`lib/brain/commercial/work/` (el arbol de R2). El contexto de Customer Profile es exclusivo
del Agent Tool Loop legacy - inyectado en el prompt via
`commercialContext.customerPurchaseHistory`/`commercialContext.customerRfm`
(`buildAgentStepPromptPackage.ts`'s `CUSTOMER_PURCHASE_HISTORY_RULE_LINES`/
`CUSTOMER_RFM_RULE_LINES`, ya vistas en A11.2-A2). **R2 no tiene acceso a esta informacion en
absoluto, ni siquiera como contexto pasivo.**

### 5. Contrato CRM actualizado o desactualizado

**Desactualizado - mismo patron exacto que Catalog.** `loader.ts:233-238` llama
`customerProfileCapabilities.getRfm({ masterCustomerId, ... })` - la ruta **legacy/secundaria**
(`/v1/master-customers/:masterCustomerId/rfm`). Nunca llama `getCustomerRfmByCustomerId` (la
ruta primaria, `customerId`-keyed, que el propio servicio documenta como la canonica y
CRM-independiente desde `CP-R1-RFM-data-ownership-crm-architecture-audit.md`). Es el mismo
tipo de hallazgo que T12 en Catalog: el microservicio ya senala cual es el camino correcto en
su propio codigo/docs, y el adapter de CRM sigue apuntando al anterior.

### 6. Que evidencia persiste

Ninguna en `crm_capability_executions` (no pasa por el Gateway). El resultado de
`loadCustomerCommercialHistoryContext` vive solo en memoria durante la construccion del
prompt de ese turno - no hay auditoria persistente de que datos de Customer Profile vio el
modelo en una conversacion dada, a diferencia de toda capability real de catalogo/shipping/
quote.

### 7. Errores/retries que entiende

`mapUnavailableReason`/`mapContractReason` (`loader.ts:79-85`) distinguen timeout,
no disponible, degradado y error de contrato - pero como resultado, no como retry: no hay
reintento, la llamada se hace una vez por turno y si falla el contexto queda `PARTIAL` o
`UNAVAILABLE` para ese turno unicamente. No aplica el concepto de `WAITING_SYSTEM`/retry de
CommercialWork porque no hay step que lo posea.

### 8. Funcionalidad nueva del servicio invisible para R2 (y para legacy tambien, salvo RFM/perfil basico)

Clustering de comportamiento (`getCustomerCluster`) y toda su analitica (summary, cross-tab
RFM x cluster) - cero consumo comercial. El copiloto de inteligencia de cliente - consumido
solo por Marketing, nunca por el Sales Agent. La ruta RFM primaria (`customerId`-keyed) -
nunca llamada, ni por legacy ni por R2.

---

## SHIPPING / CARRIER MS

**Limitacion metodologica explicita**: a diferencia de los tres servicios anteriores, no
existe un repo local de Carrier MS (`ms.pesaschile.cl`) - es un servicio externo, sin sibling
repo bajo `Pesas Chile/MS`. No se probo en vivo (es produccion real, no una instancia de
desarrollo con réplica de solo lectura como el Catalog Service en A11.2). Esta seccion audita
unicamente el lado CRM; "CURRENT" aqui significa "internamente completo y consistente con lo
que CRM ya integra", no "verificado contra el contrato real completo del servicio" como si
pudo hacerse con Catalog/Quote/Customer Profile.

### 1-3. Que expone el servicio segun el contrato CRM / que consume CRM / capability

`lib/domains/carrier-service/ports.ts:4-6` (`CarrierService`): **una sola operacion**,
`quoteAll(input): Promise<CarrierQuoteResult>`. La capability `calculate_shipping`
(`lib/brain/commercial/capability-gateway/calculateShippingCapability.ts:72-211`) es
exactamente ese contrato completo - no hay indicio (en el codigo CRM) de una operacion
adicional sin usar, a diferencia de los tres casos anteriores donde el sibling repo revelo
endpoints reales huerfanos.

### 4. Step de CommercialWork

`CALCULATE_SHIPPING`, en `EXECUTABLE_STEP_TYPES`, ejecutable en ambos runtimes (confirmado en
A11.2-A2 - `select_products`/`calculate_shipping` cableados end-to-end, memoria previa
`crm-r1-t13-shipping-status`).

### 5. Contrato actualizado o desactualizado

No hay evidencia de desactualizacion desde el lado CRM. Sin poder leer el codigo real de
Carrier MS, esta conclusion es mas debil que las de los otros tres servicios - se documenta
como tal, no como una garantia.

### 6. Que evidencia persiste

`selectionFactId`/`destinationFactId` (versiones de los facts durables usados para calcular)
se guardan en la respuesta pero se **excluyen explicitamente** de lo que ve el modelo
(`calculateShippingCapability.ts:199-205`, `buildToolObservation.ts`'s
`projectCalculateShipping` allowlist) - existen solo para que `select_shipping_option` pueda
detectar si la seleccion o el destino cambiaron entre el calculo y la eleccion del cliente
(staleness), un mecanismo de evidencia mas sofisticado que el de Quote o Catalog.

### 7. Errores/retries

Fallos cerrados en cada paso: sin destino -> `shipping_destination_required`; sin seleccion ->
`commercial_items_required`; catalogo no disponible -> `technicalFailure` retryable; peso/precio
no resoluble -> `weight_unavailable`/`price_unavailable` (informativo, no tecnico); Carrier MS
sin cobertura -> `no_shipping_options` (resultado de negocio valido, no error); fallo tecnico
de Carrier MS -> `temporarily_blocked` salvo `carrier_invalid_response` (no retryable). Ningun
gap sistema-vs-cliente detectado.

### 8. Funcionalidad nueva invisible

No determinable sin el repo real - unico caso de los cuatro donde esta pregunta queda
genuinamente abierta.

---

## Gaps consolidados y siguiente paso

| Servicio | Gap principal | Riesgo si se sigue extendiendo R2 sin corregirlo |
|---|---|---|
| Catalog | `search_products` no usa T12 (A11.2) | Ya materializado en produccion (el bug reportado) |
| Quote | Sin capability de ciclo de vida post-creacion | El agente no puede dar seguimiento a una cotizacion ya enviada - silencio o informacion inventada si se le pregunta |
| Customer Profile | R2 no tiene acceso a historial/RFM en absoluto; legacy usa la ruta RFM vieja | Cualquier feature de R2 que dependa de contexto de cliente (personalizacion, segmentacion) partira de cero; RFM inconsistente entre servicios si algun dia divergen los dos IDs |
| Shipping | Ninguno detectado desde CRM | Bajo, pero no verificado contra la fuente real |

Esta auditoria no propone slices de implementacion (no fue pedido, y el criterio explicito de
la tarea es "no rediseñar, detectar temprano"). El paso natural, si se decide actuar, es
priorizar por probabilidad de impacto en produccion: Catalog ya esta resuelto en A11.2;
Customer Profile tiene el gap mas amplio (una capa entera de datos invisible para R2) pero
tambien el menor riesgo inmediato de romper algo (nadie lo consume hoy en R2, asi que no hay
regresion posible al no tocarlo); Quote tiene el riesgo mas concreto de cara al cliente
(cotizaciones "huerfanas" sin seguimiento) si el volumen de uso autonomo crece.

## Veredicto

Catalog: OUTDATED/PARTIAL (confirmado en A11.2). Quote: PARTIAL (alcance, no drift). Customer
Profile: NOT_WIRED en el dominio comercial, mas un caso de drift real en la ruta RFM. Shipping:
CURRENT, con la salvedad de no poder verificarse contra la fuente real. El patron que origino
esta auditoria (contract drift entre microservicio real, adapter/port de CRM, Capability
Gateway y CommercialWork) se confirma como real y recurrente, no como una coincidencia
aislada de Catalog.
