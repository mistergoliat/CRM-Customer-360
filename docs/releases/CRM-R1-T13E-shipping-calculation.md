---
title: CRM-R1-T13E.1 — Shipping Calculation Domain + Carrier Coverage Resolution
doc_id: release-crm-r1-t13e-shipping-calculation
status: implemented_partial
owner: architecture
last_reviewed: 2026-08-10
source_of_truth_for:
  - shipping-calculation domain contract (calculateShipping)
  - ShippingCoverageProvider / ShippingRateProvider port contracts
  - pc_pos.carriers / pc_pos.carrier_coverage / pc_pos.carrier_rangos_dd schema and semantics evidence
  - CatalogProduct.weightKg client contract
depends_on:
  - ./CRM-R1-T13C-canonical-commune-resolution.md
  - ./CRM-R1-T13D-durable-shipping-destination-state.md
  - ../audits/CRM-R1-T13B-shipping-destination-commune-resolution-audit.md
  - ../audits/SALES-AGENT-R1-commercial-proposal-checkout-readiness-audit.md
tags:
  - release
  - shipping
  - carrier
  - pc_pos
  - catalog
---

# CRM-R1-T13E.1 — Shipping Calculation Domain + Carrier Coverage Resolution

Implements the pure shipping-calculation domain (weight totaling, carrier coverage combination, all failure states) and a real, live-verified `pc_pos` carrier coverage adapter, plus closes a gap in this repo's own Catalog Service client (`weightKg` was never read). Does **not** wire `calculate_shipping` into the Capability Gateway or Agent Tool Loop, and does **not** implement a shipping rate/price calculation — both are explicit, evidenced deferrals, not oversights. This is `T13E.1` of the two-part split the task brief itself anticipates (section 6) when no backend-authoritative commercial line-item selection exists yet — `T13E.2` (line-item selection wiring) and full capability wiring remain open.

## Git inicial

- Base branch: `develop`, HEAD `c0b2aff` (merge of PR #87, `feat/crm-r1-t13d-shipping-destination-state`) — T13D was already merged into `develop`, confirmed before starting.
- Working branch: `feat/crm-r1-t13e-shipping-calculation`.

## Por qué T13E.1 y no T13E completo

Tres hallazgos, todos verificados en esta sesión antes de escribir código, determinaron el alcance real:

1. **No existe selección comercial de line items autoritativa y alcanzable desde el runtime nativo.** Búsqueda dirigida (agente de exploración, con citas de archivo/línea) confirmó: `RecentCatalogContext`/`PendingCatalogAction` no tienen `quantity`; `SalesNeedProfile`/`crm_sales_need_profiles` pertenecen al motor legacy `sales-consultative`, deshabilitado por defecto; `crm_quotes`/`QuoteItem` tiene `quantity` pero no `combinationId` y su único importador productivo real es el runtime multi-request no canónico (`lib/brain/commercial/multi-request/requestsView.ts`), confirmado también por `docs/audits/SALES-AGENT-R1-commercial-proposal-checkout-readiness-audit.md:166`; `crm_opportunities` solo tiene `product_interests_json` (interés, no compromiso). Esto es exactamente el gap que la sección 6 del brief anticipa y para el cual prescribe dividir la tarea en `T13E.1`/`T13E.2` en vez de inventar un carrito silencioso.
2. **`ProductDetail.weightKg` no existía en el cliente HTTP de este repo**, a pesar de que el brief lo asumía disponible. Verificado directamente: `lib/catalog/types.ts#CatalogProduct` no tenía el campo, `lib/catalog/httpCatalogAdapter.ts#parseProductResponse` nunca lo leía. Investigación en el repositorio hermano `MS-Stock/services` mostró que el contrato real *sí* expone `weightKg: number | null` en `GET /v1/products/:productId` (heredado por `POST /v1/products/batch`), validado en vivo contra producción en `docs/releases/CAT-R1-T13B-product-weight-contract.md` de ese repositorio, cuya sección final ("Siguiente integración esperada") nombra exactamente esta tarea pendiente en `CRM-Customer-360`. Esto **no** era un bloqueo real — era trabajo legítimo y bien evidenciado, cerrado en este incremento (ver sección "Catalog Service").
3. **`pc_pos` no era accesible en esta sesión al comenzar** (`LOGISTICS_DB_ENABLED`/`HOST`/`USER`/`PASSWORD` ausentes de `.env`, `.env.local`, `infra/.env` y del entorno del proceso). El usuario proveyó la credencial real (`pc_consultor`, `GRANT SELECT ON *.*`, mismo patrón read-only que T13B/T13C) durante la sesión — ver sección "Auditoría pc_pos" para la evidencia real obtenida con esa credencial.

Con (1) sin resolver, cablear `calculate_shipping` al Capability Gateway/`AGENT_LOOP_TOOL_POOL` produciría una capability que solo puede denegar (`products_required`) siempre — sección 30 del brief exige preconditions backend-resueltas antes de agregar una capability al loop, así que ese paso queda explícitamente diferido, no implementado a medias.

## Auditoría pc_pos (Fase 1, con datos reales)

Ejecutada con la credencial `pc_consultor` (`GRANT SELECT ON *.* TO pc_consultor@%`, confirmado con `SHOW GRANTS` antes de cualquier otra consulta, mismo patrón que T13B/T13C). Solo `SELECT`/`SHOW`/`DESCRIBE`, ninguna escritura. Consultas ad-hoc ejecutadas desde scripts temporales fuera de control de versiones, eliminados al terminar.

### `carriers` (3 filas)

| id | name | display_name | enabled |
|---:|---|---|---:|
| 1 | starken | Starken | 1 |
| 2 | blueexpress | Blue Express | 1 |
| 3 | despacho directo | Pesas Chile | 1 |

Confirma en vivo el mapeo asumido por el brief (1=Starken, 2=Blue Express, 3=Pesas Chile), los tres `enabled=1`.

### `carrier_comunas` y `carrier_coverage` (1026 filas cada una)

- Mismo conjunto exacto de llaves `(carrier_id, comuna_id)` en ambas tablas (verificado con `LEFT JOIN` en ambas direcciones — cero filas huérfanas en cualquier sentido).
- Sin duplicados `(carrier_id, comuna_id)` en ninguna de las dos tablas.
- `carrier_coverage.covered` nunca es `NULL` en la práctica (columna nullable en el schema, pero 0 filas `NULL` reales).
- Filas por carrier: Starken 340, Blue Express 343, Pesas Chile 343 (de 346 comunas totales; 343 comunas tienen al menos una fila de algún carrier — 3 comunas, `Camarones`/`San Pedro`/`Tirúa`, no tienen fila de ningún carrier).
- **Semántica de ausencia de fila confirmada empíricamente, distinta de `covered=0`**: Starken carece de fila (no de `covered=0`, sino de fila) para exactamente 3 comunas — `Ollague`, `Cabo de Hornos`, `Antártica` — zonas extremas/remotas. Esto es distinto de los 27 casos donde Starken sí tiene fila con `covered=0` (comuna configurada, explícitamente no servida). `carrier_coverage` por carrier: Starken 313 `covered=1`/27 `covered=0`; Blue Express 343 `covered=1`/0 `covered=0` (cobertura total); Pesas Chile 27 `covered=1`/316 `covered=0`.
- Ejemplo real, Ñuñoa (`comuna_id=99`): Blue Express `covered=1`, Starken `covered=0` (no cubierto — confirmado, no asumido), Pesas Chile `covered=1`.
- **Cobertura de Pesas Chile (carrier 3, "despacho directo") es 100% Región Metropolitana**, confirmado con un `JOIN comuna->city->region` real sobre las 27 filas `covered=1` (todas `id_region=7`, "Metropolitana de Santiago").

### `carrier_rangos_dd` (6 filas) — semántica de rate NO confirmada

```text
id | region_nombre | rango_ini | rango_fin | precio
 1 | RM             |         1 |     59999 |   4193
 2 | RM             |     60000 |    119999 |   5034
 3 | RM             |    120000 |    499999 |      1
 4 | RM             |    500000 |    999999 |   8395
 5 | RM             |   1000000 |   2499999 |  20160
 6 | RM             |   2500000 |  99999999 |  46210
```

- `region_nombre` es literalmente `"RM"` en las 6 filas — **no coincide exactamente con ningún valor de `pc_pos.region.region_name`** (verificado: 0 matches contra las 16 regiones reales, cuyo nombre real es "Metropolitana de Santiago"). Cualquier join contra `region` requeriría un mapeo explícito curado (`"RM" -> id_region 7`), nunca fuzzy — y hoy no hay necesidad práctica de ese join: la única cobertura real de Pesas Chile/despacho directo (el carrier al que este nombre de tabla sugiere que pertenece) es 100% RM (ver arriba), así que el único bucket existente ya cubre el único caso real.
- **Los rangos NO parecen ser peso en kg.** `rango_ini`/`rango_fin` van de 1 a 99.999.999 — ningún paquete de despacho a domicilio pesa entre 2.500.000 y 99.999.999 de ninguna unidad física razonable. La forma (un bracket final "hasta prácticamente infinito") es la firma típica de un tramo de **monto de pedido en CLP**, no de peso. `carrier_shipment` (1730 filas reales, exclusivamente `carrier_id=2`/Blue Express vía integración PrestaShop) no tiene columna de costo y no referencia `carrier_rangos_dd` — no hay tabla que corrobore ninguna de las dos hipótesis.
- `precio` va de 1 a 46210 — el valor `1` en el tramo `120000-499999` es una anomalía real sin explicación evidente en los datos (podría ser un error de carga, un tramo promocional, o un placeholder) — no se investigó más allá de reportarlo, siguiendo la instrucción explícita de no fabricar una interpretación.
- Sin columna de moneda, IVA, o "costo interno vs. precio cliente" en ningún lugar del schema.

**Veredicto**: `RATE_SOURCE_SEMANTICS_UNCONFIRMED`. La evidencia real disponible activamente contradice la hipótesis de trabajo del brief (rango en kg) más de lo que la confirma. No se implementó ningún cálculo de tarifa contra esta tabla — `ShippingRateProvider` (ver "Shipping domain" abajo) queda como contrato sin implementación real, y el dominio siempre reporta `rateStatus: "unavailable"` / `rateUnavailableReason: "rate_source_unconfirmed"` cuando no se inyecta un provider real.

### `product.weight` (pc_pos, no confundir con Catalog Service)

`pc_pos.product` tiene su propia columna `weight` (float, nullable, default 0) — un espejo/copia interno de PrestaShop dentro de pc_pos, **no** la fuente que este dominio usa. Consistente con el brief (sección 1B/33): el peso siempre viene de Catalog Service, nunca de PrestaShop/pc_pos directamente. No se leyó ni se usó esta columna.

## Catalog Service — `weightKg` cerrado en este incremento

- `lib/catalog/types.ts#CatalogProduct.weightKg: number | null` agregado — comentario in-line documenta la semántica confirmada (0 preservado, `null` solo para combinación no resoluble, nunca negativo porque el servicio real ya falla cerrado con 503 antes de que un valor negativo llegue en una respuesta 200).
- `lib/catalog/httpCatalogAdapter.ts#parseProductResponse` lee `payload.weightKg` (hermano de `payload.pricing`/`payload.stock`, nunca anidado bajo `product` — confirmado contra el contrato real documentado en el repositorio hermano) vía el mismo `asNumber()` ya usado para el resto de los campos numéricos del archivo — preserva `0`, mapea `null`/ausente a `null`, nunca lanza.
- 4 tests nuevos en `tests/catalog/httpCatalogAdapter.test.ts`: número presente, `0` preservado literalmente, `null` explícito, campo ausente (respuesta de una versión anterior del servicio) — los cuatro pasan.
- Todos los sitios de test que construían un `CatalogProduct` completo (2 archivos: `tests/agent-loop/buildToolObservation.test.ts`, `tests/commercial/rankCatalogCandidatesByBudget.test.ts`) actualizados con `weightKg: null` por defecto — el resto de los 11 archivos que referencian `CatalogProduct` ya usaban spreads/overrides parciales y no requirieron cambio.

## Shipping domain (`lib/domains/shipping-calculation/`)

Puro: cero import de `mysql2`, `pc_pos`, HTTP o credenciales — mismo patrón de frontera que `lib/domains/commune-resolution/`.

- `types.ts`: `ShippingCalculationLineItem`, `ShippingCalculationInput` (incluye `destination.destinationFactId`, evidencia de contra qué versión del destino T13D se calculó), `CarrierCoverageStatus` (`covered`/`not_covered`/`unknown`), `CarrierOption`, `ShippingCalculationResult` (unión discriminada por `status`: `available`/`partial`/`not_covered`/`weight_unavailable`/`invalid_input`/`configuration_unavailable`/`technical_error`).
- `ports.ts`: `ShippingCoverageProvider` (real, ver adapter abajo) y `ShippingRateProvider` (contrato definido, sin implementación real — ver "Rates" abajo). `CalculateShippingDeps.rateProvider` es opcional; su ausencia es en sí misma el default honesto (todo rate `unavailable`).
- `weight.ts#validateAndSumWeightKg`: suma con escalado entero (kg × 1000 como enteros, sumados, dividido una sola vez al final) para que el error de coma flotante nunca se acumule entre líneas — `unitWeightKg` ya viene redondeado a 3 decimales por Catalog Service, así que `Math.round(kg * 1000)` recupera el entero exacto pese al ruido de representación IEEE754. `weightKg === null` en cualquier línea falla cerrado toda la operación (`weight_unavailable`) — no calcula un total parcial. `weightKg === 0` se preserva. Negativo/no-finito → `technical_error` (inconsistencia de datos upstream, no error del caller). `quantity` debe ser entero positivo.
- `calculator.ts#calculateShipping`: orquesta validación → suma de peso → `coverageProvider.getCoverageForCommune` → (si hay `rateProvider`) tarifa por carrier cubierto → combina en un resultado único. Filtra carriers `enabled=false` antes de construir `options` (nunca aparecen). Nunca selecciona "el mejor carrier" — devuelve todas las opciones elegibles, sin ranking ni preferencia.

### Determinación del `status` agregado

- `not_covered`: ningún carrier tiene `coverage: "covered"` (independientemente de si el resto es `not_covered` o `unknown`).
- `available`: al menos un carrier cubierto, y **todos** los carriers cubiertos tienen `rateStatus: "available"`.
- `partial`: al menos un carrier cubierto, pero no todos (o ninguno) tienen tarifa confirmada — es el único estado alcanzable hoy en producción, dado que no existe `ShippingRateProvider` real.

## pc_pos adapter (`lib/integrations/logistics/shipping-coverage-adapter.ts`)

- Dos SELECT fijos, read-only: `SELECT id, name, display_name, enabled FROM carriers` (cacheado en memoria de proceso, TTL 5 min, mismo patrón `ponytail:` que `pc-pos-adapter.ts#loadCatalog` — tabla de 3 filas, casi estática) y `SELECT carrier_id, covered FROM carrier_coverage WHERE comuna_id = ?` (parametrizado por un entero — seguro, sin problema de collation ya que no es comparación de texto; nunca cacheado, es configuración operacional que un equipo de logística podría cambiar).
- `LogisticsQueryExecutor.queryRows` (`lib/integrations/logistics/queryExecutor.ts`) extendido con un segundo parámetro opcional `params?: readonly unknown[]` — cambio aditivo, no rompe el único call site previo (`pc-pos-adapter.ts`, sin params). `pool.ts` pasa `params` a `connectionPool.query(sql, params)`.
- Fila ausente en `carrier_coverage` para `(carrierId, communeId)` → `coverage: "unknown"`. Fila presente con `covered=1`/`covered=0`/`NULL` → `"covered"`/`"not_covered"`/`"unknown"` respectivamente (el `NULL` defensivo nunca se observó en datos reales, pero el código lo trata igual que ausencia de fila, no como `not_covered`).
- `enabled` se reporta tal cual desde `carriers.enabled` — filtrar carriers deshabilitados es responsabilidad del dominio (`calculator.ts`), no del adapter.
- Errores de conexión clasificados `unavailable`/`timeout` (mismo patrón que `pc-pos-adapter.ts`), nunca fugan credenciales en `detail` (`sanitizeDbError`, reutilizado).
- Ninguna sentencia `INSERT`/`UPDATE`/`DELETE`/DDL en el módulo.

## Rates — `RATE_SOURCE_SEMANTICS_UNCONFIRMED`

No implementado. `ShippingRateProvider` es un contrato sin adapter real. Razón completa en "Auditoría pc_pos" arriba — resumen: los rangos de `carrier_rangos_dd` no tienen la forma de un bracket de peso en kg, no hay evidencia de moneda/IVA/costo-vs-precio-cliente, y `region_nombre="RM"` no corresponde textualmente a ninguna región real (aunque, dado que la única cobertura real del carrier al que esta tabla presumiblemente pertenece — Pesas Chile/despacho directo — es 100% RM, el join regional general nunca llegó a ser necesario para los datos actuales). Ningún precio fue inventado o estimado en ningún punto de este incremento.

## Tests

25 tests nuevos, todos verdes:

- `tests/catalog/httpCatalogAdapter.test.ts` (+4): `weightKg` numérico, `0` preservado, `null` explícito, campo ausente.
- `tests/domains/shippingCalculationWeight.test.ts` (13): casos de la sección 28 del brief — suma simple, por cantidad, múltiples líneas, precisión de 3 decimales sobreviviendo la suma en coma flotante, `null` falla cerrado, `0` preservado, negativo/no-finito es `technical_error`, cantidad cero/negativa/no-entera inválida, arreglo vacío inválido, la primera línea inválida determina el fallo (sin total parcial).
- `tests/domains/shippingCalculationCalculator.test.ts` (12): casos de la sección 29 del brief — destino cubierto por al menos un carrier (A), destino sin cobertura (B), múltiples carriers cubiertos sin selección arbitraria (C), destino stale detectable vía `destinationFactId` echoed back (D), Catalog Service no disponible nunca fabrica tarifa y ni siquiera consulta cobertura (E), pc_pos no disponible es `technical_error` (F), fuente de tarifa no disponible mantiene cobertura conocida (G), input inválido de destino rechazado en el boundary tipado (H, no aplica un `communeId` falso del LLM porque el input ya es un `ShippingCalculationInput` tipado, no salida cruda del agente), distinción real `covered`/`not_covered`/`unknown` nunca colapsada, carrier deshabilitado nunca aparece como opción, y ambos estados agregados `available`/`partial` cuando sí hay `rateProvider` inyectado.
- `tests/integrations/pcPosShippingCoverage.test.ts` (8): `configuration_unavailable` sin executor, ejemplo real de Ñuñoa (Blue Express/Pesas Chile cubiertos, Starken no), fila ausente es `unknown` (nunca `not_covered` silencioso), carrier deshabilitado se reporta `enabled:false` sin que el adapter lo filtre, cache de `carriers` (1 query) vs. `carrier_coverage` siempre en vivo (N queries), clasificación de fallo de conexión/timeout, ninguna credencial fuga en un mensaje de error.

Adicionalmente, verificación en vivo (fuera de la suite de tests, script temporal eliminado al terminar) del adapter real contra `pc_pos` de producción para `communeId=99` (Ñuñoa) y `communeId=345` (Cabo de Hornos) — resultado idéntico byte a byte al obtenido por consulta SQL directa durante la auditoría.

## Validaciones

- `npx tsc --noEmit`: limpio.
- `npm run lint`: 0 errores, 34 warnings preexistentes (mismo conteo que T13C/T13D, ninguno en archivos de esta tarea).
- `npm run build`: limpio.
- `npm test`: 2791 tests, 2759 pass / 32 fail. Comparado explícitamente contra un baseline limpio (`git stash` sobre esta misma rama, árbol idéntico a `develop@c0b2aff`): 2754 tests, 2721 pass / 33 fail. El conjunto de fallos de esta rama es un **subconjunto estricto** del conjunto de fallos del baseline (verificado por diff de nombres de test, no solo de conteos) — cero fallos nuevos introducidos por esta tarea; el único delta es un test de concurrencia real (`ACS-R1-05-T06.2 (P2): ... never produces two outbox messages ...`) que falló en el baseline y no en esta corrida, consistente con ser un test sensible a timing, no una regresión de esta tarea. Ninguno de los 32/33 fallos toca `lib/domains/shipping-calculation/`, `lib/integrations/logistics/`, `lib/catalog/`, ni ningún archivo de test de esta tarea.

## Scope check

Confirmado:

- Sin checkout, sin creación de orden, sin booking de carrier, sin labels/tracking.
- Sin escritura en `pc_pos` (solo los dos `SELECT` fijos ya descritos).
- Sin fallback de peso inventado (`weightKg: null` siempre falla cerrado).
- Sin tarifa inventada — `RATE_SOURCE_SEMANTICS_UNCONFIRMED` documentado, no rellenado con un número plausible.
- Sin selección automática de "mejor" carrier.
- Sin geografía fuzzy — el único mapeo regional potencial (`"RM"` → `id_region=7`) quedó identificado pero no implementado, porque no hace falta con los datos actuales (única cobertura real de Pesas Chile es 100% RM).
- Sin cablear `calculate_shipping` al Capability Gateway/Agent Tool Loop — diferido a un incremento posterior junto con T13E.2 (selección de line items), por las razones evidenciadas arriba.
- Sin tocar `crm_capability_executions`, `crm_quotes`, ni ninguna tabla de `main_management` — este incremento es dominio puro + un adapter de lectura nuevo sobre `pc_pos`.

## Siguiente tarea

No decidido aquí. Candidatas, en orden de dependencia: (1) `T13E.2` — diseñar y construir una fuente durable, autoritativa y alcanzable desde el runtime nativo de líneas de producto seleccionadas (`productId`/`combinationId`/`quantity`), siguiendo el mismo patrón `crm_request_facts` que T13D ya estableció para `shipping_destination`; (2) una vez (1) exista, cablear `calculate_shipping` al Capability Gateway/`AGENT_LOOP_TOOL_POOL` consumiendo el dominio de este incremento tal cual; (3) resolver con autoridad de producto/operaciones la semántica real de `carrier_rangos_dd` (unidad de `rango_ini`/`rango_fin`, moneda/IVA de `precio`, a qué carrier aplica) antes de implementar `ShippingRateProvider` — posiblemente requiere a alguien con acceso al sistema que puebla esa tabla, no solo lectura SQL.
