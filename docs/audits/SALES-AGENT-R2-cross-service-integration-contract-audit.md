# SALES-AGENT-R2 - Cross-Service Integration Contract Audit

Estado: auditoria transversal consolidada, sin cambios de codigo. Consolida y extiende A10, A11.1,
A11.2, A11.2-A2 y A11.3 - no las repite. Alcance: CRM-Customer-360, Catalog Service, Quote Service,
Customer Profile, Shipping/Carrier MS, mas cualquier microservicio adicional consumido directamente
por R2/CommercialWork descubierto durante la auditoria (ninguno adicional encontrado).

Repos y HEAD verificados en esta auditoria (2026-08-24):
- `CRM-Customer-360`, rama `develop`, HEAD al momento de escribir este documento.
- `MS-pesaschile-quote-service`: HEAD real `a2bc2cf` (2026-08-13) - sin cambios desde A11.3.
- `MS-pesaschile-customer-profile`: HEAD real `61f6d94` (2026-08-21) - commits nuevos desde A11.3
  confirmados como capas internas de analitica/copiloto, sin tocar `src/http/routes/index.ts`.
- `MS-Stock/services` (Catalog Service): HEAD real `ce4beba` - identico al HEAD que audito A11.2,
  cero commits desde entonces.
- Carrier MS: sin repo local, sin cambios verificables (misma limitacion que A11.3).

Documentos leidos y usados como base, no repetidos: `SALES-AGENT-R2-A10-capability-coverage-runtime-correctness-audit.md`,
`SALES-AGENT-R2-A11-autonomous-runtime-operationalization-controlled-rollout.md`,
`SALES-AGENT-R2-A11.1-owner-only-live-fixes-product-discovery.md`,
`SALES-AGENT-R2-A11.2-catalog-service-integration-audit.md`,
`SALES-AGENT-R2-A11.2-A2-legacy-catalog-flow-recovery-audit.md`,
`SALES-AGENT-R2-A11.3-integration-contract-audit.md`,
`SALES-AGENT-R2-capability-coverage-matrix.md`.

---

## Resumen ejecutivo

El patron que origino esta linea de auditorias (Catalog: microservicio evoluciona, CRM se queda
en un contrato viejo, Gateway/CommercialWork "parecen integrados" pero consumen una capacidad
inferior) **se confirma como recurrente en los cuatro servicios**, pero con matices distintos por
servicio, y esta auditoria encuentra **tres hallazgos nuevos de severidad real que ninguna
auditoria anterior habia detectado**, dos de ellos en el camino que A11 ya ejecuta en vivo hoy:

1. **Bug de idempotencia real en `create_quote`** (P0, camino en vivo): `validUntil` se recalcula
   en cada llamada y entra en el hash que el Quote Service usa para deduplicar reintentos. Un
   reintento tras un fallo de persistencia local en CRM genera una cotizacion real y valida en el
   servicio que CRM no puede recuperar - queda huerfana, marcada `failed` en CRM, inexistente para
   el cliente aunque exista de verdad en el Quote Service.
2. **`SELECT_SHIPPING_OPTION` no es solo un step "no ejecutable"** (P0 latente): esta completamente
   modelado (tipo, objetivo, familia de supersesion, derivador, proyeccion, mensajes) pero la capa
   semantica (el planner) no tiene forma de generarlo nunca, y si alguna vez se generara, el
   `CommercialWork` completo quedaria atascado permanentemente en `ACTIVE`, invisible para el
   worker de retry. Es una mina de tierra para quien conecte esto sin saberlo.
3. **El problema de identidad de Customer Profile no esta aislado a RFM** (P0 latente, hoy inerte
   por flag apagado): `identity.customerId` de la sesion nativa siempre es un `master_customer.id`
   de CRM, nunca un `ps_customer.id_customer` de PrestaShop - afecta las 5 operaciones
   `customerId`-keyed restantes (perfil, resumen comercial, productos comprados, comportamiento de
   compra, estado de orden), no solo RFM como decia A11.3.

Ademas se confirma un hallazgo estructural nuevo sobre el propio CRM: existen **cuatro runtimes**,
no tres - un runtime multi-request con **su propio sistema de capabilities paralelo al Gateway**
(`READ_CAPABILITY_REGISTRY`), con prioridad de enrutamiento mayor que el Agent Tool Loop, que
reutiliza literalmente el nombre `search_products` para una implementacion distinta (SQL directo
contra la replica de PrestaShop) y nunca escribe en `crm_capability_executions`.

Veredicto global: **CROSS_SERVICE_INTEGRATION_PARTIAL**. Ver Parte 19 para veredictos individuales
y Parte 14 para la lista priorizada de gaps.

---

## Parte 1 - Inventario por microservicio (consolidado)

### Catalog Service

Ya auditado exhaustivamente en A11.2 (20 partes) y A11.2-A2 - no se repite. Resumen de referencia:
6 endpoints operativos (`/v1/products/search|:productId|batch|explore`, `/api/v2/catalog/resolve-product-intent`
[T12], `/api/v2/recommendations/search-products` [T11]). `search_products` de CRM apunta al
endpoint legacy en vez de T12; el bug real de 0-resultados es un fallo de stopwords en el
retrieval SQL compartido por ambos endpoints. Cero cambios en el servicio ni en el codigo CRM
relevante desde A11.2 (verificado arriba). Los 3 commits nuevos en `lib/catalog/` desde A11.2
(`fc7c4cb`/`2f13477`/`137232c`) son exclusivamente el panel de administracion de catalogo del Hub
(`lib/catalog/consoleService.ts`, `app/(hub)/catalog/**`) - ver Parte 7, bypass #5, clasificado
`LEGITIMATE_INTERNAL`. No tocan `registry.ts`, ninguna capability, ni CommercialWork.

| Endpoint | Version/track | Proposito | R/W | CRM lo consume | Estado |
|---|---|---|---|---|---|
| `GET /v1/products/search` | legacy | busqueda de texto | R | Si (`search_products`) | OUTDATED (bug de stopwords) |
| `GET /v1/products/:productId` | legacy | detalle + precio real | R | Si (`get_product_details`) | CURRENT, pero step no ejecutable en R2 |
| `POST /v1/products/batch` | legacy | hidratacion masiva | R | Si (`batch_get_products`) | CURRENT, solo consumido por el runtime legacy mas antiguo (ver Parte 8) |
| `POST /v1/products/explore` | v1 | browse estructurado | R | Si (`explore_catalog`) | CURRENT, sin step de CommercialWork |
| `POST /api/v2/catalog/resolve-product-intent` | T12 | resolucion NL de producto | R | **No** | NOT_WIRED - diseñado exactamente para el bug reportado |
| `POST /api/v2/recommendations/search-products` | T11 | cross-sell desde producto conocido | R | Si (`recommend_catalog_products`, via cliente V2 separado) | CURRENT, step no ejecutable en R2 |

### Quote Service

`quote-route.ts`, prefijo `/v1/quotes` - **16 rutas reales** confirmadas por conteo directo
(A11.3 decia "15" pero listaba 16 en su propia prosa; corregido aqui), mas un **17o endpoint real
que A11.3 no contemplaba en absoluto**: `GET /v1/documents/:documentRef` (`document-route.ts`,
fuera del prefijo `/v1/quotes`, mismo `Authorization: Bearer` de servicio - nunca un link publico).

| Endpoint | Proposito | R/W | CRM lo consume | Tiene caller real en produccion |
|---|---|---|---|---|
| `POST /` | crear draft | W | Si (`createQuote`) | **Si - el unico** |
| `GET /by-number/:quoteNumber` | consultar por numero | R | Si (`getQuoteByNumber`) | No |
| `GET /` | listar (filtros opportunityId/status/revisionRootId) | R | No (`listQuotes` no wrapeado) | No aplica |
| `PUT /:quoteId/draft` | actualizar draft | W | Si (`updateDraft`) | No |
| `POST /:quoteId/issue` | emitir + generar PDF/HTML | W | Si (`issueQuote`) | **No - nunca llamado** |
| `POST /:quoteId/accept` | aceptacion del cliente | W | No | No aplica |
| `POST /:quoteId/mark-paid` | conciliar pago | W | No | No aplica |
| `POST /:quoteId/cancel` | cancelar | W | No | No aplica |
| `POST /:quoteId/expire` | expirar manualmente | W | No | No aplica |
| `POST /:quoteId/revisions` | nueva version (ej. cambiar validUntil) | W | No | No aplica |
| `GET /:quoteId/documents` | referencia de documento (subset de GET /:quoteId) | R | No | No aplica |
| `GET /:quoteId/audit` | historial de transiciones | R | No | No aplica |
| `POST /:quoteId/send-email` | envio transaccional | W | Si (`sendQuoteEmail`) | No |
| `GET /:quoteId/deliveries` | tracking de entregas de email | R | Si (`listQuoteDeliveries`) | No |
| `GET /:quoteId/deliveries/:deliveryId` | detalle de una entrega | R | Si (`getQuoteDelivery`) | No |
| `GET /:quoteId` | detalle completo | R | Si (`getQuote`) | No |
| `GET /v1/documents/:documentRef` | resolver referencia opaca de documento | R | **No** (nuevo hallazgo, no wrapeado en absoluto) | No aplica |

**De 16-17 endpoints reales, CRM ejercita exactamente 1 (`createQuote`) en produccion.** 7 estan
completamente cableados a nivel de adapter/tipo (transporte, parseo, manejo de error - listos para
usarse) pero sin ningun caller fuera de tests/benchmarks. 8 (mas el 17o de documentos) no estan
wrapeados en absoluto en `QuoteServicePort`.

### Customer Profile

`src/http/routes/index.ts:128-757` - 12 endpoints reales (detallados en A11.3, no repetidos):
perfil, resumen comercial, productos comprados, comportamiento de compra, estado de orden, RFM
primario (`customerId`-keyed), RFM legacy (`masterCustomerId`-keyed), cluster, cross-tab/summary de
clustering (2), copiloto de inteligencia (+ sesiones). CRM consume 6 de 12 (`getProfile`,
`getCommercialSummary`, `getPurchasedProducts`, `getPurchaseBehavior`, `getOrderStatus`, `getRfm`)
via un cliente vivo (Bloque B, ver Parte 12) mas **un segundo cliente HTTP completo, construido
antes, nunca borrado, con cero callers en todo el repo** (Bloque A, `lib/customer-profile/httpCustomerProfileAdapter.ts`,
solo 2 metodos: `getPurchasedProducts`/`getPurchaseBehavior`). Cero capability de Gateway, cero
step de CommercialWork.

| Endpoint | Identidad requerida | CRM lo consume | Codigo lo tiene wrapeado (algun cliente) |
|---|---|---|---|
| `GET /v1/customers/:customerId/profile` | `ps_customer.id_customer` | Si (Bloque B) | Si |
| `GET /v1/customers/:customerId/commercial-summary` | idem | Si (Bloque B) | Si |
| `GET /v1/customers/:customerId/purchased-products` | idem | Si (Bloque B) | Si (Bloque A tambien, muerto) |
| `GET /v1/customers/:customerId/purchase-behavior` | idem | Si (Bloque B) | Si (Bloque A tambien, muerto) |
| `GET /v1/customers/:customerId/orders/:reference/status` | idem | Si (Bloque B) | Si |
| `GET /v1/customers/:customerId/rfm` (primario) | idem | **No directamente** - CRM llama esta URL pero con `masterCustomerId` como valor | Si (mal poblado) |
| `GET /v1/master-customers/:masterCustomerId/rfm` (legacy) | `master_customer.id` | No | No |
| `GET /v1/customers/:customerId/cluster` | idem | No | No |
| `GET /v1/clustering/snapshots/latest/summary`, `/rfm-cross-tab` | - | No | No |
| `GET /v1/clustering/snapshots/:snapshotId/summary` | - | No | No |
| `POST /v1/customer-intelligence/copilot` + sesiones | - | Si, pero solo Marketing (`lib/marketing/customerIntelligenceCopilot.ts`), fuera del dominio comercial | Si (Marketing) |

### Shipping / Carrier MS

Sin repo local (misma limitacion metodologica que A11.3). `CarrierService.quoteAll` confirmado como
el contrato completo real, sin ninguna operacion adicional huerfana del lado CRM:

- Input (`CarrierQuoteInput`, `lib/domains/carrier-service/types.ts:6-11`): exactamente
  `destination: string`, `totalWeightKg: number`, `totalBoleta: number` - sin comuna/region
  separados, sin direccion estructurada.
- Output: `{ok:true, options: CarrierOption[]}` o `{ok:false, reason, detail}`. Cada opcion:
  `carrierName`, `serviceType`, `totalCost`, `estimatedDelivery` (string opaco, nunca parseado
  como fecha).
- Alto/ancho/largo van fijos en 1 (`CARRIER_DEFAULT_HEIGHT/WIDTH/LENGTH`) - nunca derivados de
  dimensiones reales del producto.
- Sin autenticacion (confirmado en vivo previamente: peticiones sin `Authorization`/`x-api-key`
  devuelven cotizaciones reales) - no falta ninguna variable de config.

---

## Parte 2 - Inventario CRM

### Capability Gateway - 14 capabilities reales

`lib/brain/commercial/capability-gateway/registry.ts:418-463` (11 entradas explicitas + 3 del
spread `CUSTOMER_IDENTITY_CAPABILITY_DEFINITIONS`, `customerIdentityCapabilities.ts:52`:
`resolve_customer`/`create_customer`/`link_external_identity`). Ver Parte 8 para la matriz completa
de cobertura por runtime.

### CommercialWork (R2) - tipos y ejecutabilidad

`lib/brain/commercial/work/stepTypes.ts:1-11` - **9 step types**: `SEARCH_PRODUCTS`,
`GET_PRODUCT_DETAILS`, `RECOMMEND_PRODUCTS`, `SELECT_PRODUCTS`, `SET_SHIPPING_DESTINATION`,
`CALCULATE_SHIPPING`, `SELECT_SHIPPING_OPTION`, `CREATE_QUOTE`, `HANDOFF`.

`lib/brain/commercial/work/commercialWorkExecutor.ts:23` - `EXECUTABLE_STEP_TYPES` = exactamente
**5 de 9**: `SEARCH_PRODUCTS`, `SELECT_PRODUCTS`, `SET_SHIPPING_DESTINATION`, `CALCULATE_SHIPPING`,
`CREATE_QUOTE`. Un step de un tipo no incluido se bloquea explicitamente (`errorCode:
"unsupported_step_type"`, `commercialWorkExecutor.ts:606-611`/`686-689`), nunca falla en silencio.

Ademas existe un **10o tipo, a nivel de objetivo, no de step**: `WAIT_FOR_QUOTE_APPROVAL`
(`objectiveTypes.ts:11`) - completamente scaffoldeado (familia de supersesion, politica de
follow-up completa con mensaje ya escrito, `maxAttempts`, `delaySequenceMinutes`) pero sin
productor de seed ni case en `deriveCommercialWorkSteps.ts` - infraestructura muerta a la espera
de un productor, documentado como "contrato futuro" desde A07.

### Agent Tool Loop - 10 tools

`lib/brain/commercial/agent-loop/runAgentToolLoop.ts:62-73` (`AGENT_LOOP_TOOL_POOL`):
`search_products`, `get_product_details`, `search_company_knowledge`, `explore_catalog`,
`recommend_catalog_products`, `set_shipping_destination`, `select_products`, `calculate_shipping`,
`select_shipping_option`, `create_quote`. Deliberadamente excluye `batch_get_products`
(comentario explicito, `runAgentToolLoop.ts:18-22`).

### Otros runtimes (ver Parte 8 para el detalle completo)

- **Multi-request runtime**: `lib/brain/commercial/multi-request/` - tiene su propio sistema de
  capabilities paralelo (`lib/brain/commercial/capabilities/registry.ts`,
  `READ_CAPABILITY_REGISTRY`), **no** el Capability Gateway.
- **sales-consultative legacy**: `lib/brain/commercial/sales-consultative/` - implementacion 100%
  paralela, SQL directo, sin Gateway.
- **Shadow/operational-loop (el runtime mas antiguo, ACS-R1-01.1)**: `buildCatalogGroundedMessage.ts`
  + `runCapabilityExecutionStage.ts` - unico consumidor real de `batch_get_products`, si usa el
  Gateway correctamente.

### Config real (`.env.example`) relevante

Ver Parte 12 para la tabla completa de drift.

---

## Parte 3 - Catalog Service (diferencias desde A11.2/A11.2-A2)

**Ninguna.** Confirmado arriba: cero commits en el servicio real desde `ce4beba`, cero commits en
el codigo CRM relevante (`lib/catalog/`, `registry.ts`, `searchProductsCapability.ts`) mas alla del
panel de administracion (bypass #5, Parte 7, no afecta ninguna decision comercial). Los slices
A11.2-B/C/D siguen siendo el plan vigente, sin cambios.

---

## Parte 4 - Quote Service (profundizacion completa)

### 1. Campos de respuesta perdidos entre el servicio y lo persistido

El servicio real devuelve un `PublicQuoteDto` de ~30 campos (`quote-presenter.ts:23-46`):
`quoteId, quoteNumber, opportunityId, customerId, conversationId, actor, source, status, currency,
customerSnapshot{...7 campos...}, items[]{...11 campos por linea...}, pricing{subtotal,taxAmount,total},
validUntil, version, revision{...4 campos...}, issuedDocument{...}, timestamps{...6 campos...}`.

El adapter de CRM (`httpQuoteServiceAdapter.ts#parseQuote`) parsea el DTO **completo**, fail-closed
(un campo faltante invalida todo el parseo). La perdida real ocurre un nivel arriba, en
`createQuoteCapability.ts:136-176`: solo se persisten 8 campos (`quoteId, quoteNumber, status,
currency, total, validUntil, selectionFactId, idempotencyKey`) y solo se devuelven 6 al capability
result. **`version` se descarta** - critico, porque `updateDraft`/`issueQuote` exigen
`expectedVersion` para concurrencia optimista; sin persistirlo, CRM no puede invocar esos metodos
ya wrapeados sin una llamada `getQuote` previa solo para recuperar la version vigente.

Tambien se pierden: `customerSnapshot` completo (sin forma de auditar despues que nombre/email/
telefono quedo grabado en la cotizacion real), `items[]` linea por linea con desglose de impuesto,
`pricing.subtotal`/`.taxAmount` (solo `.total` sobrevive), `revision{...}`, `issuedDocument{...}`,
y 5 de los 6 timestamps reales del servicio.

### 2. PDF - nunca se genera hoy

`documentIssuancePort` solo se inyecta en la ruta `POST /:quoteId/issue` - la unica de las 16 que
lo recibe. `createQuoteCapability.ts` **solo llama `createQuote`**, nunca `issueQuote` (confirmado
por grep: el unico otro caller de `issueQuote`/`sendQuoteEmail` en todo el repo es un fixture de
benchmark que lanza `Error("R2 benchmark fixture: issueQuote not used")`). **Consecuencia: ninguna
cotizacion creada por CRM tiene jamas un PDF/HTML generado hoy.** Aun si se wireara, `documentRef`
es una referencia opaca que exige el 17o endpoint (`GET /v1/documents/:documentRef`, Parte 1) con
el mismo token de servicio - nunca un link publico compartible por WhatsApp sin que CRM descargue
los bytes server-side primero.

### 3. Bug de idempotencia real - el hallazgo mas importante de esta seccion

El servicio scopea idempotencia por `(idempotency_key, operation_name)` con `request_hash` (SHA-256
canonico del payload completo). CRM genera la key deterministicamente: `sha256("create-quote:
${opportunityId}:${selectionFactId}")` - **no depende del tiempo**. Pero `assembleQuoteInput.ts:295-296`
recalcula `validUntil = addDays(now(), 5)` **en cada llamada**, y `validUntil` es parte del payload
que el servicio hashea. Un reintento (tras un fallo de persistencia local en CRM, que dispara
`temporarily_blocked` y por tanto `RETRY_SCHEDULED`) llega con el **mismo idempotencyKey** pero un
`validUntil` distinto en milisegundos/segundos → el servicio real rechaza con
`idempotency_key_reused_with_different_payload` (clase `conflict`, no retryable) → CRM marca
`failed` permanente, **aunque la cotizacion YA fue creada exitosamente en el servicio real la
primera vez**. CRM no tiene ningun mecanismo de recuperacion (no llama `getQuoteByNumber`/`getQuote`
en este flujo pese a tenerlos ya wrapeados) - la cotizacion queda huerfana, real en el Quote
Service, invisible para CRM y para el cliente. Un segundo vector independiente agrava lo mismo:
`assembleQuoteInput.ts:253-260` re-consulta precios vivos del catalogo en cada intento, asi que un
cambio de precio entre el intento fallido y el reintento tambien rompe el hash.

### 4. Continuidad de CommercialWork tras `CREATE_QUOTE`

`CREATE_QUOTE` se marca `COMPLETED` normalmente y el `CommercialWork` completo pasa a `COMPLETED`
si es el unico objetivo activo. Existe el andamiaje completo para seguimiento post-cotizacion
(`WAIT_FOR_QUOTE_APPROVAL`, ver Parte 2) pero deliberadamente sin conectar desde A07 - no es
ausencia de diseño, es infraestructura construida y dejada como "contrato futuro".

### 5. Evidence chain

Un unico punto de poda temprana: `createQuoteCapability.ts:167-176` recorta los ~30 campos reales
a 6-8. Todo lo posterior (`CapabilityGatewayResult`, fila `crm_capability_executions`, evidencia
del step, evidencia del objetivo via el fact durable `created_quote`) es una copia fiel de ese
mismo subconjunto ya empobrecido - no hay una segunda perdida en la cadena.

### 6. Retry/failure semantics - `WAITING_CUSTOMER` verificado inalcanzable para fallos tecnicos

Confirmado exhaustivamente: `createQuoteCapability.ts` nunca retorna `status: "missing_information"`
en ningun branch - ningun fallo tecnico/de sistema del Quote Service puede terminar en
`WAITING_CUSTOMER`. **Hallazgo cross-cutting** (ver tambien Parte 6, Shipping): `retryPolicy.ts`
declara `retryableGatewayStatuses`/`retryableOutcomeCodes` por step type, pero **ningun otro
archivo del repo los lee** (confirmado por grep global) - metadata declarativa sin efecto
funcional, potencialmente enganosa.

### 7. Config

`.env.example:301-302` tiene un comentario obsoleto: *"Adapter only - not wired to any capability
or runtime path yet"* - **falso hoy** desde SALES-AGENT-R1-T3. Timeout 5000ms es razonable para lo
que CRM ejercita hoy (solo `POST /` de escritura), pero el propio servicio reserva 15000ms para
renderizado de PDF via Puppeteer - un footgun latente si alguien conecta `/issue` sin revisar el
timeout primero.

### 8. Agent Tool Loop vs CommercialWork tras create_quote

Ambos runtimes consumen el mismo capability empobrecido (misma perdida del punto 1). El Agent Tool
Loop no tiene ningun concepto de seguimiento durable (sin objetivo, sin politica de follow-up) -
es estructuralmente mas simple, no mas rico, que el andamiaje ya existente (aunque desconectado)
del lado CommercialWork.

### 9. Funciones completamente huerfanas

Ver tabla completa en Parte 1. De 16-17 endpoints reales, 15 no tienen ningun caller de produccion.

---

## Parte 5 - Customer Profile (profundizacion completa)

### 1. Duplicacion de env vars - son dos integraciones sucesivas, no config duplicada

Tres bloques reales, no dos:

- **Bloque A** (`CUSTOMER_PROFILE_SERVICE_*`, CP-R1-T10B1): cliente `lib/customer-profile/httpCustomerProfileAdapter.ts`,
  solo 2 metodos, **cero callers en todo el repo** - codigo completamente muerto, nunca conectado a
  ningun runtime.
- **Bloque B** (`CUSTOMER_PROFILE_*` + `_ENABLED`/`_AUTH_TOKEN`, CP-R1-T12B, 2026-08-05): el cliente
  vivo, 7 operaciones, consumido por `customerProfileCapabilities.ts` → `loader.ts` →
  `runNativeAgentToolLoopCycle.ts`. La propia doc de T12B (`CP-R1-T12B-sales-agent-customer-profile-http-client.md:24-32`)
  confirma que su autor audito el Bloque A antes de escribir codigo y decidio construir un cliente
  paralelo porque el contrato objetivo de identidad cambio (`masterCustomerId` → `customerId`).
  T11H (2026-08-14, la tarea mas reciente en esta area) confirma explicitamente que sabia que el
  Bloque A seguia existiendo y decidio no limpiarlo.
- **Bloque C** (`CUSTOMER_PROFILE_CONTEXT_ENABLED` + 4 limites, CP-R1-T12C): no es duplicado, es un
  segundo kill-switch en serie que controla si `loadCustomerCommercialHistoryContext` corre
  siquiera, independiente de si el Bloque B esta habilitado.

**Es un caso nuevo, no cubierto por A11.3**: no es "el microservicio evoluciono y CRM se quedo
atras" (patron Catalog/RFM), es "CRM construyo dos clientes HTTP sucesivos para el mismo servicio y
nunca borro el primero ni su bloque de configuracion." Ademas, el comentario de `.env.example` para
el Bloque B (*"not wired to the model/agent loop yet"*) tambien esta desactualizado - es falso
desde T11H/T12C.

### 2. Identidad - el problema es mas amplio de lo que decia A11.3

`identity.customerId` de la sesion nativa del Sales Agent **siempre** es, en la practica, un
`master_customer.id` (viene de `customer_external_identity.customer_id`, una FK hacia
`master_customer.id`, o de `evidence.result.customerMasterId` en la rama de resolucion externa) -
**nunca** un `ps_customer.id_customer`. `local-adapter.ts:14-18` lo documenta explicitamente: no
existe ningun escritor que cree una fila `customer_external_identity` con provider `'prestashop'`.

`runNativeAgentToolLoopCycle.ts:449` pasa ese mismo `identity.customerId` como `customerId` a las
**cinco** operaciones `customerId`-keyed (`getProfile`, `getCommercialSummary`,
`getPurchasedProducts`, `getPurchaseBehavior`, `getOrderStatus`), no solo a RFM. Si
`CUSTOMER_PROFILE_ENABLED=true` en produccion, cada una de esas cinco llamadas enviaria un
`master_customer.id` donde el microservicio espera `ps_customer.id_customer` - resultado mas
probable `404`, riesgo de baja probabilidad de colision numerica accidental con un cliente real de
PrestaShop no relacionado.

**No es solo deuda tecnica, es un fallback estructural real**: el CRM SI sabe resolver
`ps_customer.id_customer` en otro subsistema (`lib/customer-identity/*`, distinto de
`lib/domains/customer-identity/*`), usado por el read-model de Customer 360 del dashboard - pero el
runtime del Sales Agent nunca fue cableado a ese subsistema. Dos arboles de identidad paralelos
coexisten en el repo; el Sales Agent quedo conectado al que no tiene puente a PrestaShop.

**Refinamiento del hallazgo de RFM de A11.3**: CRM no llama a la URL legacy con el id legacy
(como decia A11.3) - llama a la URL **primaria** (`/v1/customers/:customerId/rfm`) pero poblada con
un `masterCustomerId`. Si el servicio estuviera habilitado, esa llamada aterrizaria en el handler
primario, que devuelve una clave `customerId` en el body - el parser estricto de CRM exige la clave
`masterCustomerId` y la rechazaria como `CONTRACT_ERROR`. Resultado practico identico al que ya
documento A11.3 (RFM nunca funciona), pero la causa raiz real es una mezcla de forma de URL +
espacio de identidad, no una llamada correcta a la ruta legacy con el id legacy correcto.

### 3. Los 4 endpoints no-RFM que CRM consume - codigo existe, ningun humano los ve

Cero resultados en `app/` (UI/dashboard) para `getPurchaseBehavior`/`getPurchasedProducts`/
`getCommercialSummary`/`getOrderStatus`. Alimentan exclusivamente texto de prompt para el LLM
(`CUSTOMER_PURCHASE_HISTORY_RULE_LINES`/`CUSTOMER_RFM_RULE_LINES` en
`buildAgentStepPromptPackage.ts`), gateado ademas por `CUSTOMER_PROFILE_CONTEXT_ENABLED=false` por
defecto. Sin persistencia de que datos vio el modelo en un turno dado.

### 4. Snapshot vs tiempo real

`profile`/`commercial-summary`/`purchased-products`/`purchase-behavior`/`order-status`: computo en
vivo contra PrestaShop en cada request (confirmado por dependencias inyectadas y codigos de error
como `prestashop_unavailable` que solo tienen sentido si golpea PrestaShop en tiempo real). **RFM,
clustering y customer-analytics (CP-R3-T01): los tres son snapshots batch CLI-only, sin ningun
scheduler/cron real** - el mismo comentario ("No 'scheduled' trigger source... CLI-only, no
cron/scheduler") se repite verbatim en los tres repositorios de ejecucion de snapshot. El RFM que
veria el Sales Agent (si funcionara) es "el de la ultima vez que alguien corrio el job a mano", no
"el de ahora".

### 5. Clustering/cross-tab

Gap absoluto confirmado de nuevo, cero referencias en todo `lib/brain/commercial/`, ni siquiera un
tipo o wrapper sin usar.

### 6. Decisiones comerciales concretas habilitables (sin narrarlas en el prompt)

- `purchase-behavior.topProducts[].isRepeated`/`.daysSinceLastPurchase` (campos reales del
  contrato) podrian des-priorizar deterministicamente un producto recomprado reciente en
  `SEARCH_PRODUCTS`/`SELECT_PRODUCTS`, antes de que el LLM lo vea - catalogo-verificable, sin
  requerir que el modelo "recuerde" nada.
- `customerRfm.segment.code` podria condicionar que `objective` deriva el planificador (hoy T11H
  prohibe explicitamente esto - seria un cambio de politica deliberado, no un bug).
- `commercialSummary.lastOrderAt`/`totalOrders` podria fijar cadencia de seguimiento distinta para
  cliente recurrente vs nuevo, usando el mismo patron de `retryPolicy.ts` ya existente.
- `purchasedProducts[].catalogStatus === "deleted_or_unavailable"` (ya presente en el contrato, hoy
  se pierde en el resumen de prompt) podria evitar ofrecer "recompra" de un producto descontinuado.

### 7. Retry semantics

Sin reintento persistido hoy (una llamada por turno, `Promise.all`/`allSettled`). Si se
convirtiera en capability real, heredaria el patron ya existente de `retryPolicy.ts` por
`stepType` - pero hoy no existe ninguna entrada porque no hay ningun step type para Customer
Profile.

---

## Parte 6 - Shipping (profundizacion completa)

### 1. `SELECT_SHIPPING_OPTION` en R2 - Patron D, pero mas grave de lo esperado

Esta completamente modelado en el sistema de tipos: step type (`stepTypes.ts:8`), objective type
(`objectiveTypes.ts:9`), familia de supersesion (`deriveCommercialObjectives.ts:51`), case completo
de derivacion (`deriveCommercialWorkSteps.ts:224-247`), logica de proyeccion completa
(`buildCommercialWorkProjection.ts:331-351`), mensajes finales en español
(`buildCommercialWorkFinalizerMessage.ts:110-111`, `:128-129`), entrada en el modelo de conflicto
paralelo (`parallelStepConflictModel.ts:45`).

**Pero esta bloqueado en dos capas independientes**: (a) el executor lo excluye de
`EXECUTABLE_STEP_TYPES` - cae en `unsupported_step_type`, blocker `UNSUPPORTED`, **no** en la
whitelist de auto-reactivacion (`canAutoActivateStep`) - queda `BLOCKED` permanentemente; (b) la
capa semantica no tiene forma de generarlo nunca - `COMMERCIAL_INTENT_TYPES`
(`multi-intent/types.ts:25`) solo tiene `select_products`, `get_shipping_quote`, `create_quote`,
`cancel` - no existe un quinto intent para "elegir opcion de envio". El unico lugar donde este
objetivo se materializa hoy es un helper de test que construye el seed directamente, saltandose la
capa semantica por completo.

**Riesgo real si alguna vez se conecta sin el fix del executor primero**: si un objetivo
`SELECT_SHIPPING_OPTION` llegara a existir (ej. un futuro intent nuevo del planner), el step
quedaria `BLOCKED` (nunca auto-reactivado), el objetivo `BLOCKED`, y el `CommercialWork` completo
caeria a `"ACTIVE"` sin ningun step `READY`/`WAITING_SYSTEM`/`RETRY_SCHEDULED`/`WAITING_CUSTOMER`/
`FAILED` - **el worker de retry nunca lo recogeria** (`commercialWorkWorker.ts` solo toma trabajo
`ACTIVE`/`WAITING_SYSTEM` con steps `READY`/`RETRY_SCHEDULED`/lock vencido - `BLOCKED` no califica
para ninguna). El work quedaria atascado indefinidamente, invisible.

Ningun test ejercita un objetivo/step `SELECT_SHIPPING_OPTION` real generado por la capa semantica
y llevado a traves del executor real - solo tests aislados de proyeccion y de la capability en si.

### 2. Por que si funciona en Agent Tool Loop

El Agent Tool Loop es hoy el **unico camino real end-to-end** para que un cliente elija una opcion
de envio. Llama `executeGovernedCapability("select_shipping_option", ...)` directo - exactamente la
misma funcion que usa `commercialWorkExecutor.ts`, mismo Gateway, mismo adapter. La divergencia esta
solo en la capa de orquestacion, no en la ejecucion de la capability. Y como CommercialWork R2 y
Agent Tool Loop son mutuamente excluyentes por `waId` sin fallback dentro del mismo turno
(`runNativeAutonomousCycle.ts`), un cliente cuyo `waId` esta en el allowlist de R2 **nunca** puede
elegir una opcion de envio hoy - solo los clientes que caen en Agent Tool Loop pueden.

### 3. `set_shipping_destination`

Totalmente funcional en ambos runtimes, mismo capability/adapter/writer de DB - la unica diferencia
es como se construye el input (facts estructurados en R2 vs argumentos del LLM en Agent Tool Loop).
Sin el problema de `SELECT_SHIPPING_OPTION`.

### 4-5. Contrato real y evidence chain

Ver Parte 1 (tabla de contrato) y confirmacion de que la cadena request → response → gateway result
→ fila de auditoria → evidencia de step/objetivo funciona correctamente para `calculate_shipping`.
El deadlock del punto 1 aplica especificamente a `SELECT_SHIPPING_OPTION`, no a `calculate_shipping`.

### 6. Retry/error semantics

Mapeo confirmado completo (destino faltante/seleccion faltante → `WAITING_CUSTOMER`; catalogo/
Carrier no disponible → `WAITING_SYSTEM`/`RETRY_SCHEDULED` segun intentos; sin opciones de envio →
`COMPLETED`, informativo; `carrier_invalid_response` → `FAILED` directo sin reintento). Mismo
hallazgo cross-cutting del punto 6 de Quote: `retryableGatewayStatuses`/`retryableOutcomeCodes`
tambien confirmados sin efecto funcional aqui.

### 7-8. Config y tests

`.env.example` completo, sin variable faltante (Carrier MS no exige auth, confirmado en vivo
previamente). Cero tests ejercitan `SELECT_SHIPPING_OPTION` a traves del executor real.

---

## Parte 7 - Direct/bypass calls

Caso ya conocido, solo inventariado (no repetido como hallazgo): `customer-profile-context/loader.ts`
llama `customerProfileCapabilities.*` directo, nunca via Gateway, nunca en `crm_capability_executions`.
Corre en cada turno real del Agent Tool Loop hoy (no es codigo muerto).

| # | Bypass | Clasificacion | Por que |
|---|---|---|---|
| 1 | `sales-consultative/catalogRepository.ts` - SQL crudo contra `ps_product`/`ps_stock_available`/etc, sin HTTP al Catalog Service | `LEGACY_DEBT` | Motor antiguo, deberia usar el Gateway, nunca migrado. Gateado por `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED` (fail-closed, default `false`) |
| 2 | `sales-consultative/repository.ts#prepareQuoteRecord` - genera un `quoteId` local falso, nunca llama al Quote Service real | `LEGACY_DEBT` | Mismo gate que #1 |
| 3 | `lib/brain/commercial/capabilities/registry.ts` (`READ_CAPABILITY_REGISTRY`) - sistema de capabilities paralelo al Gateway, usado por el runtime multi-request; reutiliza SQL de #1 para `search_products` (**mismo nombre, implementacion distinta** - riesgo de confusion en logs), SQL directo para `find_order`/`get_order_status`, llamadas directas a `customer-addresses` | `RISKY_BYPASS` | Nunca escribe en `crm_capability_executions` (solo en eventos de `conversation-request`). Gateado por el flag de multi-request, pero ese runtime tiene **prioridad de enrutamiento mayor que el Agent Tool Loop** - si se habilita, resuelve datos reales de pedidos/precios/direcciones sin auditoria de Gateway |
| 4 | `lib/brain/commercial/quotes/repository.ts` (`crm_quotes`, tabla propia) - `createQuoteDraft`/`markQuoteSent`/`recordQuoteDecision`/`expireQuote`, desconectado del Quote Service real | `DEAD_CODE` (funciones de escritura, cero callers confirmados) | Pasaria a `RISKY_BYPASS` si alguna vez se conecta - crearia cotizaciones "de mentira" en paralelo al Quote Service real |
| 5 | `lib/catalog/consoleService.ts` - panel de administracion de catalogo del Hub, llamadas directas al Catalog Service | `LEGITIMATE_INTERNAL` | Solo lectura, `requireOperator`-gated, no alimenta ninguna decision comercial autonoma |

---

## Parte 8 - Runtime coverage

**Cuatro runtimes reales**, no tres (A11.2-A2 ya habia encontrado un tercero; esta auditoria
confirma un cuarto: el runtime multi-request con su propio sistema de capabilities). Prioridad de
enrutamiento en `runNativeAutonomousCycle.ts`, mayor a menor: (1) CommercialWork R2, exclusivo, sin
fallback dentro del mismo turno; (2) multi-request (`READ_CAPABILITY_REGISTRY`, bypass del
Gateway); (3) Agent Tool Loop (Gateway real, 10 tools); (4) legacy - dos sub-ramas: `sales-consultative`
(gateado, apagado por defecto) y el runtime mas antiguo (`buildCatalogGroundedMessage.ts`/shadow/
operational-loop, ACS-R1-01.1, unico consumidor de `batch_get_products`).

| Capability | R2 (CommercialWork) | Agent Tool Loop | sales-consultative legacy | Mismo Gateway/adapter |
|---|---|---|---|---|
| `search_products` | Si (`SEARCH_PRODUCTS`) | Si | No (SQL directo distinto) | Solo R2+AgentLoop |
| `get_product_details` | **No** - tipo huerfano, sin case que lo produzca | Si | No | Solo AgentLoop |
| `batch_get_products` | No | No (excluida a proposito) | No | Solo el runtime legacy mas antiguo (Fase 3.5, via Gateway correctamente) |
| `explore_catalog` | **No** - cero referencias en `work/` | Si | No | Solo AgentLoop |
| `search_company_knowledge` | No | Si | No | Solo AgentLoop |
| `resolve_customer`/`create_customer`/`link_external_identity` | Indirecto (orquestador, pre-branch) | Indirecto (idem) | No | Compartida a nivel de orquestador, antes del enrutamiento |
| `recommend_catalog_products` | **Parcial** - tipo+step+case existen, no en `EXECUTABLE_STEP_TYPES`, sin productor de seed | Si | No | Solo AgentLoop en la practica |
| `set_shipping_destination` | Si | Si | No | Solo R2+AgentLoop |
| `select_products` | Si | Si | No | Solo R2+AgentLoop |
| `calculate_shipping` | Si | Si | No | Solo R2+AgentLoop |
| `select_shipping_option` | **Parcial, mismo patron y mismo riesgo de deadlock que arriba** | Si (**unico camino real end-to-end**) | No | Solo AgentLoop en la practica |
| `create_quote` | Si | Si | No (genera quoteId falso, ver Parte 7 #2) | Solo R2+AgentLoop |

**Capability que existe solo por un runtime viejo**: `batch_get_products` - si la rama legacy mas
antigua se apaga definitivamente, queda sin ningun consumidor productivo.

**Capabilities disponibles hace tiempo en el Gateway que R2 nunca adopto**: `explore_catalog`,
`search_company_knowledge` (cero referencias, nunca hubo intento de cablearlas) vs
`recommend_catalog_products`/`select_shipping_option` (cableado parcial real, abandonado a medio
camino - distincion importante para priorizar el trabajo futuro).

**Hallazgo de comentario obsoleto**: `registry.ts:430-432` dice que `recommend_catalog_products` fue
"deliberadamente NOT added to AGENT_LOOP_TOOL_POOL" - **falso hoy**, si esta incluida
(`runAgentToolLoop.ts:67`). Deuda documental menor, cross-referenciada en Parte 14.

**sales-consultative no comparte ni un adapter con el resto** - implementacion 100% paralela,
confirmado por grep (cero referencias a `executeGovernedCapability`/Gateway/dominios externos en
todo el arbol).

---

## Parte 9 - Contract drift, patrones confirmados

| Patron | Instancia(s) confirmada(s) |
|---|---|
| A. Endpoint nuevo, CRM en el viejo | Catalog (`search_products` legacy vs T12, A11.2). Variante: Customer Profile RFM llama la URL primaria pero con el id equivocado (Parte 5.2) |
| B. Servicio entrega mas campos, CRM los descarta | Quote (~30 campos reales → 6-8 persistidos, incluyendo `version`, critico para concurrencia) |
| D. Step existe pero no ejecuta | `GET_PRODUCT_DETAILS` (huerfano de origen), `RECOMMEND_PRODUCTS` (cableado abandonado), `SELECT_SHIPPING_OPTION` (cableado abandonado + riesgo de deadlock si se completa mal) |
| E. Capability existe, ningun intent la produce | `RECOMMEND_PRODUCTS`, `SELECT_SHIPPING_OPTION` - misma causa raiz: `COMMERCIAL_INTENT_TYPES` solo tiene 4 tipos |
| F. CRM cree que una operacion tiene cierta semantica, el contrato la contradice | Quote: el comentario de `createQuoteCapability.ts` afirma que un reintento "returns unchanged rather than duplicating" - falso por el bug de `validUntil` en el hash (Parte 4.3) |
| G. Retryability/error mapping desactualizado | `retryableGatewayStatuses`/`retryableOutcomeCodes` de `retryPolicy.ts` - declarados por step type, **nunca leidos en ningun otro archivo** - confirmado independientemente en Quote y Shipping, muy probablemente afecta los 5 steps ejecutables por igual |
| H. IDs/identity models divergentes | Customer Profile: `master_customer.id` vs `ps_customer.id_customer`, dos subsistemas de identidad paralelos en el mismo repo, Sales Agent conectado al que no tiene puente a PrestaShop (Parte 5.2) |
| I. Feature en el servicio, invisible para R2 | Quote (ciclo de vida completo post-creacion), Customer Profile (clustering/cross-tab; copiloto es legitimamente Marketing-only) |
| J. Legacy tiene wiring que R2 nunca porto | A11.2-A2: `pendingCatalogAction`/evidence-gate del Agent Tool Loop, sin equivalente en R2. Nuevo: Agent Tool Loop alcanza `select_shipping_option`/`create_quote`/`recommend_catalog_products` de forma mas completa que R2 hoy |

No se encontraron instancias aisladas de C (schema del Gateway desactualizado) mas alla de los
casos ya cubiertos por A/D.

---

## Parte 10 - Evidence chain (consolidado)

- **Catalog**: ver A11.2 Parte 10 - modelo funcional, reusable para T12 sin cambio de tabla.
- **Quote**: un unico punto de poda temprana (`createQuoteCapability.ts`), todo lo posterior es
  copia fiel del subconjunto ya empobrecido (Parte 4.5).
- **Shipping**: cadena completa y correcta para `calculate_shipping`; `SELECT_SHIPPING_OPTION`
  nunca llega a generar evidencia real porque nunca se genera el objetivo (Parte 6.1).
- **Customer Profile**: no aplica - nunca pasa por el Gateway, ninguna evidencia persiste en
  `crm_capability_executions` (confirmado, A11.3 + esta auditoria).

---

## Parte 11 - Failure/retry semantics (consolidado)

La regla obligatoria ("fallo system-owned != `WAITING_CUSTOMER`") **se cumple verificablemente en
Quote y Shipping**, confirmado por inspeccion exhaustiva de codigo, no solo ausencia de casos de
prueba. El hallazgo cross-cutting real de esta parte es el de la Parte 9, patron G: la metadata de
retryability declarada por servicio (`retryableGatewayStatuses`/`retryableOutcomeCodes`) es
enteramente decorativa hoy - la unica decision real de reintento es `attemptCount < maxAttempts`,
agnostica al codigo de error especifico.

---

## Parte 12 - Env / deployment drift

| Servicio | Variable | Existe en `.env.example` | Requerida | Riesgo |
|---|---|---|---|---|
| Quote | `QUOTE_SERVICE_BASE_URL`/`_AUTH_TOKEN`/`_TIMEOUT_MS` | Si | Si | Bajo funcionalmente; comentario inline **desactualizado** (dice "not wired", es falso desde SALES-AGENT-R1-T3) |
| Customer Profile | `CUSTOMER_PROFILE_SERVICE_*` (Bloque A) | Si | **No** - controla codigo completamente muerto | Candidato a eliminacion junto con el adapter |
| Customer Profile | `CUSTOMER_PROFILE_*`/`_ENABLED`/`_AUTH_TOKEN` (Bloque B) | Si | Si (cuando `_ENABLED=true`) | Comentario inline tambien **desactualizado** (dice "not wired", falso desde T11H/T12C) |
| Customer Profile | `CUSTOMER_PROFILE_CONTEXT_ENABLED` + 4 limites (Bloque C) | Si | Si | Correctamente documentado, sin drift |
| Carrier MS | `CARRIER_SERVICE_BASE_URL`/`_TIMEOUT_MS` | Si | Si | Ninguno - confirmado completo, sin auth requerida |
| Catalog | (sin cambios desde A11.2, no re-verificado en detalle esta pasada) | Si | Si | Sin evidencia de cambio |

No se imprimen valores de secretos en este documento.

---

## Parte 13 - Live/read-only smokes

Misma limitacion que toda esta linea de auditorias: esta sesion no tiene acceso de red a EC2/
produccion. No se realizo ningun smoke nuevo. Lo ya verificado en vivo previamente (no repetido
como hallazgo nuevo, solo referenciado): Catalog Service contra una instancia de desarrollo real
con replica de solo lectura (A11.2 Parte 17); `explore_catalog`/`get_product_details` end-to-end
via WhatsApp real en EC2 (`ACS-R1-05.1-T02.6`/`T02.6.1`, ver `docs/ACTIVE_RELEASE.md`); Carrier MS
sin autenticacion confirmado en vivo (citado en A11.3 y re-confirmado aqui por el agente de
Shipping via lectura de comentarios de codigo que documentan esa verificacion). Por instruccion
explicita de esta tarea, no se creo ninguna cotizacion real contra el Quote Service.

---

## Parte 14 - Prioridad de gaps

### P0 - riesgo real de romper algo, o ya rompiendo algo hoy

| Gap | Capa | Sintoma | Causa | Fix minimo | Riesgo si no se corrige |
|---|---|---|---|---|---|
| Idempotencia de `create_quote` | Quote, camino en vivo de A11 | Reintento tras fallo local crea una cotizacion huerfana | `validUntil` recalculado entra en el hash de idempotencia del servicio | No recalcular `validUntil` en el reintento (persistir/reusar el de la primera llamada), o antes de marcar `failed`, intentar `getQuoteByNumber` para detectar una cotizacion ya creada | Cotizaciones reales invisibles para CRM y el cliente; conteo de negocio incorrecto |
| Identidad Customer Profile | Customer Profile, hoy inerte (`CUSTOMER_PROFILE_ENABLED=false`) | Las 5 operaciones no-RFM enviarian `master_customer.id` donde se espera `ps_customer.id_customer` | Sales Agent conectado al subsistema de identidad sin puente a PrestaShop | Antes de activar el flag: conectar el runtime del Sales Agent al mismo puente que ya usa el dashboard, o bloquear el flag hasta entonces | 404 masivo o, peor, colision con cliente real equivocado, si el flag se activa sin arreglar esto primero |
| `SELECT_SHIPPING_OPTION` deadlock | R2, hoy inalcanzable | Si algun dia un intent lo genera, el work queda atascado invisible al retry worker | Executor bloquea sin reactivacion + capa semantica no puede producirlo | Cualquier trabajo futuro que conecte este step DEBE incluir el fix de `EXECUTABLE_STEP_TYPES`/`canAutoActivateStep` en el mismo cambio, nunca solo el intent del planner | Trabajo atascado silenciosamente en produccion |

### P1 - comportamiento comercial incorrecto, no rompe el sistema

- Quote: ciego a todo el ciclo de vida post-creacion (aceptacion, pago, cancelacion, estado) - ya
  senalado por A11.3, confirmado sin cambios; PDF nunca generado agrava el gap.
- Catalog: ya resuelto por el plan A11.2-B/C/D (no se re-abre aqui).

### P2 - perdida de capacidad/inteligencia, sin romper nada

- Customer Profile completamente desconectado del dominio comercial (RFM/comportamiento de compra
  sin ninguna influencia en decisiones reales, solo texto de prompt detras de un flag apagado).
- `recommend_catalog_products`/`select_shipping_option` "cableados a medias" en R2 - trabajo de
  diseño real ya existe, falta el intent del planner + (para shipping) el fix de P0.
- `READ_CAPABILITY_REGISTRY` del runtime multi-request bypasea Gateway/auditoria si ese flag se
  activa alguna vez.

### P3 - deuda tecnica/observabilidad, sin riesgo funcional hoy

- Bloque A de Customer Profile (env vars + adapter) completamente muerto, candidato a borrado.
- Comentarios `.env.example` desactualizados (Quote, Customer Profile Bloque B).
- `retryableGatewayStatuses`/`retryableOutcomeCodes` en `retryPolicy.ts` - metadata sin efecto,
  enganosa para un lector futuro.
- Comentario obsoleto en `registry.ts:430-432` sobre `recommend_catalog_products`.
- `crm_quotes`/`lib/brain/commercial/quotes/repository.ts` - funciones de escritura sin ningun
  caller, candidatas a borrado (o decidir conectarlas, una u otra cosa).
- Timeout de Quote (5000ms) insuficiente para un futuro `/issue` (15000ms reservado por el
  servicio) - sin riesgo hoy porque `/issue` nunca se llama.

---

## Parte 15 - Matriz ejecutiva

| Servicio | Service maturity | CRM wiring | Gateway | CommercialWork | Estado global |
|---|---|---|---|---|---|
| Catalog | maduro (6+T11+T12) | desactualizado (endpoint legacy) | parcial | parcial | **PARTIAL** (sin cambio, A11.2) |
| Quote | maduro (ciclo de vida completo, 16-17 endpoints) | minimo (1 de 16-17 con caller real) | parcial (1 capability) | parcial (sin seguimiento post-creacion) | **PARTIAL**, con un bug P0 en el unico camino que si usa |
| Customer Profile | maduro (7 ops reales + analitica) | drift de doble integracion + bug de identidad | no registrado | no wireado | **NOT_WIRED** (alcance del problema mas amplio que lo que decia A11.3) |
| Shipping | madurez no verificable (sin repo) | actual para `calculate_shipping`, muerto para `select_shipping_option` en R2 | registrado (2 capabilities) | parcial (1 de 2 steps ejecutable, el otro con riesgo de deadlock) | **PARTIAL** (revisado a la baja desde el `CURRENT` de A11.3, una vez conocido el estado real de `SELECT_SHIPPING_OPTION`) |

---

## Parte 16 - Roadmap propuesto

**BLOCKERS_A11** (camino en vivo, arreglar antes o junto con la operacion actual de A11):
- Fix de idempotencia de `create_quote` (P0) - es el unico gap de esta auditoria que afecta una
  capability que A11 ya ejecuta en produccion hoy.

**NEEDED_FOR_A12** (antes de extender alcance, no bloquea lo que ya existe):
- Fix de identidad de Customer Profile - obligatorio antes de poner `CUSTOMER_PROFILE_ENABLED=true`
  en cualquier ambiente real.
- Fix de `EXECUTABLE_STEP_TYPES`/`canAutoActivateStep` para `SELECT_SHIPPING_OPTION` - obligatorio
  en el MISMO cambio que cualquier intent futuro de seleccion de envio, nunca por separado.
- Wiring de ciclo de vida de Quote (estado/aceptacion/cancelacion) si el volumen de cotizaciones
  autonomas crece - decision de producto, no bloqueante hoy.

**NEEDED_FOR_A13 / OPTIONAL**:
- Intent nuevo del planner para `recommend_catalog_products` (ya senalado como G5 en A11.2, sigue
  vigente).
- Customer Profile como capability real (filtrado por recompra, cadencia por historial) - requiere
  el fix de identidad primero.
- Wiring de emision de PDF (`issue`) - solo si se prioriza seguimiento de cotizaciones.

**OPTIONAL/LATER** (limpieza, cero riesgo funcional):
- Borrar Bloque A de Customer Profile (env vars + adapter muerto).
- Corregir comentarios desactualizados en `.env.example` (Quote, Customer Profile Bloque B) y en
  `registry.ts:430-432`.
- Decidir sobre `retryableGatewayStatuses`/`retryableOutcomeCodes` (conectarlos o borrarlos).
- Decidir sobre `crm_quotes`/`quotes/repository.ts` (conectarlo o borrarlo).

No se recomienda arreglar todo antes de continuar - la mayoria de estos gaps son inertes hoy
(gateados por flags apagados o por rutas semanticas inalcanzables). El unico que exige accion
inmediata es el bug de idempotencia de Quote, porque es el unico que ya corre en produccion.

---

## Parte 17 - Que NO tocar

Confirmado correcto y alineado con los principios del proyecto, sin evidencia que justifique
tocarlo en ninguno de los cuatro servicios:

- El nucleo del Capability Gateway (schema, governance, `crm_capability_executions`, mapeo de
  errores HTTP → outcome).
- La persistencia/secuenciacion/reintentos/outbox/follow-up de CommercialWork (mecanismo, no la
  cobertura de step types, que si tiene gaps documentados arriba).
- El contrato real de `CarrierService.quoteAll` - minimo y suficiente para lo que necesita.
- `set_shipping_destination` en ambos runtimes - completamente funcional.
- La resolucion de identidad a nivel de orquestador para `resolve_customer`/`create_customer`/
  `link_external_identity` - deliberadamente no expuesta como tool, correcto por diseño.
- La orquestacion de Catalog (Gateway/executor/evidence) per A11.2 Parte 18/21 - solo el backend de
  endpoint elegido esta mal, no la arquitectura.

---

## Parte 18 - Documentos existentes usados

`SALES-AGENT-R2-A10-capability-coverage-runtime-correctness-audit.md`,
`SALES-AGENT-R2-A11-autonomous-runtime-operationalization-controlled-rollout.md`,
`SALES-AGENT-R2-A11.1-owner-only-live-fixes-product-discovery.md`,
`SALES-AGENT-R2-A11.2-catalog-service-integration-audit.md`,
`SALES-AGENT-R2-A11.2-A2-legacy-catalog-flow-recovery-audit.md`,
`SALES-AGENT-R2-A11.3-integration-contract-audit.md`,
`SALES-AGENT-R2-capability-coverage-matrix.md`. Ninguna auditoria previa fue repetida ni
contradicha sin evidencia nueva citada explicitamente (ver refinamientos senalados en Partes 5 y 6).

---

## Parte 19 - Veredicto

```
CATALOG            = PARTIAL            (sin cambio, ver A11.2)
QUOTE               = PARTIAL            (bug P0 de idempotencia en el unico camino con uso real)
CUSTOMER_PROFILE    = NOT_WIRED          (alcance del problema de identidad mas amplio que A11.3)
SHIPPING             = PARTIAL            (revisado a la baja: SELECT_SHIPPING_OPTION no es solo
                                           "no ejecutable", es inalcanzable + riesgo de deadlock)
```

**Veredicto global: CROSS_SERVICE_INTEGRATION_PARTIAL.**

No se declara `BLOCKED`: ningun gap de esta auditoria desactiva funcionalidad que A11 ya opera hoy,
salvo el bug de idempotencia de Quote, que es un caso de borde (solo se manifiesta en un reintento
tras un fallo de persistencia local) y no una falla sistemica. No se declara `READY`: hay tres
hallazgos P0 reales (uno en vivo, dos latentes) que deben resolverse antes de expandir el alcance
actual de A11 hacia Quote lifecycle, Customer Profile, o cualquier intent nuevo de seleccion de
envio.

## Criterio de salida

1. **Archivos cambiados**: ninguno de codigo. Un archivo nuevo, este documento.
2. **Que se valido**: lectura directa de codigo real en 3 repos (CRM, Quote Service, Customer
   Profile), git log/diff contra los HEAD auditados por A11.3 para confirmar ausencia/presencia de
   drift desde entonces, grep exhaustivo para cada afirmacion de "cero referencias"/"cero callers".
   Sin smoke live nuevo (sin acceso de red desde esta sesion, misma limitacion de toda la linea).
3. **Entrega**: exclusivamente documental, sin cambios funcionales, tal como exigia el alcance.
4. **Riesgos/deuda pendiente**: ver Parte 14 completa. El unico item que exige accion antes de
   continuar con trabajo nuevo sobre Quote es el bug de idempotencia (P0, camino en vivo); los
   otros dos P0 son inertes hoy pero deben resolverse en el mismo cambio que active/conecte lo que
   los activaria (flag de Customer Profile, intent de shipping option).
