---
title: "Domain & Microservice Boundary Audit — R3 Commercial Agent"
status: proposed
date: 2026-09-15
scope: R3 Commercial Agent, CommercialWork y servicios de dominio comerciales
authority: audit-only
---

# Domain & Microservice Boundary Audit — R3 Commercial Agent

Este documento audita los límites entre el runtime comercial consolidado y los
servicios de dominio que debe consultar o mutar. Es una auditoría de contratos,
ownership, frescura e integración; no implementa cambios de código, configuración,
migraciones ni producción.

La evidencia principal es el código y la documentación activa del repositorio al
2026-09-15. Los documentos en `docs/legacy/` y `docs/archive/` no se usan como
autoridad arquitectónica. La arquitectura objetivo se toma como decisión previa:

```text
WhatsApp Adapter
  -> Turn Settlement
  -> CommercialWork Durable Case Kernel
  -> Context Compiler
  -> R3 Cognition Harness / DeepSeek
  -> Governed Capability Gateway
  -> Domain Service / Domain Mutation
  -> CommercialWork Reprojection
  -> R3 Response
  -> Canonical Outbox
```

Referencias rectoras: [PRODUCT_NORTH_STAR](../PRODUCT_NORTH_STAR.md),
[ACTIVE_RELEASE](../ACTIVE_RELEASE.md) y la decisión de consolidación en
[ADR-R3-commercial-runtime-consolidation](./ADR-R3-commercial-runtime-consolidation.md).

## 1. Executive summary

El ownership de los dominios está razonablemente separado. No hay evidencia que
justifique crear otro microservicio ni mover la autoridad de Customer, Catalog,
Shipping o Quote a CommercialWork o al modelo. El problema principal está en la
frontera de integración: el runtime tiene varias rutas y varios compiladores de
contexto, y no existe todavía un contrato único que entregue a R3 el estado de
caso, objetivo activo, estado comercial actual, identidad gobernada y evidencia
con su frescura.

Los hallazgos de mayor impacto son:

1. **Customer Profile está integrado en el ciclo nativo, pero no en la decisión de
   R3.** `runNativeAutonomousCycle` carga `customer360`, pero
   `buildMinimalCommercialContextSummary` lo omite. Por ello R3 pierde señales de
   historial, RFM, relaciones y cotizaciones recientes antes del prompt de
   DeepSeek. La integración existente no debe confundirse con consumo efectivo.
2. **Catalog mantiene un riesgo de snapshot stale, no un namespace roto demostrado.**
   El adaptador normaliza a string los IDs, pero tanto semantic discovery como
   details usan IDs numéricos positivos de catálogo. La inferencia más probable
   para `semantic productId -> product_not_found` es que el snapshot semántico
   publicado conserva un producto que ya no resuelve en el catálogo vivo. Falta
   correlación con respuestas upstream y snapshots para probarlo.
3. **Quote Service es la autoridad de quote, pero `issue_quote` no valida toda la
   grounding cross-domain.** El quote tiene `version`, snapshot de líneas,
   idempotencia y `validUntil`, pero el locator CRM sólo conserva un
   `selectionFactId`. Antes de emitir se debe comparar el quote fresco con el
   carrito, destino y shipping actuales. Esa invariante pertenece al capability o
   al borde de Quote, no a DeepSeek ni a una copia de totales en CommercialWork.
4. **Shipping ya detecta stale por anchors, pero no expone un estado de lectura
   uniforme.** Cambiar carrito o destino genera nuevos fact IDs y vuelve obsoleta
   la selección anterior. La defensa actual rechaza la selección al consumirla;
   el futuro read model debe representarla explícitamente como `STALE` y exigir
   recálculo.
5. **Identity está bien gobernada en el servidor, pero debe entrar al contrato de
   turno como policy, no como PII.** Customer Service y
   `customer_external_identity` son la autoridad para resolución/linking; el
   runtime identity resolver produce la sesión confiable del turno. DeepSeek sólo
   necesita nivel/estado de identidad y acciones permitidas.

| Área | Estado de contrato de dominio | Calidad de integración R3 | Acción recomendada |
|---|---|---|---|
| Customer Profile / Customer360 | READY_WITH_ADAPTER | PARTIAL | Proyectar campos allowlisted en el compiler R3, con política condicional |
| Catalog | NEEDS_CONTRACT_CHANGE | STALE-RISK | Vincular lineage semántico con catálogo vivo y observar los 404 posteriores |
| Quote Service | NEEDS_INVARIANT_FIX | STALE-RISK | Validar grounding de cart/destination/shipping antes de `issue_quote` |
| Shipping / Carrier | NEEDS_INVARIANT_FIX | STALE-RISK | Exponer freshness explícita y bloquear selección stale |
| Customer Identity / Customer Service | READY_WITH_ADAPTER | PARTIAL | Unificar proyección de sesión/policy en `AgentTurnInput` |
| Capability Gateway | READY_AS_IS | GOOD | Mantenerlo como única frontera de ejecución gobernada |

La prioridad no es rediseñar microservicios. Es consolidar el contrato de lectura
que alimenta cada decisión y eliminar duplicación de context compilers sólo cuando
exista una ruta de migración verificable.

## 2. Domain ownership map

### 2.1 Matriz de límites

| Domain/Service | Canonical owner of | Canonical IDs | Read API | Mutation API | Version/Freshness | Agent capabilities | AgentTurnInput fields | Current integration quality |
|---|---|---|---|---|---|---|---|---|
| CommercialWork | Case comercial durable, objective, work lifecycle, blockers, readiness y reprojection | `caseId`/opportunity, `workId`, `objectiveId`, aggregate `version`, `conversationSequence` | Projection durable de CommercialWork y turn settlement | Settlement/reconciliation de objetivos y pasos; no muta verdad de dominio | Aggregate version separado de conversation/commercial sequence; evidence refs | Planner/reconciliation y ejecución interna; no expone acceso directo al modelo | `caseState`, `activeObjective` | GOOD como kernel; MISSING como input directo de R3 |
| Customer Profile | Perfil operativo/analítica PrestaShop, resumen comercial, compras, RFM e historial de órdenes | `ps_customer.id_customer` / `customerId`; `productId`, `productAttributeId` históricos | `/v1/customers/:id/profile`, `commercial-summary`, `purchased-products`, `purchase-behavior`, `/rfm`, order status | Ninguna mutación de identidad ni de customer master | `retrievedAt`, readiness y provenance; order tracking no es real-time | Context loader interno; no debe ser escritura del agente | `customerContext.profile`, `relevantEvidence` | PARTIAL |
| Customer360 local | Read model nativo de conversaciones, oportunidades, perfiles, quotes, órdenes, addresses y eventos | local `customerId`, conversation/opportunity IDs; quote refs | Query service local de `Customer360Snapshot` | Ninguna desde este boundary | `snapshotVersion`; freshness por última actividad, ventana actual 7 días | Contexto reducido de ciclo nativo | `customerContext.profile` condicional, nunca autoridad de identidad | DUPLICATED |
| Catalog Service | Identidad de producto/variante, SKU, precio, stock, disponibilidad, peso, links y compatibilidad según su contrato | `productId`, `combinationId`; SKU/reference como identificadores legibles | `/v1/products/search`, `/:productId`, `/batch`, `/explore`, semantic discovery y resolución de intent | Ninguna en la superficie del agente | `retrievedAt`, `cached`, semantic/published snapshot lineage | `search_products`, `get_product_details`, `batch_get_products`, `explore_catalog`, `search_products_by_semantics`, `recommend_catalog_products` | `commercialState.cart`, `relevantEvidence` | STALE-RISK |
| Shipping Destination | Destino comercial confirmado por resolver de comuna y su fact activo | `destinationFactId`, `communeId` | Active request fact; read model de destino | `set_shipping_destination` | Fact ID y `updatedAt`; cambio supersede el fact activo anterior | `set_shipping_destination` | `commercialState.destination` | GOOD |
| Carrier/Shipping calculation | Cobertura, carriers, servicios, costos y ETA calculados para cart/destination | `shippingQuoteExecutionId`, option index del cálculo, cart/destination fact IDs | `calculate_shipping` y execution evidence | Sólo selección confirmada en dominio de shipping | Execution timestamp y anchors de selección; no debe asumirse durable como current si anchors cambian | `calculate_shipping` | `commercialState.shipping`, `relevantEvidence` | PARTIAL |
| Selected Shipping Option | Opción seleccionada y sus anchors de cart/destination/cálculo | `shippingSelectionFactId`, `shippingQuoteExecutionId`, `destinationFactId`, `selectionFactId` | Active selected option + freshness check | `select_shipping_option` | Freshness se valida por comparación de fact IDs al consumir; row puede permanecer confirmada | `select_shipping_option` | `commercialState.shipping` | STALE-RISK |
| Quote Service | Quote, pricing final del quote, lifecycle, snapshot de líneas, documento y delivery | `quoteId`, `quoteNumber`, Quote `version`/`revision`, `validUntil` | `getQuote`, by number, delivery, list deliveries | `createQuote`, `updateDraft`, `issueQuote`, `sendQuoteEmail` | Version optimista, status, validity y delivery status | `create_quote`, `get_quote`, `issue_quote`, `send_quote_email` | `commercialState.quote`, `relevantEvidence` | STALE-RISK |
| Customer Identity / Customer Service | Customer Master identity, external identity resolution, create/link y requisitos de verificación | `customerMasterId`/`master_customer.id`, external identity ref, PrestaShop customer ID | `resolve_customer`; local identity/session resolution | `create_customer`, `link_external_identity`, `link_prestashop_identity` | Trusted session de este turno; estados de resolución/linking y policy | `resolve_customer` y identity operations internos/gobernados | `customerContext.identity`, `executionPolicy` | PARTIAL |
| Capability Gateway | Registro, autorización, identity gate, disponibilidad, retry acotado, audit y execution evidence | `capabilityName`, execution ID, idempotency key | Registry, availability y execution audit | Ejecuta capabilities autorizadas; no posee estado de dominio | Retry policy y execution status; evidencia con correlation/anchors | Todas las capabilities del agente | `capabilities`, `relevantEvidence`, `executionPolicy` | GOOD |
| AgentSession / R3 Runtime | Memoria conversacional, harness, prompting y Cognition loop | session/correlation IDs, compaction/session version | Persistent session y compact history | Append/compaction de memoria conversacional; no muta dominio | Session/compaction version, turn ordering | Cognition y selección de capability | `conversationContext`, `currentTurn` | DUPLICATED |

### 2.2 Regla de separación de datos

Cada turno debe separar explícitamente cuatro clases:

| Clase | Significado | Ejemplos | Puede decidir como verdad actual |
|---|---|---|---|
| CURRENT STATE | Estado vigente leído desde el owner, con anchor/version verificable | Cart actual, destino activo, Quote fresco, shipping selection fresca | Sí, sujeto a precondiciones del capability |
| RELEVANT CONTEXT | Contexto útil para interpretar el turno, no necesariamente fuente de verdad | Objective, perfil reducido, compact history, need profile | Sí para orientar; no para inventar hechos |
| DISCOVERABLE INFORMATION | Resultado que sirve para descubrir candidatos o alternativas | Semantic discovery, recomendaciones, catálogo explorado | No sin hidratación/revalidación del owner |
| MUTABLE DOMAIN STATE | Cambio que sólo puede ocurrir por un capability gobernado | Set destination, select shipping, create/issue quote, link identity | Sólo Gateway + domain service |

El modelo no debe reconstruir `CURRENT STATE` juntando fragmentos históricos,
candidate IDs o respuestas de turnos anteriores.

## 3. Customer Profile

### 3.1 Boundary y autoridad

Customer Profile es un read service de perfil y comportamiento comercial basado en
la fuente PrestaShop/direct source. Su contrato declara que el espacio numérico de
`ps_customer.id_customer` se usa de forma consistente en sus operaciones. El campo
wire `masterCustomerId` que puede aparecer en la respuesta RFM no convierte ese
servicio en autoridad de `master_customer`; semánticamente sigue siendo el ID de
cliente PrestaShop descrito por el contrato.

El contrato actual cubre:

- perfil y linkage PrestaShop;
- resumen de órdenes, gasto, AOV, primera/última orden y moneda;
- productos comprados y variantes históricas;
- concentración de compras y top products/variants;
- RFM y readiness;
- estado de una orden, explícitamente `isRealTimeTracking: false`.

La fuente no es autoridad para cart, precio/stock actuales, destino, carrier, quote,
case, objective, permisos ni identidad Customer Master. Tampoco debe decidir el
ranking de Catalog ni excluir automáticamente productos comprados. Esas
restricciones ya están reflejadas en el loader de señales comerciales:
`mayAlterCatalogRanking: false`, `mayAutoExcludePurchasedProducts: false` y
`monetaryInterpretation: INFORMATIONAL_ONLY`.

Referencias: [Customer Profile types](../../lib/integrations/customer-profile/types.ts),
[HTTP client](../../lib/integrations/customer-profile/http-client.ts) y
[customer-profile context loader](../../lib/brain/commercial/customer-profile-context/loader.ts).

### 3.2 Lecturas, estados y frescura

| Lectura | Uso | Estado autoritativo | Límite |
|---|---|---|---|
| `profile` | Nombre/display y linkage operativo | Disponible según contrato/readiness | No resuelve Customer Master |
| `commercial-summary` | Señales agregadas de relación comercial | Snapshot de la fuente al `retrievedAt` | No es precio ni estado comercial actual |
| `purchased-products` | Historial de productos/variantes | Historial; puede marcar `deleted_or_unavailable` | No debe excluir ni reordenar Catalog automáticamente |
| `purchase-behavior` | Concentración y top products/variants | Señal derivada | No es recomendación final ni stock actual |
| `rfm` | Segmentación/recencia/frecuencia/monetario | Señal derivada con interpretación informativa | No autoriza acciones sensibles |
| order status | Contexto de pedido | Puede estar disponible, pero no real-time tracking | No presentarlo como tracking en vivo |
| native Customer360 | Relaciones, conversaciones, quotes y actividad local | Read model local distinto del servicio remoto | No mezclar silenciosamente sus autoridades |

Los estados de loader (`AVAILABLE`, `PARTIAL`, `NOT_FOUND`, `UNAVAILABLE`,
`CONTRACT_ERROR`, `IDENTITY_UNAVAILABLE`, `DISABLED`) son parte del contexto y no
deben convertirse en hechos positivos. Un timeout o servicio deshabilitado debe
degradar el contexto y no generar una recomendación ficticia.

### 3.3 Consumo efectivo en R3

La integración actual tiene dos capas diferentes:

1. El ciclo nativo resuelve `customer360` y carga un contexto reducido allowlisted.
2. La rama R3 construye `buildMinimalCommercialContextSummary` con opportunity,
   need profile, destination, line items y los últimos mensajes, pero no agrega
   `customer360` ni las señales de `customer-profile-context`.

Por lo tanto, Customer Profile/Customer360 está **disponible en el ciclo**, pero
no está **consumido por la decisión R3**. Las señales perdidas incluyen historial
de compra, RFM, purchase behavior, relaciones y los últimos quotes del snapshot
local. El quote del Customer360, aun si se proyectara, seguiría siendo evidencia
local: la autoridad del quote actual es Quote Service.

La corrección es un cambio de compiler: incluir sólo campos allowlisted y
condicionales en `customerContext` y `relevantEvidence` de `AgentTurnInput`. No se
debe volcar el payload completo ni exponer PII, raw IDs o respuestas backend.

Referencias: [native cycle](../../lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts),
[minimal R3 summary](../../lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts),
[autonomous Customer360 context](../../lib/brain/commercial/context/autonomousCustomerContext.ts) y
[Customer360 service](../../lib/domains/customer-360/service.ts).

### 3.4 Campos que deben llegar a `AgentTurnInput`

| Campo | Cuándo | Tratamiento |
|---|---|---|
| `identity.status`, `identity.identityLevel`, `hasResolvedCustomer` | Siempre | Estado/policy, sin identificadores crudos |
| `profile.displayName` y `emailAvailable` | Si están permitidos y disponibles | Allowlist mínima |
| `relationshipSummary` | Si el objetivo requiere entender relación | Conteos y timestamps, no mensajes completos |
| `purchaseSignals` / RFM | Recommendation, repeat purchase, cross-sell, upsell o consulta histórica | Señal informativa con provenance y timestamp |
| `recentOrders` | Si la petición refiere órdenes o recompra | Resumen acotado; no asumir tracking en vivo |
| `customer360.quotes` | Sólo como evidencia relacionada | Locator/status local; Quote Service debe revalidar |
| `warnings/dataQuality` | Si hay partial/stale/unavailable | Debe permanecer visible para no sobreafirmar |

## 4. Catalog Service

### 4.1 Autoridad y contratos

Catalog Service es dueño de identidad y hechos actuales del catálogo: producto,
variante, SKU/reference, descripción, precio, impuestos según su contrato,
stock, disponibilidad, peso, link público y compatibilidad cuando aplica. El
runtime comercial conserva selección durable de identidad y cantidad, pero no
duplica precio, peso, stock, total ni carrier.

La frontera está representada por [CatalogPort](../../lib/catalog/types.ts) y
[HTTP Catalog Adapter](../../lib/catalog/httpCatalogAdapter.ts). El adapter hace
una única llamada física; retry, identity, audit y policy pertenecen al Gateway.

### 4.2 ID namespace

El contrato lógico del runtime expone IDs como strings para evitar acoplar el modelo
a una representación de transporte. Eso no implica un namespace distinto:

| Campo | Significado | Fuente/uso | Regla |
|---|---|---|---|
| `productId` | Identidad del producto Catalog | search, details, batch, semantic, recommendation | Canonical Catalog product ID; normalizado a string en `CatalogPort` |
| `combinationId` | Identidad de variante/combinación | details, batch, selección | Debe permanecer separado de `productId` |
| `sku` / `reference` | Identificador comercial legible | Catalog y quote line | No sustituye el ID canónico |
| `productAttributeId` | ID histórico observado en Customer Profile | Purchased products/variants | No mezclarlo con `combinationId` sin mapping explícito |
| semantic snapshot product ID | Producto candidato publicado | semantic discovery | Requiere hidratación contra Catalog vivo |

La evidencia del adapter muestra que semantic discovery y get details aceptan IDs
numéricos positivos y los normalizan internamente a string. Por eso **no está
demostrado un bug de conversión o dos namespaces internos en esos dos endpoints**.
Sí existen varios contratos y generaciones de endpoint (`/v1` semantic/details,
resolución T12 en `/api/v2`, recomendaciones con su propio contrato), lo que deja
un riesgo de drift que debe formalizarse.

### 4.3 Diagnóstico de `semantic productId -> product_not_found`

El resultado semántico contiene identidad y elegibilidad, pero deliberadamente no
contiene precio, stock, variantes actuales ni link. El capability indica que una
respuesta positiva debe seguirse con `get_product_details`. Un 404 de details se
convierte correctamente en `product_not_found`.

Con la evidencia disponible, la causa más probable es:

```text
semantic/published snapshot
  -> conserva productId P
  -> catálogo vivo ya no resuelve P
     (producto desactivado/eliminado o lag de publicación)
  -> get_product_details(P) = 404
```

Esto es una inferencia, no un incidente probado. Para confirmarla se necesitan el
`productId` concreto, la respuesta upstream, el `semanticSnapshotId`/checksum y
el estado del producto en la misma ventana temporal. Una deriva de namespace
upstream sigue siendo posible, pero el código local no la demuestra.

### 4.4 Current truth versus evidence

| Dato | Clasificación | Regla para el agente |
|---|---|---|
| Producto/variante seleccionado en cart | Current identity state | Puede entrar siempre con cart fact ID |
| Nombre, SKU, precio, stock, peso, availability | Current Catalog state sólo después de lectura fresca | Revalidar antes de quote/order y cuando cambie la necesidad |
| Semantic discovery result | Discoverable information | No usar como precio/stock ni como existencia final |
| Recommendation/relationship result | Relevant evidence | Rehidratar candidatos en Catalog vivo |
| `recentCatalogContext` | Historical/relevant evidence | No presentar como precio/stock actual |
| `pendingCatalogAction` | Continuity evidence | No usar como estado actual ni permiso |

Referencias: [Catalog boundary ADR](../../docs/architecture/adr/ADR-005-catalog-boundary.md)
(ruta relativa desde este documento: [ADR-005](../architecture/adr/ADR-005-catalog-boundary.md)),
[semantic capability](../../lib/brain/commercial/capability-gateway/searchProductsBySemanticsCapability.ts),
[recent catalog context](../../lib/brain/commercial/capability-gateway/recentCatalogContext.ts) y
[pending catalog action](../../lib/brain/commercial/capability-gateway/pendingCatalogAction.ts).

## 5. Quote Service

### 5.1 Boundary y autoridad

Quote Service es la autoridad de:

- quote ID/number, lifecycle y status;
- snapshot de customer y line items;
- pricing, impuestos, moneda y total del quote;
- validity (`validUntil`), `version`/`revision`;
- issued document y estado de delivery.

El runtime comercial selecciona identidad y cantidad; Catalog aporta hechos de
producto y precio; Quote Service calcula y congela su snapshot. CommercialWork
sólo debe conservar un locator/evidence reference suficiente para referenciar el
quote y bloquear objectives, no una segunda copia de lifecycle o totales.

Referencias: [Quote Service types](../../lib/domains/quote-service/types.ts),
[HTTP adapter](../../lib/integrations/quote-service/httpQuoteServiceAdapter.ts),
[create capability](../../lib/brain/commercial/capability-gateway/createQuoteCapability.ts),
[issue capability](../../lib/brain/commercial/capability-gateway/issueQuoteCapability.ts) y
[quote adapter contract](../integrations/quote-service-adapter.md).

### 5.2 Estado y versioning

El contrato externo tiene buenas protecciones internas: `idempotencyKey` en
mutaciones, `expectedVersion` para drafts/issue, status, `validUntil`, snapshot de
líneas y delivery status. Esto es suficiente para concurrencia y lifecycle dentro
de Quote Service.

La creación actual arma la entrada desde la selección durable y lecturas vivas de
Catalog. El dedupe reutiliza un `created_quote` sólo cuando coincide el
`selectionFactId`. El locator CRM guarda `quoteId`, number, status, currency,
total, validity, selection fact e idempotency key. Actualmente `requireShipping`
es `false` porque Carrier no entrega todavía metadata fiscal suficiente para una
línea de shipping en el quote.

### 5.3 Gap de grounding antes de issue

`issue_quote` lee Quote Service justo antes de emitir y reutiliza quotes que ya no
están en draft. Para un quote draft, usa la versión de Quote Service como
`expectedVersion`. Pero hoy no compara de forma completa:

- las líneas del quote contra el cart actual de Catalog;
- `selectionFactId` actual contra el locator/quote;
- `destinationFactId` actual;
- `shippingSelectionFactId` o el cálculo de shipping actual;
- la versión de estado comercial que originó la selección.

Consecuencia: Quote Service puede tener un quote internamente consistente, pero
desfasado respecto del caso comercial actual. Esta no es una razón para hacer que
CommercialWork sea dueño de pricing; es una **invariante cross-domain faltante**.

La validación debe vivir en el capability boundary o en un validador de grounding
del dominio Quote, ejecutado antes de la mutación:

```text
fresh Quote Service quote
  + fresh CommercialDomainReadModel
  + current selection/destination/shipping anchors
  -> grounding valid? issue_quote : block as stale evidence
```

La solución futura puede extender el contrato del quote con anchors de cart,
destino y shipping. No se recomienda inventar esos campos en CommercialWork ni
implementarlos en esta auditoría.

### 5.4 AgentTurnInput

`commercialState.quote` debe contener una proyección mínima del quote actual:
`quoteId`, `quoteNumber`, `status`, `currency`, `total`, `validUntil`, `version`,
`freshness` y grounding status. Las líneas completas entran sólo cuando el turno
discute, revisa o emite el quote. `issue_quote` siempre debe revalidar aunque el
modelo haya leído el quote en el prompt.

## 6. Shipping

### 6.1 Ownership

Shipping Destination es dueño de la resolución de comuna y del fact de destino.
Carrier/Shipping calculation es dueño de cobertura, carrier, servicio, costo y
ETA calculados sobre una combinación concreta de carrito y destino. Selected
Shipping Option es dueño de la selección durable de una opción observada.

El modelo nunca inventa costos ni selecciona un carrier por nombre libre. Sólo
puede proponer un `optionIndex` derivado de una ejecución observada; el servicio
resuelve la opción y valida su freshness.

Referencias: [destination service](../../lib/domains/shipping-destination/service.ts),
[commercial line items](../../lib/domains/commercial-line-items/service.ts),
[selected shipping option](../../lib/domains/selected-shipping-option/service.ts),
[calculate capability](../../lib/brain/commercial/capability-gateway/calculateShippingCapability.ts),
[select capability](../../lib/brain/commercial/capability-gateway/selectShippingOptionCapability.ts) y
[latest shipping projection](../../lib/brain/commercial/agent-loop/resolveLatestShippingQuoteContext.ts).

### 6.2 Anchors y stale behavior

El cart durable contiene `productId`, `combinationId`, `quantity`, `factId` y
`updatedAt`; no contiene precio, peso, total ni carrier. El destino contiene
`communeId`, nombre canónico, `factId` y timestamp. Una selección de shipping
contiene, entre otros, `selectionFactId`, `destinationFactId`, execution ID,
opción, costo y ETA.

El cálculo rehidrata Catalog para peso/precio y consulta Carrier. La selección
compara los anchors observados con los facts activos. Si cambia el carrito o el
destino, el fact anterior queda superseded y la selección previa deja de ser
consumible como current. Hoy la fila puede seguir marcada como confirmada hasta
que una lectura ejecute el check; esa defensa es correcta, pero la proyección
unificada debe exponer:

```text
selected shipping option
  - CURRENT  si selectionFactId y destinationFactId coinciden
  - STALE    si alguno difiere
  - MISSING  si no existe selección/calculation utilizable
```

Una opción `STALE` no debe entregarse como alternativa vigente ni entrar en un
quote sin recálculo. Una transición explícita de estado/invalidation event puede
ser una mejora posterior, pero no es necesaria para decidir el boundary actual.

### 6.3 Gap de quote/shipping

La creación de quote actual no incluye shipping porque el contrato de Carrier no
entrega todavía option ID/code, moneda y metadata fiscal requeridos. Esto debe
quedar visible como gap de contrato, no resolverse copiando una tarifa calculada
en CommercialWork. Cuando se habilite shipping en Quote Service, el quote debe
guardar sus propios datos y grounding anchors.

## 7. Customer Identity

### 7.1 Autoridad y separación

| Necesidad | Owner | Dato que puede cruzar al turno |
|---|---|---|
| Resolver un external identity a Customer Master | Customer Service + `customer_external_identity` | `hasResolvedCustomer`, nivel/status y policy |
| Crear o linkear identidad | Customer Service, vía Gateway y consentimiento | Resultado de operación y próximo estado |
| Resolver identidad local del canal | Local identity resolver / runtime session | Estado confiable de sesión |
| Verificación requerida | Identity policy/evaluator | `verificationRequired`, acción bloqueada/permitida |
| Perfil e historial comercial | Customer Profile / Customer360 | Señales allowlisted y provenance, no autoridad de identidad |

`master_customer` y `customer_external_identity` son channel-neutral. El
`RuntimeIdentityContext` sigue siendo provisional mientras no exista resolución
definitiva y no debe presentarse como Customer Master. Customer Profile usa
principalmente el ID numérico PrestaShop, que es complementario, no sustituto de
`customerMasterId`.

Referencias: [runtime identity context](../../lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext.ts),
[customer session types](../../lib/brain/commercial/native-cycle/customer-session/types.ts),
[session resolver](../../lib/brain/commercial/native-cycle/customer-session/resolveNativeCustomerSession.ts),
[Customer Service types](../../lib/domains/customer-service/types.ts),
[Customer Service adapter](../../lib/integrations/customer-service/http-adapter.ts) y
[identity gate](../../lib/brain/commercial/identity/commercial-identity-requirement/identityGate.ts).

### 7.2 Lo que DeepSeek debe saber

El contexto del modelo puede contener `identityLevel`, status (`ANONYMOUS`,
`MASTER_RESOLVED`, `PRESTASHOP_LINKED`, `NEEDS_VERIFICATION`, `AMBIGUOUS`,
`CONFLICT`, etc.), `knownCustomer`/`hasResolvedCustomer` y las categorías de
acciones efectivamente permitidas. No debe contener raw `wa_id`, teléfono,
email, customer IDs, external IDs, order references, evidence refs, SQL, headers
ni texto de consentimiento.

Los permisos no se deciden en el prompt. `identityGate` y la policy server-side
deben bloquear o permitir capabilities; `executionPolicy` sólo comunica el
resultado efectivo al modelo.

## 8. Capability Gateway map

El Gateway es una frontera de ejecución, no un microservicio dueño de verdad
comercial. Debe seguir siendo el único camino de Cognition hacia capacidades con
side effects, y el lugar común para registro, availability, identity gate, retry
acotado, idempotencia, audit y execution evidence.

| Capability | Domain owner | Reads | Writes/side effect | Preconditions | Output para el runtime |
|---|---|---|---|---|---|
| `search_products` | Catalog | Product intent/query | Ninguno | Query válida; discovery permitido | Candidatos de identidad/evidencia; revalidar hechos |
| `get_product_details` | Catalog | Producto/variante vivo | Ninguno | `productId` válido | Nombre, SKU, precio, stock, availability, peso, link |
| `batch_get_products` | Catalog | Productos/variantes | Ninguno | IDs válidos; capability interna | Hydration para shipping y assembly |
| `explore_catalog` | Catalog | Scope/ranking del catálogo | Ninguno | Scope válido | Set explorado; no reemplaza details |
| `search_products_by_semantics` | Catalog | Published semantic snapshot | Ninguno | Axis/code registry válidos | IDs, elegibilidad y lineage; nunca precio/stock actual |
| `recommend_catalog_products` | Catalog | Producto origen y relaciones | Ninguno | Source product y policy | Recomendaciones; hidratar en Catalog vivo |
| `set_shipping_destination` | Shipping Destination | Input resuelto + active fact | Persiste/supersede destination fact | Resolución inequívoca | Destino canónico, fact ID y estado |
| `calculate_shipping` | Shipping/Carrier | Cart, destino y Catalog hydration | Execution evidence | Cart/destination actuales | Options, costo, ETA, anchors y execution ID |
| `select_shipping_option` | Selected Shipping Option | Previous calculation evidence + active anchors | Persiste selected option fact | Option index observado y freshness válida | Selección current o bloqueo stale |
| `create_quote` | Quote capability + Quote Service | Cart, Catalog, identity, optional shipping | Crea Quote y locator CRM | Identity y selección; idempotency | Quote locator/status/totals del owner |
| `get_quote` | Quote Service | Quote fresco por ID/locator | Ninguno | Locator/quote ID | Proyección de status/total/validity/document |
| `issue_quote` | Quote Service | Quote fresco + DomainReadModel | Emite quote | Draft, version y grounding cross-domain | Estado emitido o blocker stale |
| `send_quote_email` | Quote Service delivery | Quote emitido/documento/recipient | Solicita delivery async | Documento y destinatario válidos | Delivery request/status |
| `resolve_customer` | Customer Service | Canal/external identity | Ninguno | Input trusted y policy | Resultado de resolución; no raw identity al modelo |
| `create_customer` | Customer Service | Datos permitidos/consent | Crea Customer Master | Identity requirement/consent | Resultado y estado de linking |
| `link_external_identity` | Customer Service | Customer Master + external ref | Link duradero | Consentimiento y verification | Estado de linking |
| `link_prestashop_identity` | Customer Service | Master + PrestaShop identity | Link duradero | Policy y evidencia | Estado de linking |
| Customer Profile context loader | Customer Profile | Profile/history/RFM/summary | Ninguno | Necesidad condicional y identity | Evidence allowlisted con quality/freshness |

No existe en el registry actual una capability `record_customer_interest`; no debe
aparecer en el contrato como si existiera. Tampoco debe exponerse al modelo un
alias directo a ports o HTTP adapters.

## 9. Current context wiring

### 9.1 Ruta observada

La ruta actual no es todavía el contrato consolidado:

```text
Inbound turn
  -> native/session resolution
  -> native Customer360 load
  -> buildNativeCommercialContext
  -> CommercialWork projection/planner (en la ruta CW)
  -> o buildMinimalCommercialContextSummary (en la rama R3)
  -> AgentSession / runAgentToolLoop
  -> Gateway capabilities
```

CommercialWork actualmente carga hechos de shipping seleccionado, created quote,
capability executions y recent catalog context, pero el planner R2/CW usa un
summary reducido. La rama R3 recibe el summary mínimo y el runtime cognitivo no
recibe `caseState`, `activeObjective` ni `customer360` como campos estructurados.

Además, `runAgentToolLoop` agrega `latestShippingQuote` de forma ad hoc antes del
prompt y después de un refresh. Esa proyección es útil y cuenta con freshness
check, pero debe converger al mismo `DomainReadModel`, no permanecer como un
parche paralelo.

Referencias: [CommercialWork inbound cycle](../../lib/brain/commercial/work/runCommercialWorkInboundCycle.ts),
[R3 runtime cycle](../../lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts),
[agent loop](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts),
[prompt package](../../lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts) y
[CommercialWork projection](../../lib/brain/commercial/work/buildCommercialWorkProjection.ts).

### 9.2 Clasificación del wiring existente

| Campo/resumen actual | Decisión | Destino en el contrato consolidado | Motivo |
|---|---|---|---|
| `opportunityStatus` / `opportunityStage` | REPLACE | `caseState`/`activeObjective` | Opportunity no es el case kernel completo |
| `needProfile` | SPLIT | Requirements en objective; señales de perfil en `customerContext` | Separar intención actual de historial |
| `shippingDestination` | KEEP + enrich | `commercialState.destination` | Conservar `communeId`, fact ID, freshness y missing state |
| `commercialLineItems` | KEEP + enrich | `commercialState.cart` | Conservar identity, quantity, fact ID; hidratar facts vivos |
| `recentMessages` | MOVE | `conversationContext` | Memoria conversacional no es estado comercial |
| `recentCatalogContext` | MOVE + label | `relevantEvidence` | Evidencia histórica; nunca current price/stock |
| `pendingCatalogAction` | MOVE + label | `relevantEvidence`/continuity | Candidate IDs no son verdad actual |
| `latestShippingQuote` | KEEP if fresh | `commercialState.shipping` | Sólo si anchors actuales; stale se omite o se marca |
| `customer360` | REPLACE_WITH_ALLOWLIST | `customerContext`/`relevantEvidence` | Actualmente se pierde antes de R3 prompt |
| current Quote Service quote | ADD | `commercialState.quote` | Hoy no forma parte del summary mínimo R3 |
| `caseState` y objective | ADD | `caseState`/`activeObjective` | Hoy viven en CW, no en input cognitivo estructurado |

### 9.3 Gap central

El problema no es que cada servicio carezca de un endpoint básico. El problema es
que la compilación que llega al modelo no conserva la procedencia y el estado de
los datos, y que distintos runtimes mantienen summaries distintos. El contrato
futuro debe ser read-only, determinístico, versionado por los owners y compilado
después de settlement/reprojection.

## 10. Freshness/versioning

No existe una sola versión global de todo el estado comercial. El contrato debe
transportar versiones/anchors por dominio y una clasificación común.

| Superficie | Version/freshness disponible | Qué prueba | Qué no prueba |
|---|---|---|---|
| CommercialWork | Aggregate `version`, projection version, conversation/commercial sequence | Qué snapshot de case/objectives fue proyectado | Que Catalog, Quote o Carrier no hayan cambiado |
| Request facts cart/destination | `factId`, `updatedAt`, active/superseded | Qué selección/destino está activo | Precio, stock, peso o rate actual |
| Selected shipping | selection fact, calculation execution, `selectionFactId`, `destinationFactId` | Que la opción corresponde a esos anchors | Que siga válida si cambia cualquier anchor |
| Catalog live read | `retrievedAt`, `cached`, product/variant response | Hechos observados en esa lectura | Validez después de una mutación upstream posterior |
| Semantic Catalog | semantic/published snapshot IDs y checksums, truncation/lineage | Qué dataset derivado produjo el candidato | Que el producto siga activo/resoluble en live Catalog |
| Customer Profile | `retrievedAt`, readiness, result status, provenance | Estado de la consulta y su fuente | Tracking de orden en tiempo real o Customer Master |
| Native Customer360 | `snapshotVersion`, last activity/refreshed, fresh/stale/unknown | Frescura del read model local | Autoridad de Quote Service o Identity |
| Quote Service | `version`, `revision`, status, `validUntil`, delivery status | Consistencia interna del quote | Match con cart/destination/shipping actuales sin anchors cross-domain |
| AgentSession | session/compaction/turn ordering | Continuidad conversacional | Verdad de un dominio comercial |

### 10.1 Convención propuesta

Cada proyección debe incluir:

```text
freshness = {
  state: CURRENT | STALE | SUPERSEDED | HISTORICAL | UNKNOWN,
  source: string,
  capturedAt: timestamp | null,
  sourceVersion: string | number | null,
  anchors: [{ name, value }],
  reason: string | null
}
```

`capturedAt` no reemplaza `sourceVersion`; un dato recién leído puede ser stale
respecto del estado comercial si sus anchors no coinciden. Del mismo modo,
`version` de Quote Service no prueba que el cart no haya cambiado.

## 11. Stale evidence analysis

### 11.1 Taxonomía de lectura

| Estado | Uso | Entrada al bloque current |
|---|---|---|
| `CURRENT` | Owner y anchors/versiones satisfacen la lectura | Sí |
| `STALE` | Existe evidencia, pero algún timestamp/anchor ya no coincide | Sólo como warning/blocker, nunca como current |
| `SUPERSEDED` | Un nuevo fact reemplazó explícitamente al anterior | No en current; sólo lineage si es necesario |
| `HISTORICAL` | Contexto anterior útil para conversación o perfil | Sólo en `relevantEvidence` y con etiqueta |
| `UNKNOWN` | No se puede probar frescura | No usar para afirmaciones factuales |

### 11.2 Casos concretos

| Evidencia | Estado probable actual | Tratamiento |
|---|---|---|
| Semantic candidate sin details revalidado | DISCOVERABLE / UNKNOWN | Hidratar con Catalog; si 404, no presentarlo como disponible |
| `recentCatalogContext` | HISTORICAL | Puede orientar continuidad, no precio/stock |
| `pendingCatalogAction` | HISTORICAL/continuity | Sólo recuperar una intención pendiente; volver a resolver identidad |
| Selected shipping después de cambiar cart | STALE/SUPERSEDED | Bloquear selección/quote y pedir recálculo |
| Selected shipping después de cambiar destino | STALE/SUPERSEDED | Igual; comparar destination fact |
| Created quote con selection fact diferente | STALE | No reutilizar como quote current; crear/reconstruir según policy |
| Draft quote con versión válida pero cart cambiado | STALE cross-domain | `issue_quote` debe bloquear y re-groundear |
| Customer360 fuera de su ventana de freshness | STALE | Mostrar warning; no presentarlo como relación actual |
| Customer Profile timeout/disabled | UNAVAILABLE | Omitir señales o expresar no disponible; nunca rellenar |

### 11.3 Regla de prompt

El compiler debe excluir del bloque `commercialState` todos los facts
`STALE`, `SUPERSEDED`, `HISTORICAL` y `UNKNOWN`. Si son necesarios para explicar
continuidad, deben entrar únicamente en `relevantEvidence` con `source`,
`capturedAt` y `reason`. No deben entrar raw payloads, errores HTTP, SQL,
headers, secretos, documentos completos de Quote Service ni trazas internas.

## 12. DomainReadModel

`CommercialDomainReadModel` es una proyección conceptual, read-only y efímera
para compilar cada turno. No es una tabla, no es un nuevo microservicio y no es
una autoridad adicional. Lee desde los owners y conserva provenance/freshness para
que el modelo no confunda evidencia con estado.

```ts
type Freshness = {
  state: 'CURRENT' | 'STALE' | 'SUPERSEDED' | 'HISTORICAL' | 'UNKNOWN';
  source: string;
  capturedAt: string | null;
  sourceVersion: string | number | null;
  anchors: Array<{ name: string; value: string }>;
  reason: string | null;
};

type CommercialDomainReadModel = {
  case: {
    caseId: string;
    conversationId: string;
    opportunityId: string | null;
    workId: string | null;
    workVersion: number | null;
    status: string;
    blockers: Array<{ code: string; message: string }>;
    freshness: Freshness;
  };
  objective: {
    objectiveId: string;
    type: string;
    status: string;
    missingRequirements: string[];
    blockers: Array<{ code: string; message: string }>;
    freshness: Freshness;
  } | null;
  cart: {
    factId: string;
    updatedAt: string;
    items: Array<{
      productId: string;
      combinationId: string | null;
      quantity: number;
      currentCatalog: {
        name: string | null;
        sku: string | null;
        price: { amount: number; currency: string } | null;
        availability: string | null;
        stockQuantity: number | null;
        weightKg: number | null;
      } | null;
      freshness: Freshness;
    }>;
    freshness: Freshness;
  };
  destination: {
    factId: string;
    communeId: string;
    canonicalName: string;
    matchedVia: string;
    updatedAt: string;
    freshness: Freshness;
  } | null;
  shipping: {
    status: 'MISSING' | 'CURRENT' | 'STALE' | 'UNKNOWN';
    selected: {
      optionIndex: number;
      carrierName: string;
      serviceType: string;
      totalCost: number;
      estimatedDelivery: string | null;
      selectionFactId: string;
      destinationFactId: string;
    } | null;
    alternatives: Array<{
      optionIndex: number;
      carrierName: string;
      serviceType: string;
      totalCost: number;
      estimatedDelivery: string | null;
    }> | null;
    freshness: Freshness;
  };
  quote: {
    quoteId: string;
    quoteNumber: string | null;
    status: string;
    currency: string;
    total: number | null;
    validUntil: string | null;
    version: number | null;
    grounding: 'CURRENT' | 'STALE' | 'UNKNOWN';
    freshness: Freshness;
  } | null;
  customer: {
    identity: {
      status: string;
      identityLevel: string;
      hasResolvedCustomer: boolean;
      verificationRequired: boolean;
    };
    profile: Record<string, unknown> | null;
    freshness: Freshness;
  };
  conversation: {
    compactSummary: string | null;
    recentMessages: Array<{ role: string; text: string; occurredAt: string }>;
    sessionVersion: string | number | null;
    freshness: Freshness;
  };
  evidence: Array<{
    kind: string;
    status: 'CURRENT' | 'STALE' | 'SUPERSEDED' | 'HISTORICAL' | 'UNKNOWN';
    source: string;
    capturedAt: string | null;
    reference: string | null;
    summary: string;
  }>;
};
```

Reglas del read model:

- `case`, `objective`, cart identity, destination state, shipping status, quote
  status e identity policy deben estar disponibles en cada turno.
- Los facts de dominio se leen desde sus owners; el read model no escribe ni
  calcula pricing, availability, permissions o lifecycle.
- Las lecturas fallidas producen `UNAVAILABLE`/`UNKNOWN` y warnings, no valores
  por defecto que parezcan reales.
- La hidratación de Catalog se limita a los productos necesarios para el turno y
  se revalida para acciones de quote/orden.
- `quote.grounding` se calcula comparando Quote Service con anchors comerciales;
  `version` por sí sola no alcanza.
- Customer Profile y Customer360 permanecen separados por provenance. Una
  proyección conjunta no crea una nueva autoridad de identidad o quote.

## 13. AgentTurnInput v1

El input cognitivo debe ser la versión allowlisted del read model, más el turno y
las capabilities disponibles. Se propone este contrato conceptual; no se
implementa aquí.

```ts
type AgentTurnInput = {
  caseState: {
    caseId: string;
    conversationId: string;
    opportunityId: string | null;
    workId: string | null;
    workVersion: number | null;
    status: string;
    blockers: Array<{ code: string; message: string }>;
  };
  activeObjective: {
    objectiveId: string;
    type: string;
    status: string;
    missingRequirements: string[];
    blockers: Array<{ code: string; message: string }>;
  } | null;
  commercialState: {
    cart: unknown;
    destination: unknown | null;
    shipping: unknown;
    quote: unknown | null;
  };
  customerContext: {
    identity: {
      status: string;
      identityLevel: string;
      hasResolvedCustomer: boolean;
      verificationRequired: boolean;
    };
    profile: unknown | null;
  };
  currentTurn: {
    inboundMessageId: string;
    channel: 'whatsapp';
    text: string;
    occurredAt: string;
    correlationId: string | null;
  };
  conversationContext: {
    compactSummary: string | null;
    recentMessages: Array<{ role: string; text: string; occurredAt: string }>;
    sessionVersion: string | number | null;
  };
  relevantEvidence: Array<{
    kind: string;
    status: 'CURRENT' | 'STALE' | 'SUPERSEDED' | 'HISTORICAL' | 'UNKNOWN';
    source: string;
    capturedAt: string | null;
    summary: string;
  }>;
  capabilities: Array<{
    name: string;
    version: string;
    sideEffect: boolean;
    preconditions: string[];
    useWhen: string;
  }>;
  executionPolicy: {
    identityLevel: string;
    allowedSensitiveActions: string[];
    humanOwner: boolean;
    aiBlocked: boolean;
    sideEffectRules: string[];
  };
};
```

### 13.1 Source, owner y freshness de cada campo

| Campo | Source | Owner | Freshness/version | Requerido |
|---|---|---|---|---|
| `caseState` | CommercialWork aggregate + Turn Settlement | CommercialWork | Aggregate `workVersion`, conversation sequence y settlement status | Siempre |
| `activeObjective` | Current CommercialWork projection | CommercialWork | Mismo work version; null si no existe objective activo | Siempre; nullable |
| `commercialState` | Cart/destination/shipping domains + Catalog + Quote Service | Cada domain owner; compiler sólo compone | Fact IDs, execution anchors, Quote `version`/validity, Catalog `retrievedAt` | Estado mínimo siempre; alternativas/detalle condicional |
| `customerContext` | Trusted runtime session + Customer Profile/Customer360 | Identity domain para identity; Profile/Customer360 para analytics | Identity resuelta este turno; profile provenance/timestamp/freshness | Identity siempre; profile condicional |
| `currentTurn` | Settled inbound event | WhatsApp Adapter + Turn Settlement | Inmutable del turno, inbound message ID y occurredAt | Siempre |
| `conversationContext` | AgentSession + compact recent messages | AgentSession | Session/compaction version y orden de turnos | Resumen compacto siempre; detalle condicional |
| `relevantEvidence` | Gateway execution rows, Catalog semantic lineage, shipping calculations, profile reads | Source domain + Gateway para lineage | Cada evidencia con estado explícito, source y capturedAt | Sólo evidencia relevante al objetivo |
| `capabilities` | Gateway registry, availability e identity gate | Capability Gateway | Configuración/policy del turno | Lista permitida siempre; descripciones detalladas condicionales |
| `executionPolicy` | Trusted server session, identity policy, Gateway/CW governance | Policy/Gateway/CommercialWork | Evaluada server-side en el turno | Siempre; no editable por modelo |

`currentTurn.text` es el único contenido libre del usuario que necesariamente
entra. Debe acompañarse de un `inboundMessageId` ya asentado para que una respuesta
no se calcule dos veces sobre un evento no settlement.

## 14. Progressive disclosure policy

### 14.1 Siempre en el prompt inicial

- `caseId`, `conversationId`, `workId` si existe, `workVersion`, case status y
  blockers actuales;
- objective activo, tipo/status y requirements faltantes;
- carrito actual: `productId`, `combinationId`, quantity, selection/cart fact ID;
- destino actual o ausencia explícita, con commune/fact ID si existe;
- shipping status (`MISSING`, `CURRENT`, `STALE`) y resumen de selección si está
  vigente;
- quote status/currentness mínimo si existe, sin volcar líneas o documento;
- turno actual y contexto conversacional compacto;
- identity status/level, verification state y execution policy efectiva;
- sólo las capabilities permitidas y relevantes para desbloquear el objective.

### 14.2 Sólo condicionalmente

- RFM, recencia, frecuencia, gasto, purchase behavior e historial para
  recommendation, repeat purchase, cross-sell, upsell, replacement o consultas
  sobre la relación;
- detalle completo de productos/variantes cuando el usuario compara, pregunta
  por atributos, confirma una selección o se prepara un quote;
- semantic discovery, relaciones y recomendaciones cuando hay una necesidad de
  descubrimiento;
- alternativas de shipping cuando se calcula, compara o selecciona shipping;
- total, `validUntil`, líneas y documento del quote cuando se consulta, revisa,
  emite o envía el quote;
- recent orders cuando el turno habla de orden/recompra, con tracking marcado no
  real-time;
- evidencia histórica sólo si explica una decisión o continuidad y siempre
  etiquetada.

### 14.3 Nunca como parte del contexto cognitivo

- payloads completos de backend, SQL, HTTP headers, auth tokens, errores crudos o
  secrets;
- raw `wa_id`, teléfono, email, customer IDs, external IDs o evidence refs;
- texto de consentimiento, reglas internas de policy o flags de permisos enviados
  por el modelo;
- chain of thought o trazas internas de planner/agent loop;
- precio/stock/availability tomados de recent catalog context, semantic results o
  pending action sin lectura viva;
- facts stale/superseded presentados dentro de `commercialState`;
- documento completo, hashes internos o referencias operativas de Quote Service;
- copia histórica de `crm_quotes` junto al quote actual como si ambas fueran
  autoridades;
- todos los response bodies de capabilities por defecto.

## 15. DeepSeek read contract

Antes de su primera decisión, DeepSeek debe leer, en este orden lógico:

1. `currentTurn`: qué pidió el usuario y cuándo fue asentado.
2. `caseState` y `activeObjective`: qué caso está abierto, qué objetivo gobierna,
   qué falta y qué está bloqueado.
3. `commercialState`: carrito, destino, estado/frescura de shipping y quote,
   distinguiendo current de stale.
4. `customerContext`: nivel de identidad y sólo las señales de perfil/historial
   habilitadas para este tipo de objetivo.
5. `conversationContext`: continuidad compacta para no repetir preguntas ni
   tratar mensajes antiguos como hechos actuales.
6. `relevantEvidence`: candidatos, resultados de capabilities y señales
   históricas, siempre con source y estado.
7. `capabilities` y `executionPolicy`: qué puede solicitar y qué acciones ya
   están permitidas por la policy server-side.

El modelo puede elegir una capability disponible o responder/pedir el dato
faltante. No puede decidir permisos, inventar estado, convertir un candidate en
producto vigente, emitir quote desde el prompt ni reconstruir identidad a partir
de PII.

El contrato mínimo que debe recibir es:

```text
turn + current case/objective
  + current cart/destination/shipping/quote
  + identity level and effective policy
  + compact conversation continuity
  + only relevant, freshness-labelled evidence
  + allowed capability descriptions
```

Todo lo demás debe permanecer fuera del prompt, consultarse mediante capabilities
o mantenerse exclusivamente server-side. En particular, la entrada nunca debe
ser el dump de Customer360, el payload completo de Customer Profile, una lista
cruda de ejecuciones, una copia de tablas legacy o un conjunto de flags de
autorización controlables por el modelo.

## 16. Required domain fixes

### 16.1 Cambios de contrato/integración requeridos

| Prioridad | Fix | Owner | Razón | Tipo |
|---|---|---|---|---|
| P0 | Congelar conceptualmente `CommercialDomainReadModel` y `AgentTurnInput v1` | CommercialWork + R3 Runtime + Gateway | Elimina summaries divergentes y hace explícita la frescura | Documental primero; implementación posterior |
| P0 | Pasar `caseState` y `activeObjective` desde CommercialWork al compiler R3 | CommercialWork/R3 | DeepSeek debe razonar sobre el case durable, no sólo opportunity/messages | Integración |
| P0 | Incluir Customer Profile/Customer360 allowlisted y condicional en R3 | R3 Context Compiler + Customer Profile | Hoy se carga pero se pierde antes del prompt | Integración |
| P0 | Validar quote grounding antes de `issue_quote` | Quote capability/Quote Service boundary | Evita emitir un quote interno válido pero desfasado del cart/destination/shipping | Invariante |
| P0 | Representar shipping seleccionado como `CURRENT`/`STALE`/`MISSING` en la proyección | Shipping + compiler | Evita que una row confirmada parezca vigente después de un cambio | Read model |
| P1 | Formalizar un namespace/lineage único para semantic Catalog y live details | Catalog Service + consumer contract | Reduce drift entre snapshots y endpoint details | Contrato |
| P1 | Medir semantic success seguido de details 404 | Catalog/Gateway observability | Confirma o refuta la hipótesis de snapshot desalineado | Observabilidad |
| P1 | Exponer anchors de cart/destination/shipping en quote o en un contrato de grounding | Quote Service + CommercialWork | La versión interna de quote no prueba match cross-domain | Contrato |
| P1 | Converger summaries de R3, CW, ATL y ciclos legacy | Runtime/Context Compiler | Hay varias rutas que compilan estados diferentes | Consolidación |
| P1 | Mantener Gateway como única frontera de ejecución | Gateway/R3 | Evita llamadas directas desde cognition y policy en LLM | Guardrail |
| P2 | Definir retiro/traducción de `crm_quotes` legacy | Quote/CRM owners | El repositorio documenta dos quote domains desconectados | Deuda arquitectónica |

### 16.2 Clasificación por microservicio

- **Customer Profile — READY_WITH_ADAPTER.** El contrato de lectura y los estados
  de fallo son suficientes. Falta el adapter/projection correcto hacia R3 y
  política de selección de campos.
- **Catalog — NEEDS_CONTRACT_CHANGE.** No por ownership incorrecto, sino por la
  necesidad de hacer explícitos snapshot lineage, live revalidation y garantía de
  namespace entre semantic discovery y details.
- **Quote Service — NEEDS_INVARIANT_FIX.** Sus primitivas internas son buenas; la
  invariante de match con el estado comercial actual está incompleta.
- **Shipping — NEEDS_INVARIANT_FIX.** El check de anchors existe, pero el read
  contract debe reflejar stale de manera uniforme y bloquear toda reutilización.
- **Customer Identity — READY_WITH_ADAPTER.** Customer Service y el identity gate
  tienen boundaries correctos; falta proyectar la decisión efectiva en R3 sin PII.
- **Capability Gateway — READY_AS_IS.** Es el boundary correcto; se debe evitar
  duplicarlo en el runtime o en un nuevo servicio.

Ninguno de estos hallazgos requiere crear un microservicio nuevo ni convertir
CommercialWork en dueño de Catalog, Quote, Shipping o Customer Master.

## 17. Integration roadmap

La secuencia debe mantener una sola release activa ACS y trabajar por incrementos
revisables. Esta auditoría no abre una release paralela ni ejecuta los fixes.

### Fase 0 — contrato y observabilidad

1. Aprobar `CommercialDomainReadModel`, `AgentTurnInput v1`, estados de freshness
   y clasificación de evidencia.
2. Registrar en cada proyección source, capturedAt, sourceVersion y anchors.
3. Añadir observabilidad de semantic candidate seguido de details 404, con
   `productId`, snapshot lineage y correlation no sensible.
4. Documentar la autoridad de `crm_quotes` legacy frente a Quote Service y
   establecer la decisión de retiro/traducción antes de migrar datos.

### Fase 1 — compiler R3 y caso durable

1. Compilar `caseState` y `activeObjective` desde CommercialWork después de
   settlement/reprojection.
2. Compilar cart/destination/shipping/quote desde sus owners, conservando IDs de
   fact y versiones, sin copiar lifecycle ni pricing como autoridad.
3. Incorporar Customer Profile/Customer360 con progressive disclosure y estados
   `PARTIAL`/`UNAVAILABLE` explícitos.
4. Reemplazar los resúmenes divergentes sólo después de comparar outputs y
   preservar fallback controlado de la ruta existente.

### Fase 2 — invariantes comerciales

1. Hacer que `issue_quote` ejecute validación de grounding cross-domain antes de
   mutar Quote Service.
2. Exigir recálculo de shipping cuando cart o destination fact cambien.
3. Bloquear creación/emisión si el quote o shipping evidence está stale; explicar
   el blocker en CommercialWork, no en un mensaje inventado por el modelo.
4. Mantener idempotencia y expected version del Quote Service como protección
   separada de la grounding cross-domain.

### Fase 3 — consolidación y deuda legacy

1. Retirar gradualmente context compilers duplicados de ATL/legacy/R3 cuando la
   equivalencia de contrato esté verificada.
2. Ejecutar la decisión aprobada sobre `crm_quotes`; no migrar ni borrar tablas en
   esta tarea.
3. Revisar si Carrier puede entregar metadata fiscal/moneda/option identity para
   habilitar shipping dentro del quote.

### 17.1 Respuestas explícitas a los findings requeridos

**1. ¿Quién es dueño del estado vigente del caso y del objetivo?**

CommercialWork. Es dueño del case/objective/work lifecycle, blockers, missing
requirements y readiness. Opportunity sigue siendo una entidad comercial
relacionada, no el sustituto del case kernel.

**2. ¿Qué debe recibir DeepSeek siempre antes de decidir?**

Turno actual asentado, `caseState`, objective activo y blockers, cart y destino
actuales, shipping/quote status con freshness, identidad/policy efectiva,
contexto conversacional compacto y sólo las capabilities permitidas. El detalle
condicional se incorpora según el objective.

**3. ¿Customer Profile está realmente integrado o sólo disponible en outer cycle?**

Está integrado en el outer native cycle y en rutas legacy/ATL, pero en R3 queda
fuera de `buildMinimalCommercialContextSummary`. Por tanto, para la decisión R3
actual está disponible a nivel de ciclo, no verdaderamente consumido por DeepSeek.

**4. ¿Hay dos namespaces de product ID entre semantic discovery y get details?**

El código del repositorio no prueba dos namespaces internos: ambos usan IDs
numéricos positivos y el adapter los normaliza a string. Sí hay varios contratos y
endpoints que requieren una garantía documental única; el riesgo de drift
upstream permanece abierto.

**5. ¿Cuál es la causa probable de `product_not_found` después de semantic discovery?**

Desalineación entre snapshot semántico publicado y Catalog vivo: el snapshot
retiene un ID que ya no resuelve por baja/inactividad o lag de publicación. Es una
inferencia pendiente de confirmar con logs upstream, snapshot ID/checksum y estado
live del producto. No se debe reportar como bug de namespace confirmado.

**6. ¿Qué es verdad actual de Catalog y qué es sólo evidencia?**

Catalog live es autoridad para identidad, variante, nombre, SKU, precio, stock,
availability, peso y link. Semantic discovery, recommendations, relationships,
recent catalog context y pending actions son discovery/continuity evidence y
requieren hidratación o revalidación antes de usarse como current.

**7. ¿Quote Service tiene suficiente versioning?**

Tiene suficiente versioning para su propia concurrencia y lifecycle: version,
revision, status, validity, idempotency y snapshot. No tiene suficiente grounding
cross-domain en la integración actual para demostrar que el quote coincide con
cart/destination/shipping vigentes.

**8. ¿Dónde debe vivir la invariante de no emitir quote stale?**

En el capability/domain boundary de Quote, ejecutado server-side antes de
`issue_quote`, leyendo Quote Service y el read model actual. No debe delegarse a
DeepSeek ni resolverse duplicando pricing en CommercialWork.

**9. ¿Cómo se invalida shipping al cambiar cart o destino?**

El cambio produce un nuevo fact ID y supersede el anterior. La selección almacenada
se vuelve stale al comparar `selectionFactId` y `destinationFactId` en consumo. El
read model debe exponer `STALE` y exigir recálculo; una invalidación persistente
explícita puede agregarse después.

**10. ¿Cuál es la autoridad de Customer Identity?**

Customer Service y las relaciones `master_customer`/`customer_external_identity`
para Customer Master y linking. El local identity resolver y runtime session
producen el estado confiable del turno. Customer Profile sólo aporta perfil e
historial, no autoridad de identidad.

**11. ¿Qué puede ver DeepSeek de identidad?**

Status, identity level, si existe Customer Master resuelto, si requiere
verificación y las categorías de acciones permitidas. No puede ver raw identifiers,
PII, evidence refs ni decidir permisos. Gateway/identity gate mantiene la decisión
efectiva server-side.

**12. ¿Qué responsabilidades están duplicadas y cómo se corrigen?**

Están duplicados los context compilers de R3/CW/ATL/legacy, el read model local
Customer360 frente a Customer Profile para señales parcialmente solapadas,
`crm_quotes` frente a Quote Service, y continuity evidence de Catalog frente a
current Catalog state. La corrección es un compiler común con provenance, no un
nuevo microservicio: mantener autoridades separadas, mover sólo proyecciones
allowlisted y retirar duplicados después de una migración verificable.

## 18. Open questions

Estas preguntas requieren evidencia o decisión de los owners; no se deben resolver
inventando contratos:

1. Para el caso concreto de `product_not_found`, ¿qué `productId`, semantic
   snapshot ID/checksum, timestamp y respuesta de details se observaron? ¿El
   producto estaba activo en la misma versión del Catalog Service?
2. ¿Catalog Service garantiza formalmente que semantic discovery, T12 resolution,
   recommendation y live details comparten el mismo namespace de product/variant,
   o hay mappings por endpoint?
3. ¿Puede Catalog publicar un lineage/validity marker que permita al consumer
   rechazar candidatos cuya publicación sea anterior a una ventana acordada?
4. ¿Quote Service puede aceptar y devolver anchors de selection/cart/destination/
   shipping, o debe existir un grounding validator fuera del servicio?
5. ¿Qué campos fiscales, moneda y option identity debe entregar Carrier para
   incorporar shipping al snapshot del quote?
6. ¿Debe shipping tener una transición persistente `STALE`, o se mantendrá la
   estrategia de invalidación por lectura mientras los facts sean inmutables?
7. ¿Qué tráfico real sigue usando la rama ATL/legacy y qué equivalencia de output
   se exige antes de retirar sus context compilers?
8. ¿Cuál es la política aprobada para `crm_quotes`: retiro, traducción temporal o
   coexistencia explícita con un owner único?
9. ¿Qué campos de Customer Profile y Customer360 están autorizados para cada
   categoría de objective y qué ventana de freshness se considera suficiente?
10. ¿En qué momento del pipeline se garantizará que el `AgentTurnInput` se
    recompila después de una mutation y antes de una respuesta final?

### Cierre contractual

DeepSeek debe decidir únicamente sobre el turno asentado, el case/objective
vigente, el estado comercial actual con sus anchors/versiones, la identidad
reducida y policy efectiva, la continuidad compacta y evidencia relevante
etiquetada. La Cognition puede descubrir y solicitar capabilities; no puede
convertir evidencia stale en current, reconstruir hechos conocidos, determinar
permisos, mutar dominios directamente ni reemplazar las autoridades de Catalog,
Shipping, Quote, Customer Service o CommercialWork.
