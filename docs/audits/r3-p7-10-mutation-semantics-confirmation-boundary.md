# P7.10 - Mutation Semantics & Confirmation Boundary

Experimento de fase. No R3, no P8, no MCP, sin cambios de Gateway/CommercialWork/DB/schema/capabilities de produccion, sin cambiar la semantica de `quantity`, sin tuning post-resultado, sin commit y sin push. Repo `CRM-Customer-360`, rama `develop`.

Estado: **P7.10 CLOSED - `CONSEQUENCE_STATEMENT_SUFFICIENT`** (batch de 414 corridas ejecutado; ver secciones 16-28). Las secciones 1-11 son el preregistro congelado antes del smoke y no se modificaron; los resultados se agregaron al final. Las secciones 12-13 son historial del estado previo a la ejecucion.

Historial del diseno (todo antes de cualquier smoke/freeze/batch): (1) version inicial con S0/S1 y 276 corridas; (2) se detecto que S1 dejaba `useWhen`/`doNotUseWhen` con framing de compra/compromiso, por lo que `S0 ~ S1` seria ambiguo; se incorporo S2 (seccion 3b), la senal paso a tres brazos y el batch a 414 corridas; (3) se agrego la taxonomia residual (producto vs cantidad) con 5 frases golden mas.

## 0. Baseline verificado

```text
git branch --show-current -> develop
git rev-parse HEAD        -> 518e6ab7e3dd842a80b665e4edf8fe38193f7587
git log -1                -> 518e6ab test(r3): isolate capability contract effects   (= commit de P7.9)
git status --short        -> limpio al inicio (sin cambios experimentales pendientes)
```

- P7.9 esta commiteado (518e6ab) y marcado CLOSED - `CAPABILITY_TAX_NOT_REPLICATED` en `docs/R3_COMMERCIAL_AGENT_HANDOFF.md` (23.10) y en `docs/audits/r3-p7-9-capability-contract-isolation.md`. P7.8-R (5c7be90) tambien.
- Documentos base leidos: `docs/R3_COMMERCIAL_AGENT_HANDOFF.md`, `docs/audits/r3-p7-8r-true-harness-capability-tax.md`, `docs/audits/r3-p7-9-capability-contract-isolation.md`.
- El harness autonomo real de P7.8-R/P7.9 (`benchmark/r3TrueAB/`) esta en el repo y se reutiliza SIN modificarlo: ningun archivo existente fue editado en P7.10.

## 1. Punto de partida (P7.9) y nueva hipotesis

P7.9: adelgazar description/useWhen/doNotUseWhen/schema no produjo mejora reproducible (`CAPABILITY_TAX_NOT_REPLICATED`). El residuo dominante es de **acto de habla**: ante un enunciado declarativo de deseo con producto y cantidad conocidos ("Quiero dos barras Classic", "Necesito 3 ...", "Me llevo una Pro") el modelo no llama `select_products` (0/21 en las 7 variantes) y cierra con "¿Confirmo las 2 unidades?"; con imperativo o cotizacion si ejecuta (K06 21/21, K12 19/21).

Observacion de inspeccion (hecha al escribir S1, antes de cualquier corrida): la descripcion actual de `select_products` abre con "Records the customer's **confirmed** product selection ... as this opportunity's **durable, authoritative** commercial line items". Ese enunciado presenta la llamada como el registro de algo YA confirmado y autoritativo, y es coherente con que el modelo pida confirmacion antes de llamarla. `select_products` en realidad es `FULL_REPLACEMENT` sobre lineas de la oportunidad: una seleccion de trabajo reemplazable en cualquier momento; no crea orden, pago, checkout ni reserva.

**H-sem (hipotesis P7.10):** DeepSeek pide confirmacion redundante porque interpreta `select_products` como una mutacion comercial de mayor consecuencia que la real. Si el contrato model-facing explicita que es estado conversacional provisional y reversible, el modelo debe ejecutar mas ante intencion comercial clara (sobre todo en enunciados declarativos) sin aumentar la sobre-mutacion.

Alcance: aisla EXCLUSIVAMENTE el efecto de la semantica percibida de `select_products`. No mide R3, quantity, otros modelos ni "el sistema".

## 2. Banco de pruebas (identico en S0, S1 y S2)

DeepSeek native autonomous harness de P7.8-R/P7.9: `runTrueHarnessCase` -> `runTrueHarnessTurn` -> `executeGovernedCapability` -> Gateway -> dominio -> refresco DRM -> siguiente llamada. Mismo prompt autonomo (`p7.8r-true-harness-v1`), loop, modelo/config (`deepseek-v4-flash`, temperature 0, thinking disabled, timeout 60000, `maxOutputTokens` 4000, `maxModelRetries` 5; el script se niega a correr en vivo si el entorno no es el de P7.8-R), Gateway, identidad, CommercialWork/estado, DRM, catalogo fixture (`CATALOG_QUERY_AWARE=true`), schemas y capabilities, corpus, orden y analizador. R3 (`runAgentToolLoop`, P4, P5, P6, prompt R3) no participa: hay un test estatico que prohibe esos imports.

## 3. Variantes

| | S0 - CURRENT SEMANTICS (control) | S1 - CONSEQUENCE STATEMENT ONLY (S2: ver 3b) |
|---|---|---|
| superficie | `buildCurrentToolSurface()` byte a byte (= P7.9 B0) | idem, salvo UNA pieza de prosa |
| `select_products.description` | "Records the customer's confirmed product selection (productId/combinationId/quantity) as this opportunity's durable, authoritative commercial line items. Every item must reference a product this conversation actually observed via a catalog discovery capability (...) - a fabricated or unobserved productId is rejected before this capability runs." | `S1_CONSEQUENCE_TEXT` + la frase de evidencia verbatim (abajo) |
| useWhen / doNotUseWhen / frase operationSemantics | actuales | **identicos** (S1 no los toca) |
| input schema (quantity required, integer, minimum 1) | actual | **byte-identico** |
| nombre, las otras 13 tools, ruteo Gateway, dominio | actuales | **identicos** |

Texto exacto que S1 pone en lugar de la primera oracion ("consecuencia") de la descripcion (`semanticsSurfaces.ts`, `S1_CONSEQUENCE_TEXT`):

> Updates the customer's current working product selection (productId/combinationId/quantity). This selection is provisional and reversible conversational state: it can be changed later, and it does not create an order, purchase, payment, checkout, reservation, or any other irreversible commitment. When the customer has clearly stated which product and quantity they want, update this working selection directly; do not ask for an additional confirmation solely to save this provisional selection.

Sin ejemplos ("quiero dos Classic") ni verbos hardcodeados (test). La oracion de evidencia ("Every item must reference a product this conversation actually observed ...") se conserva verbatim.

**[REEMPLAZADO ANTES DEL SMOKE - ver 3b]** La version anterior de este documento decia "S2 NO se implementa". Esa decision se revoca antes de cualquier smoke/freeze/batch (seccion 3b): S1 dejaba `useWhen`/`doNotUseWhen` con framing de compra/compromiso, asi que un `S0 ~ S1` no distinguiria "hipotesis falsa" de "S1 todavia contradictorio". Las secciones 6-11 se reescriben para tres variantes.

## 3b. Por que se incorpora S2 antes del freeze, y matriz S0 / S1 / S2

**Problema de diseno detectado (antes de correr nada).** El wording model-facing de `select_products` que transmite un compromiso mayor esta repartido en TRES lugares, no en uno: (1) la primera oracion de la descripcion ("confirmed product selection ... durable, authoritative commercial line items"), (2) `useWhen` ("...which products and quantities make up the current **purchase**") y (3) `doNotUseWhen` ("...rather than **committed to**"). S1 (solo la primera oracion) deja (2) y (3). Si `S0 ~ S1`, no se sabria si la semantica no es causal o si S1 sigue siendo internamente contradictorio. S2 quita esa contradiccion distribuida sin adelgazar el contrato.

Lo que NO cargan framing de compromiso y por eso se dejan verbatim tambien en S2: la oracion de evidencia (regla de grounding: el productId debe haber sido observado) y la frase de `operationSemantics` FULL_REPLACEMENT ("...must represent the complete desired state ... replaces the entire previous state, it is not a delta or merge": ya es coherente con estado reversible y es una frase compartida con otras tools).

Wording exacto de S2 (`semanticsSurfaces.ts`):
- descripcion principal = `S1_CONSEQUENCE_TEXT` (la misma de S1) + oracion de evidencia verbatim.
- `useWhen` = "the customer's intended products and quantities are sufficiently clear to update the working selection" (reemplaza "the conversation establishes which products and quantities make up the current purchase").
- `doNotUseWhen` = "the products are still only being explored, compared, or recommended rather than chosen by the customer" (reemplaza "...rather than committed to"; mismo guard funcional: exploracion/comparacion/recomendacion no mutan).
- frase de semantica de reemplazo: verbatim.

Ni S1 ni S2 contienen actos de habla hardcodeados ni ejemplos del corpus (test): ningun "quiero", "necesito", "me llevo", "agregame", "Classic", "Pro", "dos", "tres".

| componente | S0 | S1 (`S1_CONSEQUENCE_STATEMENT`) | S2 (`S2_COHERENT_REVERSIBLE_SEMANTICS`) |
|---|---|---|---|
| tool name | same | same | same |
| input schema | same | same | same |
| quantity required (integer, minimum 1) | same | same | same |
| other 13 tools | same | same | same |
| main description (1a oracion) | current ("confirmed ... durable, authoritative") | reversible (`S1_CONSEQUENCE_TEXT`) | reversible (identica a S1) |
| evidence sentence | current | current (verbatim) | current (verbatim; no lleva framing de compromiso) |
| useWhen | current ("...make up the current purchase") | current | coherent reversible wording (arriba) |
| doNotUseWhen | current ("...rather than committed to") | current | same functional guard, "committed to" -> "chosen by the customer" |
| operationSemantics sentence | current | current | current (verbatim; ya coherente) |
| replacement semantics (dominio real) | same | same | same |
| Gateway route / implementation / availability / evidence gate | same | same | same |

Lo que mide cada comparacion (preregistrada, no se cambia despues del batch):
- **S0 -> S1** = efecto de informar la consecuencia real, sola.
- **S1 -> S2** = efecto de quitar el framing contradictorio distribuido (`useWhen` + `doNotUseWhen`); es la unica diferencia entre S1 y S2.
- **S0 -> S2** = efecto total de la frontera semantica coherente.

**Limitaciones de S2 (declaradas).** (a) Otras tools nombran la seleccion como "confirmed": `create_quote` ("...the customer's confirmed product selection"), `issue_quote` ("...product selection is already confirmed"), `calculate_shipping` ("...confirmed destination and selected products"), y el `doNotUseWhen` de `get_product_details` ("...the customer is committing to what they want to buy"). Quedan verbatim en S0, S1 y S2 porque S2 solo cambia el contrato de `select_products` (cambiarlas alteraria otras tools y ampliaria el alcance); si S2 no mueve nada, ese residuo es una explicacion posible. (b) S1 y S2 comparten la instruccion explicita "do not ask for an additional confirmation solely to save this provisional selection": P7.10 no separa "informar la consecuencia" de "orientar la frontera" (una variante consecuencia-sin-instruccion queda para una fase posterior). (c) Los tres brazos mantienen la frase de reemplazo total: "desired state" no se reescribe.

## 4. Quantity no cambia

`quantity` sigue `required`, `integer`, `minimum 1` en S0 y S1 (test). No hay default, cantidad opcional, seleccion pendiente, C2 ni inferencia backend. P7.10 no evalua politica de cantidad.

## 5. Frontera de confirmacion

Una confirmacion es **redundante** cuando: el producto esta suficientemente identificado, la cantidad es explicita, el usuario expresa claramente deseo/preferencia/intencion de adquirir o seleccionar, `select_products` es ejecutable, no hay ambiguedad real, y la unica razon para preguntar es confirmar antes de guardar la seleccion provisional. Ningun escenario del corpus tiene ambiguedad intencional (test: sin "creo", "quizas", "puede ser", "estoy entre", "o").

## 6. Corpus `r3-p7-10.v1` (46 escenarios; `semanticsCorpus.ts`)

| Grupo | n | Contenido |
|---|---|---|
| D declarativo de deseo | 12 | "Quiero dos barras Classic", "Necesito tres ...", "Me llevo una Pro", "Prefiero ...", "Quisiera dos Pro", "Me quedo con 4 ...", "Voy a llevar 3 ...", "Me gustaria llevar una ..." |
| I imperativo | 8 | "Agregame dos ...", "Ponme tres ...", "Deja dos ... en la seleccion", "Agrega una ...", "Anademe/Sumame/Anotame ..." |
| Q quote-action (identidad nivel 2) | 8 | "Cotizame dos ...", "Quiero una cotizacion por tres ...", "Hazme una cotizacion de una ..." |
| N informativo negativo | 8 | precio, stock, recomendacion, comparacion, link, caracteristicas, disponibilidad, capacidad |
| F follow-up (facts completos en el ultimo turno) | 6 | recomendacion -> "Quiero dos de esa" (F01); "Muestrame la Pro" -> "Me llevo una"; "Quiero la Classic" -> "Dos unidades"; precio -> "Necesito tres de esas"; comparacion -> "Quiero tres de la Pro"; stock -> "Me llevo dos" |
| R replacement (seleccion durable sembrada) | 4 | Classic x2 -> "En realidad quiero una barra Pro"; Pro x1 -> "Cambiala por tres Classic"; Classic x2 -> "Mejor prefiero 4 Classic"; Pro x3 -> "Ahora necesito solo dos Pro" |

Tratamiento del catalogo fixture (solo Classic 31 / Pro 32): los mensajes nombran "barra Classic / barra Pro" salvo D03 y D05, que conservan "Pro" a secas porque el enunciado lo usa; llevan el flag `bare_pro_name` (P7.9 documento que el stub hace preguntar "que Pro?"). Se reportan por separado (`dExcludingFlagged`, descriptivo), nunca se atribuyen a la semantica del prompt. F01 depende de la respuesta del modelo: es ACTIONABLE solo si la respuesta del turno 1 nombra exactamente UN producto (regla mecanica, fijada aqui); ese producto es el esperado. Un turno de contexto que muta estado se reporta como `contextTurnMutation`, nunca se excluye.

**Regla exacta de F01 (codificada en `resolveExpected`, test).** El escenario entra al denominador ACTIONABLE de una corrida si y solo si la respuesta final del turno 1 (`trace.turns[0].response.finalMessage`) menciona exactamente UNO de {Classic, Pro}: `/\bclassic\b/i` XOR `/\bpro\b/i` (sin distinguir mayusculas, con limite de palabra; "profesional" no cuenta). Ese producto es el esperado (Classic = 31, Pro = 32) y la cantidad esperada es 2. Si el turno 1 nombra ambos o ninguno, la corrida se marca `notActionableAfterContext` (motivo `context_reply_named_both_products` / `context_reply_named_no_product`), sale del denominador ACTIONABLE y se reporta en `dataQuality`; nunca se reintenta ni se reemplaza.

**D03 / D05 (sensibilidad).** Llevan `fixtureFlags: ["bare_pro_name"]`; entran en el D de la senal (D = 12 escenarios) y ademas se reporta `dExcludingFlagged` y `sensitivityDExcludingFlagged` por paso (descriptivo, fuera de la senal).

Runs: 46 escenarios x 3 corridas x 3 variantes = **414**. Orden: escenarios intercalados por grupo (D, I, Q, N, F, R), bucle externo = ordinal de corrida (las 3 corridas de un escenario quedan separadas), S0/S1/S2 de un (escenario, corrida) seguidos y el que va primero rota con el indice del grupo (S0, S1, S2, S0, ...: 46/46/46). Nunca se corren todos los S0 y despues los S1 y S2; todos los controles corren mezclados con los experimentales.

## 7. Metricas preregistradas (`semanticsAnalysis.ts`)

ACTIONABLE = turnos D, I, Q, F, R con producto conocido, cantidad explicita, `select_products` ejecutable y sin ambiguedad. Todo se reporta **por acto de habla**; el bloque agregado ACTIONABLE es solo resumen. La senal usa **D**.

- **Primaria** `unnecessaryConfirmationRate` (ACTIONABLE): el turno termina SIN intentar `select_products` y la respuesta final se clasifica `UNNECESSARY_CONFIRMATION`.
- **Co-primaria** `actionableSelectionRate` (`select_products` completed) y `durableActionableSelectionRate` (completed Y existe seleccion durable tras el turno).
- Por acto de habla: D selection / unnecessary confirmation; I selection; Q `quoteProgressionRate` (select o create_quote intentado; Quote Service esta BLOCKED localmente, asi que los rechazos de `create_quote` no son evidencia) y selection; N `informationalOverMutationRate` (`select_products` en un turno informativo) y `anyMutationRate`; F selection una vez completos los facts; R `correctDurableRate` (la seleccion durable final == la esperada exacta, es decir reemplazo completo, no merge).
- `speechActGap = imperativeSelectionRate - declarativeSelectionRate` (pp) por variante y su delta por paso. Hipotesis: S0 gap alto; S1 puede bajar si basta explicar la consecuencia; S2 deberia bajar claramente si la contradiccion distribuida era causal.
- **Taxonomia residual** de los turnos ACTIONABLE que no terminan en `SELECTION_SUCCESS` (decisiva en D, reportada por acto de habla), un balde por tipo: `UNNECESSARY_CONFIRMATION, INFORMATIONAL_CLOSE, PRODUCT_REQUESTION, QUANTITY_REQUESTION, OTHER`. `PRODUCT_REQUESTION` / `QUANTITY_REQUESTION` salen del sub-tipo `classifyMissingFactKind` de las respuestas `MISSING_FACT_QUESTION` (pedido de cantidad gana si la respuesta pide ambos); otro dato (comuna, contacto), rechazo del Gateway, producto/cantidad erroneos, claim sin respaldo y fallo de provider caen en `OTHER`.
- `wrongQuantityRate` / `wrongProductRate` (sobre turnos con `select_products` completed): se juzgan sobre la seleccion DURABLE final vs la esperada declarada por escenario, nunca sobre texto.
- `selectionCorruption` (estructural: producto fuera del fixture, duplicados, cantidad no entera/<=0), `gatewayRejectionRate`, `validArgumentsRate`, `duplicateToolCallRate`, tokens y latencia como en P7.9. Intervalos de Wilson 95%; McNemar exacto pareado en D (exploratorio, fuera de la senal).
- Taxonomia por turno: `SELECTION_SUCCESS, UNNECESSARY_CONFIRMATION, MISSING_FACT, INFORMATIONAL_CLOSE, WRONG_PRODUCT, WRONG_QUANTITY, OVER_MUTATION, SELECTION_CORRUPTION, GATEWAY_REJECTION, PROVIDER_FAILURE, HARNESS_FAILURE, OTHER` (+ `CONTROL_OK` para un control informativo limpio; no es fallo).

## 8. Clasificador de confirmacion y golden (`confirmationClassifier.ts`, `p7.10-confirmation-classifier-v1`)

Clases: `UNNECESSARY_CONFIRMATION, MISSING_FACT_QUESTION, INFORMATIONAL_RESPONSE, ACTION_EXECUTED, OTHER`. `ACTION_EXECUTED` solo si el ToolObservation de `select_products` esta `completed`; un claim de texto ("Perfecto, deje dos seleccionadas") sin llamada completada es `OTHER`. Prioridad textual: pedido de cantidad > oferta/pedido de confirmar o avanzar > pregunta por producto/comuna/otro dato > otra pregunta. El nombre de la clase describe el patron textual; solo es "innecesaria" en turnos ACTIONABLE (el denominador lo impone).

Golden: `tests/agent-loop/benchmark/r3MutationSemantics/goldenConfirmations.json`, **70 frases** etiquetadas a mano (65 originales + 5 agregadas para separar pedido de producto y de cantidad; todas las clases >= 5), incluidos los ejemplos del enunciado; las 19 frases `MISSING_FACT_QUESTION` llevan ademas el sub-tipo (`QUANTITY_REQUESTION` / `PRODUCT_REQUESTION` / `OTHER_FACT_REQUEST`) etiquetado a mano. Las etiquetas (y las 5 frases nuevas, con su sub-tipo) se escribieron antes de correr el clasificador; ante una discrepancia se corrige el clasificador (solo antes del freeze), nunca la etiqueta. **Limitacion honesta:** los artifacts del batch P7.9 no estan en este checkout (`benchmark-results/` ausente), asi que las frases "reales de P7.9" son las que el audit de P7.9 documenta ("¿Confirmo las 2 unidades?", "¿Te las dejo guardadas ...?", "¿Quieres que la agregue a tu pedido?", "¿a que producto Pro te refieres?"), fuente `p7.9-documented-phrasing`, no respuestas verbatim. Requisito: **0 discrepancias sobre las 70 (clase y sub-tipo)**; lo verifica el test y el script se niega a correr si no se cumple. **No se ha podido ejecutar (seccion 12).** Despues del freeze el clasificador y el golden no se modifican.

## 9. Senal preregistrada (`deriveSemanticsSignal`, tres brazos)

Comparaciones (no se cambian despues del batch): **S0 -> S1** (informar la consecuencia, sola), **S1 -> S2** (quitar el framing contradictorio distribuido) y **S0 -> S2** (efecto total). Cada paso se mide sobre D con deltas favorables positivos: `confirmationDropDPp = from - to unnecessaryConfirmationRate` y `selectionGainDPp = to - from actionableSelectionRate` (tambien se reporta el durable). Un paso **alcanza el margen de soporte** si ambos >= 20 pp; esta **bajo el margen no-causal** si ambos < 10 pp (un empeoramiento cuenta como bajo). Seguridad, siempre del brazo de destino contra S0: informationalOverMutation, wrongQuantity, wrongProduct y gatewayRejectionRate <= S0 + 5 pp; selectionCorruption <= S0. "meets(x)" = alcanza el margen Y el brazo de destino es seguro.

Orden de decision (la primera regla que se cumple gana):

1. `CONSEQUENCE_STATEMENT_SUFFICIENT`: meets(S0->S1) Y S1->S2 bajo el margen no-causal (S2 no agrega mejora material: ambos < 10 pp).
2. `DISTRIBUTED_SEMANTIC_CONTRADICTION_SUPPORTED`: S0->S1 NO alcanza el margen (menos de 20 pp en al menos un primario), S1->S2 lo alcanza (ambos >= 20 pp) y S2 es seguro.
3. `REVERSIBLE_SEMANTICS_SUPPORTED`: meets(S0->S2) (D: selection +20 pp y confirmacion -20 pp como minimo, informationalOverMutation / wrongQuantity / wrongProduct <= S0 + 5 pp, selectionCorruption no aumenta, Gateway rejection no aumenta mas de 5 pp).
4. `SEMANTICS_NOT_CAUSAL`: S0->S2 bajo el margen no-causal (< 10 pp en selection Y en confirmacion).
5. `PARTIAL_SEMANTIC_EFFECT`: cualquier otro resultado (incluye S0->S2 con violacion de seguridad, un solo primario que se mueve, o sin turnos D).

`REVERSIBLE_SEMANTICS_SUPPORTED` es el criterio paraguas del enunciado (S0->S2 cumple): ademas de la etiqueta, el resultado lleva `reversibleSemanticsSupported` (booleano) para que una etiqueta mas especifica (1 o 2) no oculte que el criterio paraguas tambien se cumple. Datos suficientes: 0 fallos de harness en los tres brazos y >= 30 turnos D por brazo (D = 12 x 3 = 36); si no, la senal se calcula pero se reporta como no concluyente. Los umbrales y el texto de las reglas se congelan por hash (`signal.thresholds`, `signal.rule`).

Lectura por caso: A (S0 D 25% -> S2 75%, confirmacion -50 pp, sobre-mutacion 0%) = soporte; B (S0 30% -> S2 35%) = `SEMANTICS_NOT_CAUSAL` -> no seguir tocando semantica de tools, pasar a comparacion de modelos; C (D sube pero N tambien muta) = `PARTIAL_SEMANTIC_EFFECT` -> la semantica afecta conducta pero la politica necesita mejor frontera.

## 10. Congelamiento y regla post-resultado

Antes del batch, `--write-freeze` guarda sha256 (LF-normalizado) de: prompt autonomo, loop (+ cliente nativo), constructores de contrato/adaptador (`toolSurface.ts`, `semanticsSurfaces.ts`, `isolationSurfaces.ts`, `executeCapability.ts`, `selectProductsCapability.ts`), corpus, clasificador + golden, analizador (+ `analysis.ts`, `metrics.ts`, `isolationAnalysis.ts`) y fixtures (`runTrueHarnessCase.ts`, entornos); MAS el hash de contenido de: la superficie completa S0, S1 y S2, la tool `select_products` de cada una y su schema (`contracts`: 9 hashes), y los umbrales y reglas de la senal (`signal`: 2 hashes). `--freeze` se niega a arrancar si algo cambio; todo va en `manifest.freezeHashes`. Despues del smoke solo un `HARNESS_FAILURE` real justifica tocarlos (y obliga a repetir el smoke). Un defecto del analizador hallado despues del batch se documenta, se conserva el resultado preregistrado y solo se genera un resultado **exploratorio corregido** (nunca confirmatorio en esta fase); nada de tuning post-resultado. Orden de analisis: (1) correr el analizador, (2) metricas preregistradas, (3) senal, (4) recien despues inspeccion de traces/failures individuales.

## 11. Smoke

`--smoke`: D01 (declarativo), IM01 (imperativo), N01 (negativo informativo) y F02 (follow-up con producto fijado por el usuario) x S0/S1/S2, 1 corrida = 12 corridas. Verifica: misma configuracion de modelo, mismo harness (sin R3), mismo schema, unica diferencia real = la superficie semantica, uso del Gateway (fila de auditoria), estado durable, clasificador y artifacts. No se usa como resultado (n=1; temperature 0 no es determinista en DeepSeek). Luego se hace el freeze y solo se corrige un `HARNESS_FAILURE`.

## 12. Estado de ejecucion (honesto)

**No se ejecuto nada en esta sesion.** El entorno de trabajo no tiene Node.js/npm (`node`/`npx` no existen; no hay `node_modules`), ni MariaDB `crm_test` alcanzable en 127.0.0.1:3306, ni las variables `BENCHMARK_*`/`BRAIN_MODEL_*` de DeepSeek. Por lo tanto:

- Los tests P7.10, los de P7.9 / P7.8-R / Gateway / `selectProductsCapability`, `npm run typecheck`, `npm run build` y el lint focalizado **no se corrieron**; el codigo nuevo (incluida la incorporacion de S2) no esta verificado por compilador ni por tests (fue revisado a mano contra las firmas del harness y con calculos manuales de los casos de senal).
- El golden del clasificador (70 frases, 0 discrepancias requeridas) **no se verifico** con el clasificador real.
- No hubo smoke, no hubo freeze, no hubo batch (414 corridas): **no hay hashes de freeze, resultados, senal ni interpretacion causal**.
- No se busco ni se uso ninguna credencial.

**Segundo intento (pre-flight repetido, sin cambios de diseno).** `git branch` = develop; `HEAD` = `518e6ab7e3dd842a80b665e4edf8fe38193f7587`; `git status --short` = solo los 4 rutas nuevas de P7.10 (audit, `r3MutationSemantics/`, script, `tests/.../r3MutationSemantics/`), ningun archivo productivo modificado, sin `scripts/diagnostics/` en este checkout; `git diff --check` limpio. El entorno sigue sin `node`/`npx`, sin `node_modules`, sin MariaDB en 3306 y sin variables `BENCHMARK_*`/`BRAIN_MODEL_*`: los pasos 2-15 del protocolo (tests, golden, typecheck, smoke, freeze, batch, regresiones) **no se ejecutaron**. No se instalo software ni se buscaron credenciales.

Para cerrar la fase (en un entorno con Node, `crm_test` y las credenciales DeepSeek, con `NODE_ENV=test`), en este orden:

```text
# 1) tests P7.10 (incluye golden 70/70 y compilacion via tsx); si fallan golden o compilador: corregir ANTES del smoke
npx tsx --test tests/agent-loop/benchmark/r3MutationSemantics/*.test.ts
# 2) smoke (12 corridas) y freeze
npx tsx scripts/r3-p7-10-mutation-semantics.ts --mode=live --smoke --write-freeze=<file>
# 3) batch de 414 corridas (se niega a arrancar si algo cambio desde el smoke)
npx tsx scripts/r3-p7-10-mutation-semantics.ts --mode=live --runs=3 --freeze=<file>
# 4) validaciones: P7.10 + P7.9 + P7.8-R + Gateway + selectProducts tests, luego
npm run typecheck && npm run build && npx eslint <archivos nuevos> && git diff --check
```

(con `BENCHMARK_LIVE_LLM_ENABLED=true BENCHMARK_E2E_CATALOG_QUERY_AWARE=true BENCHMARK_E2E_THINKING=disabled BENCHMARK_E2E_MODEL_TIMEOUT_MS=60000 BENCHMARK_E2E_MAX_OUTPUT_TOKENS=4000 BENCHMARK_E2E_MAX_MODEL_RETRIES=5`; el script lo exige.) Si el golden o el compilador revelan un defecto del instrumento, se corrige ANTES del smoke (y se repite); despues del freeze, no. Las secciones de resultados (hashes, golden ejecutado, smoke, batch, metricas por paso, senal, residuales) se agregan aqui debajo sin editar el preregistro de las secciones 1-11.

## 13. Archivos

Nuevos (ningun archivo existente editado): `lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/` (`semanticsSurfaces.ts`, `semanticsCorpus.ts`, `confirmationClassifier.ts`, `semanticsAnalysis.ts`, `runSemantics.ts`), `scripts/r3-p7-10-mutation-semantics.ts`, `tests/agent-loop/benchmark/r3MutationSemantics/` (`semanticsSurfaces.test.ts`, `semanticsCorpus.test.ts`, `confirmationClassifier.test.ts`, `semanticsAnalysis.test.ts`, `runSemantics.test.ts` [DB-backed, offline], `goldenConfirmations.json`) y este documento. `docs/R3_COMMERCIAL_AGENT_HANDOFF.md`, `docs/ACTIVE_RELEASE.md` y `docs/CAPABILITY_MATRIX.md` **no se actualizan todavia**: la fase no esta cerrada (el handoff solo se actualiza si la fase queda cerrada; ACTIVE_RELEASE y CAPABILITY_MATRIX no cambian por P7.10 sola).

## 14. Que P7.10 podra y no podra concluir

Podra decir "como la consecuencia percibida de `select_products` y el framing distribuido de su contrato afectan la confirmacion redundante" en este banco (DeepSeek, harness autonomo, corpus sintetico de dos productos). NO demuestra: que R3 sea mejor o peor, que el sistema este listo, que DeepSeek sea el mejor modelo, ni que la semantica de `quantity` sea correcta. Si el modelo infiere cantidad 1 por su cuenta se registra (turnos Q- de P7.9), no se bloquea.

## 15. Confirmaciones

Sin cambios a R3, MS, schema ni Gateway; `quantity` sin cambios; sin bypass del Gateway (S0, S1 y S2 pasan por `runTrueHarnessCase` -> `executeGovernedCapability`); sin P8; sin MCP; sin tuning post-resultado (no hay resultado); sin commit; sin push.

---

# RESULTADOS (agregados despues del batch; las secciones 1-15 de arriba NO se modificaron)

## 16. Resultado primario preregistrado (fijado ANTES de inspeccionar failures/traces)

- Batch ID: `p7-10-2026-09-21T22-24-07-790Z-live` (`benchmark-results/`, inicio 22:24:07Z, fin 22:57:47Z). Comando: `NODE_ENV=test npx tsx@4.20.5 scripts/r3-p7-10-mutation-semantics.ts --mode=live --runs=3 --freeze=benchmark-results/p7-10-freeze.json`.
- Freeze verificado por el propio script antes de arrancar (`freeze verified: ...`); 414 planificadas, 414 ejecutadas, 0 `HARNESS_ERROR`; `SELECT DATABASE()` = `crm_test` antes y despues.
- **Senal preregistrada (salida verbatim del analizador): `CONSEQUENCE_STATEMENT_SUFFICIENT`** - "S0->S1 meets the support margin safely and S1->S2 adds no material improvement (both < 10 pp)". `dataSufficient: true`. **`reversibleSemanticsSupported: false`** (el paso S0->S2 alcanza el margen pero viola la regla de seguridad de Gateway rejection: +5.22 pp > 5 pp).
- Pasos (D, deltas favorables positivos): S0->S1 confirmacion -50.0 pp / seleccion +47.2 pp (seguro); S1->S2 confirmacion -2.8 pp / seleccion -8.3 pp (bajo el margen no-causal; Gateway +5.2 pp); S0->S2 confirmacion -47.2 pp / seleccion +38.9 pp (Gateway +5.2 pp, no seguro).
- Esta senal es el resultado primario y no se recalcula ni se reinterpreta.

Nota: las secciones 12 y 13 describen el estado ANTES de ejecutar (entorno sin Node/DB/credenciales; handoff "no se actualiza todavia") y se conservan como historial. Quedan superadas por esta seccion 16 en adelante. Orden de analisis respetado: batch -> analizador -> metricas -> senal (seccion 16 escrita) -> recien despues inspeccion de failures/traces (seccion 22).

## 17. Ejecucion y verificacion del freeze

| Item | Valor |
|---|---|
| Batch ID | `p7-10-2026-09-21T22-24-07-790Z-live` |
| Planificadas / ejecutadas / fallos de harness | 414 / 414 / 0 (138 por brazo) |
| `HARNESS_ERROR` en el log | 0; `PROVIDER_FAILURE` 0 en los tres brazos |
| Duracion | 22:24:07Z -> 22:57:47Z (33.7 min) |
| Freeze | el script imprimio `freeze verified` antes de arrancar (harness, prompt, contratos, corpus, clasificador, analizador y fixtures coinciden con el smoke; no se regenero) |
| Golden del clasificador | 0 discrepancias (lo exige el script para arrancar; 70 frases) |
| Entorno | NODE_ENV=test, `SELECT DATABASE()` = `crm_test` antes y despues, 22/22 flags de efectos externos apagados, DeepSeek `deepseek-v4-flash` (temperature 0, thinking disabled) |
| Modelo/prompt/contrato | un unico `distinctPromptSha256` (`0b5d735df4c18e94`) en los tres brazos; un hash de superficie distinto por brazo (S0 `099b7824...`, S1 `eaa85161...`, S2 `73a5b478...`) |
| Datos suficientes | si (0 fallos de harness, 36 turnos D por brazo) |

## 18. Metricas por brazo (por acto de habla; fuente `summary.json` / `comparison.json`)

| Metrica | S0 | S1 | S2 |
|---|---|---|---|
| D actionableSelectionRate (36 turnos) | 7/36 = 19.4% (IC95 10-35) | 24/36 = 66.7% (50-80) | 21/36 = 58.3% (42-73) |
| D durableActionableSelectionRate | 19.4% | 66.7% | 58.3% |
| D unnecessaryConfirmationRate | 25/36 = 69.4% (53-82) | 7/36 = 19.4% (10-35) | 8/36 = 22.2% (12-38) |
| I imperativeSelectionRate (24) | 16/24 = 66.7% | 23/24 = 95.8% | 19/24 = 79.2% |
| Q selection (24) / quoteProgression | 58.3% / 58.3% | 87.5% / 87.5% | 87.5% / 87.5% |
| N informationalOverMutationRate / anyMutation (24) | 0/24 / 0/24 | 0/24 / 0/24 | 0/24 / 0/24 |
| F follow-up selection (15; F01 excluido) | 12/15 = 80.0% | 12/15 = 80.0% | 12/15 = 80.0% |
| R replacement, seleccion durable == esperada exacta (12) | 9/12 = 75.0% | 10/12 = 83.3% | 11/12 = 91.7% |
| speechActGap (I - D, pp) | 47.2 | 29.2 | 20.8 |
| wrongQuantity / wrongProduct (sobre selecciones completadas) | 0/58 / 0/58 | 0/90 / 0/90 | 0/84 / 0/84 |
| selectionCorruption | 0/138 | 0/138 | 0/138 |
| argumentos invalidos / duplicados | 0/347 llamadas / 0 | 0/393 / 0 | 0/405 / 0 |
| Gateway rejection (por llamada de tool) | 4.9% | 6.1% | 10.1% |
| Latencia por llamada p50 / p90 / p95 (ms) | 1239 / 1515 / 1612 | 1233 / 1515 / 1618 | 1231 / 1533 / 1647 |
| Tokens de entrada / salida por turno (media) | 13486 / 178 | 14983 / 194 | 15246 / 198 |
| Llamadas al provider por turno | 3.13 | 3.42 | 3.46 |
| Provider: respuestas invalidas | 0/489 | 0/534 | 0/540 |

Speech-act gap: S0->S1 -18.1 pp, S1->S2 -8.3 pp, S0->S2 -26.4 pp (baja por la subida de D y por la variacion de I; no es un resultado preregistrado por si mismo).

Tokens: el aumento de tokens de entrada por turno (+1497 en S0->S1, +263 en S1->S2) se debe sobre todo a que el modelo ejecuta mas llamadas por turno (mas rondas de provider), no al texto del contrato (chars de contrato: 15005 / 15349 / 15374). La latencia por llamada no cambia.

Residual declarativo (D, un balde por turno no exitoso): S0 `UNNECESSARY_CONFIRMATION` 25, `QUANTITY_REQUESTION` 3, `PRODUCT_REQUESTION` 1; S1 7 / 5 / 0; S2 8 / 3 / 4; `INFORMATIONAL_CLOSE` y `OTHER` 0 en los tres.

## 19. Sensibilidad D03/D05 (regla congelada; descriptiva, fuera de la senal)

Excluyendo los dos escenarios con "Pro" a secas (10 escenarios, 30 turnos por brazo): seleccion S0 7/30 = 23.3%, S1 24/30 = 80.0%, S2 21/30 = 70.0%; confirmacion innecesaria 66.7%, 10.0%, 13.3%. Pasos: S0->S1 confirmacion -56.7 / seleccion +56.7 pp; S1->S2 -3.3 / -10.0 pp; S0->S2 -53.3 / +46.7 pp. La conclusion no cambia (mismo patron: S1 ya obtiene el efecto, S2 no agrega). D03 y D05 quedan en 0/3 en S1 y S2 (D05: pide confirmar "2 unidades" en los tres brazos); siguen siendo un residuo de la ambiguedad "Pro"/stub, no se atribuyen a la semantica.

## 20. Regla congelada de F01

Las 3 corridas de F01 en los 3 brazos (9 en total) quedaron `notActionableAfterContext` con motivo `context_reply_named_both_products`: la respuesta del turno 1 (recomendacion para un gimnasio en casa) nombro Classic y Pro. Segun la regla congelada salen del denominador ACTIONABLE (F: 15 turnos por brazo) y se reportan en `dataQuality` (`notActionableAfterContext` = 3 por brazo); no se reintentan ni se reemplazan. `contextContaminatedRuns` = 0 (ningun turno de contexto muto estado).

## 21. Comparaciones por paso (D; deltas favorables positivos)

| Paso | confirmacion innecesaria | seleccion | seleccion durable | Seguridad | McNemar exacto pareado (exploratorio; seleccion / confirmacion) |
|---|---|---|---|---|---|
| S0 -> S1 | -50.0 pp | +47.2 pp | +47.2 pp | OK (Gateway +1.2 pp; resto 0) | p = 1.5e-5 (17 vs 0) / p = 4.0e-5 (19 vs 1) |
| S1 -> S2 | +2.8 pp (empeora) | -8.3 pp | -8.3 pp | NO (Gateway +5.2 pp) | p = 0.45 / p = 1.0 |
| S0 -> S2 | -47.2 pp | +38.9 pp | +38.9 pp | NO (Gateway +5.2 pp) | p = 1.3e-3 / p = 7.6e-5 |

`reversibleSemanticsSupported = false`: S0->S2 alcanza el margen de soporte (>= 20 pp en ambos primarios) pero el brazo S2 viola la regla de seguridad "gatewayRejection <= S0 + 5 pp" (+5.22 pp). Es la etiqueta paraguas secundaria; la etiqueta de la senal es la regla 1 (`CONSEQUENCE_STATEMENT_SUFFICIENT`), que gana por orden de precedencia.

## 22. Inspeccion posterior de failures/traces (exploratoria, DESPUES de fijar la senal)

- **Gateway rejection, composicion (por llamada):** S0 = 14 `create_quote` (`quote_service_not_configured`) + 3 `search_products_by_semantics` (`registry_mismatch`); S1 = 21 + 3; S2 = 21 + 15 + 5 `explore_catalog` (`invalid_response`). El exceso de S2 (+5.2 pp) viene de `search_products_by_semantics` (15 vs 3), de 5 `invalid_response` de `explore_catalog` (0 en S0/S1) y de mas intentos de `create_quote` (Quote Service BLOCKED localmente); ninguno es `select_products`. Aparte hay bloqueos `select_products` `source_product_not_observed` (evidence gate del Gateway, no cuentan en la tasa anterior): S0 6, S1 9, S2 8; la unica `GATEWAY_REJECTION` por turno (R03 de S2) es de ese tipo. Sin corrupcion de estado.
- **Residuo declarativo por escenario (turnos D sin seleccion):** S1 = D05 x3, D09 x3, D03 x3, D08 x2, D12 x1; S2 = D05 x3, D09 x3, D03 x3, D02 x2, D08 x1, D10 x1, D11 x1, D04 x1. S0 fallaba ademas en D01, D02, D04, D07, D08, D10, D11 y D12. D09 ("Me gustaria llevar una barra Classic") pide cantidad en S1 y S2: el modelo lee "una" como articulo.
- **Follow-up:** neto plano (12/15 en los tres brazos) con movimiento por escenario: F06 0/3 -> 3/3 -> 2/3 y F03 3/3 -> 0/3 -> 1/3. En F03 ("Dos unidades" tras "Quiero la Classic") S1 responde reconociendo las dos unidades y pidiendo la comuna, sin guardar la seleccion. Se registra, no se corrige.
- **Imperativo/quote:** IM06 ("Sumame una barra Classic") 0/3 -> 3/3 -> 0/3 (pide cantidad ante "una"); Q06 ("cotizame una barra Pro") 0/3 en los tres brazos.
- S2 es mas ruidoso que S1 (I 79% vs 96%; D02 1/3 vs 3/3); con temperature 0 no determinista y n pequeno esas diferencias no se distinguen de ruido (McNemar S1->S2 p = 0.45).

## 23. Taxonomia residual de fallos (turnos ACTIONABLE sin `SELECTION_SUCCESS`, todos los actos de habla, 111 por brazo)

S0 = 36 `UNNECESSARY_CONFIRMATION` + 17 `MISSING_FACT` (16 pedidos de cantidad, 1 de producto) (= 53); S1 = 8 + 13 (= 21); S2 = 8 + 18 + 1 `GATEWAY_REJECTION` (= 27). Aparte, 3 turnos `OTHER` por brazo son F01 (no ACTIONABLE, fuera de los 111). `WRONG_PRODUCT`, `WRONG_QUANTITY`, `OVER_MUTATION`, `SELECTION_CORRUPTION`, `INFORMATIONAL_CLOSE`, `PROVIDER_FAILURE` y `HARNESS_FAILURE` = 0 en los tres brazos. Lectura: la semantica reversible sustituye casi toda la confirmacion redundante por ejecucion, pero deja (a) pedido de cantidad ante "una/un" leido como articulo, (b) la ambiguedad "Pro" y (c) el patron "pedir comuna antes de guardar". Los pedidos de cantidad no bajan de forma sistematica (17 -> 13 -> 18 `MISSING_FACT`): es otro fenomeno que la semantica del contrato no toca.

## 24. Interpretacion causal

Senal: `CONSEQUENCE_STATEMENT_SUFFICIENT`. H-sem se apoya en este banco: reemplazar la primera oracion de `select_products` por una declaracion de consecuencia (estado provisional y reversible, sin orden/pago/checkout/reserva) mas la instruccion de no pedir confirmacion adicional solo para guardarlo baja la confirmacion innecesaria en enunciados declarativos de 69.4% a 19.4% y sube la seleccion de 19.4% a 66.7%, sin sobre-mutacion informativa (0/24), sin producto/cantidad erroneos y sin corrupcion. Quitar ademas el framing distribuido de `useWhen`/`doNotUseWhen` (S2) no agrega mejora (-8.3 pp seleccion, +2.8 pp confirmacion): la contradiccion distribuida no es una causa adicional material en este banco. El efecto de S1 no se limita a D: tambien sube I (+29 pp) y Q (+29 pp), o sea que el modelo trataba `select_products` como una mutacion de mayor consecuencia en varios actos de habla, con D como el mas afectado.

## 25. Limitaciones

1. S1 y S2 agrupan dos cambios: informar la consecuencia real y una instruccion explicita "no pidas confirmacion adicional solo para guardar esta seleccion provisional" (declarado en 3b). P7.10 no los separa.
2. Un solo modelo (DeepSeek `deepseek-v4-flash`), temperature 0 no determinista, harness sintetico con fixture de dos productos, 12 declarativos x 3 corridas (36 turnos D por brazo; los escenarios no son independientes entre si: D03/D05/D09 no se mueven en ningun brazo y D06 acierta 3/3 en los tres). Los IC de Wilson son amplios (S1 D: 50-80%).
3. Clasificador de confirmacion por reglas textuales (golden de 70 frases etiquetadas a mano, con frases de P7.9 documentadas, no verbatim); sin juez LLM.
4. Quote Service esta BLOCKED localmente: los rechazos de `create_quote` no son evidencia, y la metrica de Gateway rejection mezcla esos rechazos, un `registry_mismatch` de `search_products_by_semantics` y 5 `invalid_response` de `explore_catalog`. Por eso `reversibleSemanticsSupported = false` no es evidencia de que S2 sea insegura respecto de `select_products`. Se conserva el resultado preregistrado; no se recalcula.
5. "una barra Classic" se preregistro como cantidad explicita (1); el modelo a menudo lo trata como articulo (D09, IM06, Q06). No se corrigio el corpus (freeze).
6. F01 no pudo actuar como control de follow-up con contexto de recomendacion (el modelo nombra ambos productos): F queda con 5 escenarios por brazo.
7. La seccion 22 (composicion de Gateway rejection, residuo por escenario) es exploratoria y posterior a la senal; no participa de ella.
8. No mide R3, el sistema completo, otros modelos ni la semantica de `quantity`. No hay evidencia de produccion: S1/S2 son variantes de benchmark, no un cambio de contrato de produccion.

## 26. Recomendacion para la siguiente fase (no iniciada)

Con `CONSEQUENCE_STATEMENT_SUFFICIENT`, no seguir reescribiendo `useWhen`/`doNotUseWhen` (S2 no agrega). Siguiente fase por evidencia: (1) separar "informar la consecuencia" de "instruccion explicita de no confirmar" (variante consecuencia-sin-instruccion) y replicar S0 vs S1 con otro corpus/semilla y al menos un segundo modelo, antes de proponer un cambio de contrato de produccion; (2) decidir con negocio la lectura de "una/un" como cantidad 1 y el orden "pedir comuna vs guardar seleccion" (F03); (3) recien despues evaluar, en una release explicita, si el texto S1 pasa a la superficie real de `select_products` (no forma parte de P7.10). No P8, no MCP y sin tocar la semantica de `quantity`.

## 27. Validacion

| Validacion | Resultado |
|---|---|
| tests P7.10 (`r3MutationSemantics`, incluye DB-backed y golden 70/70) | 69/69 |
| tests P7.9 (`r3CapabilityIsolation`) | 29/29 |
| tests P7.8-R (`r3TrueAB`) | 37/37 |
| tests Gateway (`capabilityGateway*`, `customerIdentityCapabilityGateway`, `identityCapabilityGatewaySummaries`) y `selectProductsCapability`, ejecutados tal cual | Gateway 47/61, selectProducts 6/10. Los 14 + 4 fallos son `Table 'main_management.crm_capability_executions' doesn't exist`: esos archivos fijan `DB_NAME=main_management` via `Object.assign(process.env, ...)` y en este entorno local solo `crm_test` esta migrado (`main_management` existe vacia en el contenedor local). No se migro otra base (condicion: solo `crm_test`). |
| mismos tests via copias temporales con `main_management` -> `crm_test` (copias borradas) | **71/71** (61 + 10). Ningun archivo de test tracked se modifico. |
| `npm run typecheck` | limpio (exit 0) |
| `npm run build` | OK (exit 0) |
| eslint focalizado (`r3MutationSemantics`, scripts P7.10, tests P7.10) | limpio |
| `git diff --check` | limpio (solo cubre cambios tracked; no hay ninguno) |
| `git status --short` | solo las 5 rutas nuevas de P7.10; `ACTIVE_RELEASE.md` y `CAPABILITY_MATRIX.md` sin cambios |

## 28. Estado de la fase y confirmaciones

**P7.10 CLOSED - `CONSEQUENCE_STATEMENT_SUFFICIENT`** (senal preregistrada; `reversibleSemanticsSupported = false`). Sin cambios a R3; sin cambios a MS; sin cambios de schema; `quantity` sin cambios (required, integer, minimum 1 en los tres brazos); sin bypass del Gateway (todas las corridas via `runTrueHarnessCase` -> `executeGovernedCapability`); sin P8; sin MCP; sin tuning post-freeze (corpus, clasificador, analizador, umbrales, prompts, superficies y freeze intactos; sin reintentos selectivos); sin commit; sin push.
