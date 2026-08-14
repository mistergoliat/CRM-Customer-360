---
title: Quote Input Assembler - deterministic commercial_line_items -> QuoteServiceCreateRequest
doc_id: integration-quote-input-assembly
status: implemented_not_wired
tags:
  - integration
  - quote-service
  - catalog
  - sales-agent
---
# Quote Input Assembler

## Relaciones

- Implementa: `lib/brain/commercial/quote-assembly/{types,errors,opportunityCore,assembleQuoteInput,index}.ts`.
- Consume (sin modificar): `getActiveCommercialLineItemsForOpportunity`
  (`lib/domains/commercial-line-items`), `getActiveShippingDestinationForOpportunity`
  (`lib/domains/shipping-destination`), `getActiveSelectedShippingOptionForOpportunity`/
  `checkShippingSelectionFreshness`/`checkShippingEvidenceFreshness`
  (`lib/domains/selected-shipping-option`, SALES-AGENT-R1-T2.1 /
  SALES-AGENT-R1-T2.1.1), `CatalogPort.batchGetProducts` (`lib/catalog`),
  `getMasterCustomerById` (`lib/integrations/customer-master`), los tipos de
  Quote Service de T1/T1.1 (`lib/domains/quote-service`).
- No modifica: `lib/brain/commercial/quotes/repository.ts` (`crm_quotes`
  legacy, sin relación), `lib/integrations/quote-service/httpQuoteServiceAdapter.ts`
  (el adapter transporta, nunca decide qué transportar), ninguna capability
  del Capability Gateway, ningún runtime conversacional, ningún dato de
  `commercial_line_items` (nunca se le agrega precio/tax).
- Task: `SALES-AGENT-R1-T2` (assembler base) + `SALES-AGENT-R1-T2.1` (durable
  shipping selection, evidence gate, staleness - ver seccion "Shipping"
  abajo) + `SALES-AGENT-R1-T2.1.1` (rechazo de staleness YA en
  `select_shipping_option`, antes de persistir - cierra el gap de auditoría
  descrito en "Frescura (staleness)" abajo).

## Alcance

```text
Catalog Service   identifica y precia
CRM (commercial_line_items)  selecciona (identidad + quantity, durable, nunca precio)
Assembler (este modulo)      hidrata: selección + Catalog + identidad de cliente -> QuoteServiceCreateRequest
Quote Service (T3, futuro)   snapshotea (inmutable, al llamar createQuote)
```

**T2 no llama a Quote Service, no registra capability, no muta nada.** El
output es un `QuoteServiceCreateQuoteInput` validado y una `evidence` de
solo lectura — el side effect (crear la Quote real) es responsabilidad de
una tarea futura (T3+).

## Reglas que este módulo garantiza

- **No LLM pricing**: el assembler nunca acepta un precio del caller ni de
  texto libre — `unitPrice`/`taxRate` vienen exclusivamente de
  `CatalogProduct.price`, sin ninguna operación aritmética (nunca `*1.19`,
  nunca `/1.19`; ver "Anti-doble-IVA" abajo).
- **No re-resolución textual de producto**: la única fuente de líneas es
  `getActiveCommercialLineItemsForOpportunity(opportunityId)` — nunca una
  lista suministrada por el caller, nunca `recentMessages`, nunca una nueva
  búsqueda de catálogo.
- **No `crm_quotes`**: el assembler no lee ni escribe esa tabla.
- **No mutación de Quote**: `createQuote`/`issueQuote`/`sendQuoteEmail`/
  `acceptQuote` no se invocan desde aquí.
- **Sin side effects**: solo lecturas (`commercial_line_items`,
  `shipping_destination`, Catalog Service, `master_customer` vía
  `crm_opportunities.customer_master_id`) - cero escrituras a DB, cero
  llamadas HTTP mutantes.

## Identity mapping

```text
CommercialLineItem.productId      -> externalItemId
CommercialLineItem.combinationId  -> externalVariantId (null si no hay variante)
                                      "catalog_service" -> externalSource
```

Verbatim, nunca concatenado (`"545:31"` no existe en este repo, decisión ya
tomada en T1.1). `sku` viaja como metadata adicional (nunca como identidad
primaria) cuando Catalog lo reporta.

## Pricing / IVA (enforcement que T1.1 dejó preparado)

Para cada línea, `resolveCatalogLine()` exige las tres condiciones que la
tarea especificó como enforcement obligatorio de T2:

```text
price.amount      != null   (si no: catalog_price_missing)
price.taxIncluded === true  (si no: catalog_tax_metadata_missing)
price.taxRate      != null   (si no: catalog_tax_metadata_missing)
price.currency    === "CLP" (si no: currency_mismatch - nunca asumido, siempre verificado)
```

`unitPrice`/`taxRate` se convierten a `string` decimal con un passthrough
puro (`String(value)`, validado contra el mismo patrón que Quote Service
exige) - nunca redondeados, nunca recalculados. Quote Service sigue siendo
la única autoridad que deriva `lineSubtotal`/`lineTax`/`lineTotal`.

### Anti-doble-IVA (regresión explícita, cubierta por test)

```text
Catalog: amount=99990, taxIncluded=true, taxRate=0.19
Assembler produce: unitPrice="99990", taxIncluded=true, taxRate="0.19"
NUNCA: unitPrice="118988"/"118989"/"118990" (99990 * 1.19)
```

Test: `tests/commercial/assembleQuoteInput.test.ts`, `"anti-double-IVA: ..."`.

## Customer snapshot

No existe en este repo un "customer context" pre-ensamblado con
name/email/phone (auditado explícitamente - `NativeCustomerSessionExecutionContext`
solo carga `identity.customerId`/`trustedInbound.normalizedPhone`, nunca
contacto completo). El assembler resuelve `customerSnapshot` con dos lecturas
reales, mínimas:

```text
crm_opportunities.customer_master_id  (nuevo lector: opportunityCore.ts)
  -> master_customer.{firstname,lastname,email}  (getMasterCustomerById, ya existente)
```

- `name` = `"${firstname} ${lastname}"` — **requerido**; si
  `customer_master_id` es `null` o no resuelve a una fila real,
  `customer_snapshot_incomplete` (nunca `"Cliente WhatsApp"`/placeholders).
- `email` — siempre presente cuando el cliente resuelve (`master_customer.email`
  es `NOT NULL` en el schema real).
- `phone` — mapeado desde `crm_opportunities.wa_id` (la misma identidad
  telefónica/WhatsApp ya usada en todo el repo como referencia de contacto
  provisional) — **omitido del objeto** (nunca `null`) cuando no existe.
- `address`/`district`/`region` — **deliberadamente omitidos**: no existe
  ninguna columna de dirección en `master_customer` hoy, y usar una dirección
  de despacho (`lib/domains/customer-addresses`) como dirección de
  facturación sería una decisión de producto no auditada — mejor omitir que
  adivinar.

## Shipping

### Pipeline completo (SALES-AGENT-R1-T2.1)

```text
Catalog Service --------------------------------------------------> precios/identidad
      |
      v
select_products -> commercial_line_items (durable, lib/domains/commercial-line-items)
      |
      v
set_shipping_destination -> shipping_destination (durable, lib/domains/shipping-destination)
      |
      v
calculate_shipping (Carrier MS, capability-gateway/calculateShippingCapability.ts)
  -> cotizacion EN VIVO, nunca persistida por si sola. Cada opcion lleva un
     `index` (posicion dentro de ESTA respuesta - Carrier MS no entrega id de
     opcion propio) + selectionFactId/destinationFactId internos (nunca
     mostrados al modelo - ver buildToolObservation.ts) para poder detectar
     mas tarde si la eleccion quedo obsoleta.
      |
      v
select_shipping_option (capability-gateway/selectShippingOptionCapability.ts)
  -> el modelo solo puede mandar `optionIndex` (entero). El evidence gate
     (agent-loop/resolveObservedShippingOption.ts) resuelve ese indice contra
     la ULTIMA ejecucion completed de calculate_shipping para esa conversacion
     (crm_capability_executions) - un indice inventado o fuera de rango se
     rechaza antes de persistir cualquier cosa. carrierName/serviceType/
     totalCost jamas se aceptan como argumento del modelo: no existen en el
     schema de entrada. SALES-AGENT-R1-T2.1.1: acto seguido, ANTES de
     persistir, se compara selectionFactId/destinationFactId de esa evidencia
     contra los facts activos actuales de commercial_line_items/
     shipping_destination (`checkShippingEvidenceFreshness`) - si cualquiera
     cambio desde que corrio ese calculate_shipping, se rechaza con
     `shipping_calculation_stale` y CERO escritura (ver "Frescura" abajo).
      |
      v
selected_shipping_option (durable, lib/domains/selected-shipping-option,
  mismo patron crm_request_facts que commercial_line_items/shipping_destination)
      |
      v
Quote Input Assembler (este modulo) -> requireShipping=true lee la seleccion,
  valida frescura (defensa en profundidad, mismo checkShippingSelectionFreshness),
  y HOY siempre falla cerrado (ver "Gap real" abajo)
```

**Regla de autoridad (task section 4):** `calculate_shipping` propone
(Carrier MS es la unica autoridad sobre coverage/carrier/tarifa), el cliente
selecciona (`select_shipping_option`, un `optionIndex` sobre algo
efectivamente observado), CRM persiste (`selected_shipping_option`), Quote
Service snapshotea (T3, futuro). El LLM nunca inventa ni elige un carrier por
su cuenta en ningun punto de esta cadena.

### Frescura (staleness)

Una unica definicion, `checkShippingEvidenceFreshness`
(`lib/domains/selected-shipping-option/service.ts`), compara un par
`{selectionFactId, destinationFactId}` contra los facts ACTIVOS actuales del
opportunity (`commercial_line_items`/`shipping_destination`) - si cualquiera
cambio desde que corrio el `calculate_shipping` que produjo esa evidencia, es
`stale`, con `reason: "selection_changed" | "destination_changed"`
(deterministico: `selection_changed` se chequea primero, así que si ambos
cambiaron se reporta ese). `checkShippingSelectionFreshness` (misma firma de
siempre, usada por el assembler/`checkShippingSelectionReadiness`) es ahora un
delegado directo de esa función - nunca una segunda regla paralela.

**Antes (SALES-AGENT-R1-T2.1):** la staleness solo se detectaba en el
assembler, DESPUES de que `select_shipping_option` ya habia persistido la
seleccion. Una seleccion podia quedar `stale` en el momento mismo de
guardarse (si `commercial_line_items`/`shipping_destination` cambiaron entre
el `calculate_shipping` y el `select_shipping_option`) y el gap solo se
notaba recién en el Quote Input Assembler - auditoria detecto esto como un
gap real.

**Despues (SALES-AGENT-R1-T2.1.1):** `select_shipping_option`
(`capability-gateway/selectShippingOptionCapability.ts`) llama
`checkShippingEvidenceFreshness` con la evidencia recien resuelta (nunca la
seleccion persistida, que todavia no existe en ese punto) ANTES de escribir.
Si es `stale`, el resultado es `status: "invalid_arguments"`,
`errorCode: "shipping_calculation_stale"`, `data: { status:
"shipping_calculation_stale", reason }` - **cero escritura**, nunca una
excepcion generica. `buildToolObservation.ts` proyecta esto a una observacion
`blocked` con `errorCode`/`reason`, nunca con los fact IDs (esos jamas salen
de la capa de dominio). El assembler mantiene su propio chequeo
(`checkShippingSelectionFreshness` sobre la seleccion ya persistida) como
**defensa en profundidad** - una seleccion que era fresca al momento de
elegirse puede volverse stale mas tarde (el cliente cambia el carrito o el
destino DESPUES de seleccionar el envio), caso que el gate de selection-time
no puede ver por construcción.

### Gap real (Carrier MS sin metadata tributaria, no resuelto en T2.1)

Confirmado por auditoria directa (`docs/releases/CRM-R1-T13E-shipping-calculation.md`,
"Sin columna de moneda, IVA, o 'costo interno vs. precio cliente' en ningun
lugar del schema") y por el contrato HTTP real de Carrier MS
(`GET /api/pc-carrier/carrier/v1/all` devuelve solo
`carrier_name/service_type/total_cost/estimated_delivery` - sin id de opcion,
sin moneda, sin IVA): **no existe ninguna fuente real de `taxIncluded`/
`taxRate`/moneda para una opcion de envio.** Ademas, el contrato real de
Quote Service sigue sin representacion de linea de envio
(`QUOTE_LINE_TYPES = ["product", "service"]`, confirmado en
`MS-pesaschile-quote-service/src/domain/constants.ts`, sin tocar en esta
tarea a proposito). Agregar un tipo `"shipping"` que nunca podria enviarse
con datos reales seria peor que no tenerlo.

Comportamiento del assembler:

```text
requireShipping omitido/false (default) -> ignora shipping por completo,
  produce un QuoteServiceCreateQuoteInput solo de producto/cliente (un
  "draft parcial" valido, consistente con que Quote Service no exige
  ningun campo de envio en su propio contrato de creacion)

requireShipping=true:
  sin selected_shipping_option           -> shipping_selection_missing
  seleccion existe pero quedo obsoleta   -> shipping_selection_stale
  seleccion valida y fresca              -> shipping_tax_metadata_missing
    (nunca fabrica taxIncluded/taxRate/moneda para completar la linea)
```

`checkShippingSelectionReadiness(opportunityId)` esta expuesta por separado
para que un caller futuro pueda consultar el estado sin intentar un
ensamblaje completo - reporta `no_selection` (con `destinationConfirmed`),
`selection_stale` (con `staleReason`), o `shipping_tax_metadata_missing` (con
`carrierName`/`serviceType`) segun corresponda. Nunca reporta `ready:true`
hoy - el gap de Carrier MS es real e independiente de cuan correcta sea la
seleccion.

**Bloqueo acotado para una tarea futura** (propuesta conceptual, NO
implementada): si Carrier MS o una fuente equivalente llegara a exponer
`taxIncluded`/`taxRate`/moneda por opcion, Quote Service podria extender
`QUOTE_LINE_TYPES` con `"shipping"` y este assembler podria mapear
`selected_shipping_option` a esa linea con el mismo passthrough-sin-aritmetica
que ya usa para producto. Requiere una decision de producto explicita sobre
semantica tributaria de envio (task section 18) - no algo que este repo pueda
decidir unilateralmente inventando una tasa.

## Errores tipados

```text
missing_opportunity | no_commercial_line_items | catalog_unavailable |
catalog_product_not_found | catalog_variant_not_found | invalid_quantity |
catalog_price_missing | catalog_tax_metadata_missing | currency_mismatch |
customer_snapshot_incomplete | shipping_selection_missing |
shipping_selection_stale | shipping_tax_metadata_missing
```

`details` es siempre allowlisted (productId/combinationId/reason) - nunca
nombre/email/teléfono del cliente, nunca un mensaje de error crudo de DB/HTTP.

## Determinismo

`assembleQuoteInput` no usa `Date.now()`/UUID aleatorio/texto de LLM en
ningún punto - `now` es un reloj inyectable (default `() => new Date()`),
usado solo para derivar `validUntil` (política de 5 días, la misma ya
aprobada y hardcodeada en la plantilla de email de Quote Service - no
inventada aquí). Las 6 dependencias de lectura (`getOpportunityCore`,
`getCommercialLineItems`, `getShippingDestination`, `getSelectedShippingOption`,
`getCatalogPort`, `getMasterCustomer`) son inyectables, mismo patrón ya usado en
`calculateShippingCapability`/`setShippingDestinationForOpportunity`. Test
dedicado: mismos inputs -> `deepEqual` en dos llamadas independientes.

## Orden de líneas

Siempre el orden de `commercial_line_items` (la selección durable) - nunca
el orden que devuelva el batch de Catalog Service, que no está garantizado.
Verificado con un test que fuerza una respuesta de Catalog en orden inverso.

## Multiple quotes (sección 26)

El assembler no persiste ningún "snapshot de selección" propio - simplemente
lee el estado activo de `commercial_line_items` en el momento en que se lo
invoca. Dos llamadas sucesivas después de que el cliente cambie su selección
(`Selection V1 -> Request A`, luego `Selection V2 -> Request B`) son
independientes por construcción, sin ningún estado compartido entre ellas -
el snapshot inmutable real lo creará Quote Service cuando una tarea futura
(T3) llame a `createQuote`.

## Tests

- `tests/commercial/assembleQuoteInput.test.ts` - 37 tests, 100% DB-free (las
  6 dependencias de lectura, incluyendo `getSelectedShippingOption`, son
  inyectadas directamente, nunca MariaDB real). Cubre: happy path con los
  valores exactos del brief, identidad (producto base, variante, múltiples
  productos, reordenamiento de batch, producto/variante faltante, selección
  corrupta con identidad duplicada), pricing (los 4 casos de metadata
  tributaria incompleta + currency mismatch + anti-doble-IVA explícito),
  cantidad (0/-1/1.5/NaN), cliente (snapshot completo, identidad no resuelta,
  teléfono ausente), shipping (selección ausente, obsoleta por cambio de
  selección, obsoleta por cambio de destino, válida-pero-bloqueada por el gap
  tributario, compatibilidad producto-solo, los 3 branches de
  `checkShippingSelectionReadiness`), determinismo, ausencia de side effects,
  y referencias externas/evidencia.
- `tests/domains/selectedShippingOption.test.ts` - 12 tests, 100% DB-free
  (`getActiveFact`/`upsertFact` y `getCommercialLineItems`/
  `getShippingDestination` inyectados). Cubre selección/idempotencia/
  supersede de `setSelectedShippingOptionForOpportunity`, los 3 resultados de
  `checkShippingSelectionFreshness`, y (SALES-AGENT-R1-T2.1.1) los mismos 4
  escenarios contra `checkShippingEvidenceFreshness` directamente (fresh,
  selection_changed, destination_changed, ambos cambiados a la vez -
  deterministico) - probando que es la misma regla, no una copia.
- `tests/agent-loop/resolveObservedShippingOption.test.ts` - 10 tests, 100%
  DB-free (`dataAccess` inyectado). Cubre el evidence gate: resolución
  correcta con trazabilidad completa, sin ejecución reciente, índice fuera de
  rango/negativo/no-entero/texto libre, payload sin opciones, payload
  corrupto, anchors de trazabilidad ausentes, y que solo la fila más reciente
  se considera.
- `tests/commercial/selectShippingOptionCapability.test.ts` - registro en el
  Capability Gateway/Tool Pool y forma del schema son DB-free y pasan aquí;
  los escenarios de `execute()` con persistencia real (resuelto, índice
  inexistente, sin cálculo previo, idempotencia, supersede, y - SALES-AGENT-
  R1-T2.1.1 - los 2 escenarios de staleness en selection-time: cambio de
  `commercial_line_items`/`shipping_destination` DESPUES del
  `calculate_shipping` seedeado, cada uno probando `errorCode:
  "shipping_calculation_stale"` + cero escritura) requieren MariaDB real
  (`crm_capability_executions.opportunity_id/conversation_id` son FKs reales a
  `crm_opportunities`/`conversation`, a diferencia de los anchors de texto que
  usan `commercial_line_items`/`shipping_destination`) - no ejecutables en
  este sandbox (sin Docker/MariaDB), mismo límite ya aceptado por
  `calculateShippingCapability.test.ts`/`shippingDestinationCapability.test.ts`;
  verificados solo con `tsc --noEmit`.
- `tests/e2e/quoteInputAssemblyShippingPipeline.e2e.test.ts` - 4 tests, 100%
  DB-free. Un solo fixture consistente (mismo opportunityId,
  selectionFactId, destinationFactId) recorre el pipeline completo y
  verifica ambos resultados reales del mismo estado: el Quote solo-producto
  se ensambla con los valores exactos, y el intento de Quote con envío falla
  cerrado en `shipping_tax_metadata_missing` (o `shipping_selection_stale` si
  el destino cambió) - nunca una línea de envío fabricada.
