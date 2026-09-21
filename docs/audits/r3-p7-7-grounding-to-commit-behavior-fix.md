# P7.7 - Grounding-to-Commit Behavior Fix

Experimento de fase. No P8, no MCP, no backend guard, no forced tool call, no cambio de Gateway/P4/P5/P6 steering. Repo `CRM-Customer-360`, rama `develop`, HEAD `4851c498b4cc9e7768534331170e3c5d12e8fd35`. Sin commit, sin push.

Estado: **P7.7 CLOSED - RED sobre la metrica primaria, con efecto lateral positivo real en turnos de seguimiento.** Ver seccion 10 para la lectura completa del architecture signal.

Documentos base: `docs/R3_COMMERCIAL_AGENT_HANDOFF.md` seccion 23.6 y `docs/audits/r3-p7-6-runtime-config-parity-audit.md` (baseline P7.6-B: `commitAfterGroundingRate` = 2/20 = 10%, causa primaria PROMPT_POLICY/decision del modelo).

## 0. Baseline verificado antes de editar

```text
git branch --show-current  -> develop
git rev-parse HEAD          -> 4851c498b4cc9e7768534331170e3c5d12e8fd35
git status --short          -> solo scripts/diagnostics/ untracked (preexistente, ajeno a esta tarea)
```

P7.6 CLOSED confirmado en la seccion 23.6 del handoff; ningun cambio de prompt aplicado todavia en ese punto.

## 1. Auditoria de la decision que falla (antes de editar)

Archivo unico: `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts`. Respuestas a las 7 preguntas obligatorias:

1. **Que instruccion permite interpretar "quiero X" como informativo pero no persistible.** `COMMERCIAL_CLOSING_RULE_LINES[2]` (la linea de cierre obligatoria) manda cerrar con exactamente `"¿Quieres que te envíe el link para revisarlo?"` cada vez que la respuesta identifica un unico producto concreto y el link no fue ya verificado ese turno. Esa instruccion es mas especifica y mas imperativa ("close with exactly") que `SELECT_PRODUCTS_RULE_LINES[0]` ("use select_products only once confirmed") - el modelo tiene una salida de cierre lista, concreta y obligatoria que nunca menciona ejecutar `select_products`.
2. **Existe una regla explicita que diga cuando `get_product_details` debe ir seguido de `select_products`.** No, antes de este cambio. `get_product_details`'s `doNotUseWhen` solo dice que leer detalles nunca ES una seleccion - correcto, pero no dice que hacer despues.
3. **Existe contradiccion entre grounding y mutation.** Si: `COMMERCIAL_BEHAVIOR_POLICY_RULE_LINES[0]` ("prefer executing the next useful capability over asking permission") compite directamente con la regla de cierre obligatoria del link (una pregunta, no una ejecucion) para el caso exacto de un solo producto identificado.
4. **Existe una regla de cierre que permita `respond` demasiado temprano.** Si, la misma regla de cierre obligatoria del punto 1 - es la salida "segura" por defecto que no requiere que el modelo decida nada sobre inventario de tools.
5. **Tool description de `select_products` suficientemente clara.** Si (confirmado ya en P7.6 seccion 7.1) - `useWhen`/`doNotUseWhen` no son la causa.
6. **El modelo recibe explicitamente que `PRODUCT_SELECTION` requiere durable mutation.** No antes de este cambio - `CommercialProposal` es descriptivo (P4), nunca se conecta de vuelta a "por lo tanto ejecuta select_products ahora".
7. **`Steps remaining` refleja mal la capacidad real.** Bajo la configuracion EC2-equivalente (open-turn) esto ya no es el driver: P7.6-B midio 18-19 tool executions libres y 55-56s de 60s restantes en el momento de la decision fallida. No se toco.

Conclusion: causa primaria confirmada = **contradiccion entre la regla de cierre obligatoria del link y la politica de progresion comercial**, exactamente como indicaba P7.6 seccion 7.2.

## 2. Auditoria de politica de cantidad (antes de editar)

`SELECT_PRODUCTS_INPUT_SCHEMA` (`selectProductsCapability.ts`) declara `quantity` `required`, sin default. **No existe default contractual de `qty=1`.** La regla preexistente `SELECT_PRODUCTS_RULE_LINES[4]` ("ask the customer to clarify an unclear ... quantity instead of guessing one") ya cubre esto correctamente y no se toco. Consecuencia para el fix: la nueva regla nunca debia inventar un default de cantidad - se limito a decir "si falta la cantidad, pregunta por ella directamente" en vez de "ejecuta con qty=1".

## 3. Fix aplicado (minimo, dos ediciones, un archivo)

Archivos cambiados:

- `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts`
- `tests/agent-loop/buildAgentStepPromptPackage.test.ts` (tests nuevos + 3 longitudes doradas actualizadas)

### A. `SELECT_PRODUCTS_RULE_LINES` - una linea nueva, al final del array

```
"Explicit purchase or selection intent (e.g. wanting, choosing, adding, or asking to change a product or its quantity) is a request to act, not merely an informational one; a get_product_details observation only grounds evidence about that product, it does not fulfill the request - once the product and the required quantity are both sufficiently confirmed, execute select_products in this same turn before writing a response that only presents or offers to link the product, and if quantity is the only missing piece, ask for it directly instead of closing with product information alone."
```

Se agrego al final (no al principio) para que fluya automaticamente a `SELECT_PRODUCTS_FINALIZATION_RULE_LINES` via el `slice(3)` ya existente, sin renumerar indices ni duplicar el comentario que documenta ese slice.

### B. `COMMERCIAL_CLOSING_RULE_LINES[4]` - una clausula nueva en la lista de exclusiones existente

Antes: `"... or your reply is not a commercial product presentation."`
Despues: `"... your reply is not a commercial product presentation; or the customer expressed explicit purchase/selection intent for that product and select_products can still be executed this turn - persist the selection or ask for the missing quantity instead of offering the link."`

Ninguna otra linea de `COMMERCIAL_CLOSING_RULE_LINES` se toco.

### Lo que NO se hizo (verificado)

- Ningun backend guard, interceptor de `respond`, ni auto-ejecucion.
- Ningun cambio a P4/P5/P6 (`CommercialProposal`, reconciliacion, eligibility) ni a su wiring.
- Ninguna secuencia rigida de tools ni regex de deteccion de intencion.
- `Steps remaining`/tool metadata sin tocar (punto 7 de la auditoria no lo requeria).
- Ningun cambio de Gateway, registry ni identity policy.

## 4. Tests de prompt (semantica, no wording exacto salvo donde el repo ya lo exige)

`tests/agent-loop/buildAgentStepPromptPackage.test.ts`: 3 tests nuevos (`[P7.7] ...`) verifican que la nueva regla y la nueva exclusion de cierre aparecen tanto en gathering como en finalization, y que la regla de cierre obligatoria original sigue intacta. 3 longitudes doradas (`GATHERING_SYSTEM_PROMPT_LENGTH_NORMAL_T04`, `FINALIZATION_SYSTEM_PROMPT_LENGTH_NORMAL_T04`, y el test `[LLM-R1-T03 Caso 5/8]`) se actualizaron +803 caracteres cada una (590 de la linea nueva de `SELECT_PRODUCTS_RULE_LINES` + 213 de la clausula nueva de `COMMERCIAL_CLOSING_RULE_LINES`, ambas presentes en gathering y finalization). Suite completa: **100/100 PASS**.

## 5. Configuracion del experimento focalizado

Identica a P7.6-B R2 (seccion 10.2 del audit P7.6), reproducida con el fix ya aplicado:

| Variable | Valor |
|---|---|
| `NODE_ENV` | `test` |
| `DATABASE_NAME`/`DB_NAME` | `crm_test` (Docker local, usuario `crm_app`) |
| `BENCHMARK_LIVE_LLM_ENABLED` | `true` (DeepSeek real, `deepseek-v4-flash`) |
| `BENCHMARK_E2E_OPEN_TURN_ENABLED` | `true` |
| `BENCHMARK_E2E_HARNESS_ALIGNED_MESSAGE_MODEL_ENABLED` | `true` |
| `BENCHMARK_E2E_LIVE_TURN_ASSIMILATION_ENABLED` | `true` (pasada pero inerte, igual que P7.6) |
| `BENCHMARK_E2E_SESSION_COMPACTION_ENABLED` | `true` (habilitada, no ejercitada - corpus corto) |
| `BENCHMARK_E2E_MODEL_TIMEOUT_MS` | `60000` |
| `BENCHMARK_E2E_MAX_OUTPUT_TOKENS` | `4000` |
| `BENCHMARK_E2E_MAX_MODEL_RETRIES` | `5` |
| `BENCHMARK_E2E_THINKING` | `disabled` |
| `BENCHMARK_E2E_CATALOG_QUERY_AWARE` | `true` (catalogo resuelve el producto nombrado, condicion "R2") |

`environmentHealth`: MariaDB `READY`, providerEndpoint `READY` (modelo `deepseek-v4-flash`), Quote Service `BLOCKED` (igual que P7.6, sin `QUOTE_SERVICE_BASE_URL`/`AUTH_TOKEN` locales - no bloquea E02/E04/E05/E07/E14/E15, que nunca dependen de un `create_quote` exitoso para la metrica medida).

Corpus: E02, E04, E05, E07, E14, E15 (los mismos 6 casos de P7.6-B), 3 runs cada uno = 18 runs, mas un control negativo E01/E06/E08 x3 = 9 runs adicionales.

Runs (artifacts locales, untracked, no comprimidos fuera del repo en esta fase):

- `benchmark-results/2026-09-21T15-54-40-865Z-live/` - corpus principal (18 runs).
- `benchmark-results/2026-09-21T15-59-37-289Z-live/` - controles negativos + shipping (9 runs).

Se verifico, leyendo `providerCalls[].requestMessages` de un run real (E02 run0), que el texto de las dos ediciones de la seccion 3 llega efectivamente al prompt que el modelo recibe (`content.includes("Explicit purchase or selection intent")` y `content.includes("select_products can still be executed this turn")` ambos `true`) - el fix se ejecuto, no quedo inerte por un flag o un branch no alcanzado.

## 6. Metrica primaria: commitAfterGroundingRate

Mismo cohorte de 27 turnos que P7.6-B (E02 t0, E04 t0/t1, E05 t0/t1, E07 t0, E14 t0/t1, E15 t0; 3 runs), mismo criterio (get_product_details completado seguido, en el mismo turno, de un intento de select_products):

| Metrica | P7.6-B (baseline, sin fix) | P7.7 (con fix) |
|---|---|---|
| Turnos grounded (`get_product_details` completado) | 20 | 18 |
| `select_products` intentado en el mismo turno | 2 (ambos E15) | 2 (ambos E15) |
| **commitAfterGroundingRate** | **2/20 = 10%** | **2/18 = 11.1%** |

**Sin mejora material.** La diferencia (10% -> 11.1%) esta dentro del ruido de `n=3` por celda y proviene enteramente de que un turno menos alcanzo grounding, no de un turno adicional que comprometiera. El patron dominante del baseline (grounding -> `respond` con oferta de link, sin intentar `select_products`) **persiste identico** en E02 t0 (3/3), E04 t0 (3/3), E05 t0 (3/3), E07 t0 (3/3) y E14 t0 (3/3) - 15 de 16 turnos t0 no-E15 siguen cerrando con exactamente `"¿Quieres que te envíe el link para revisarlo?"` pese a que el fix esta demostrablemente presente en el prompt que genero esa respuesta (seccion 5).

## 7. Efecto lateral real: turnos de seguimiento (t1)

Aunque la metrica primaria no se movio, el comportamiento en el turno siguiente (cuando el cliente aporta un hecho adicional) si cambio de forma medible y no atribuible al ruido:

- **E04 t1** ("mejor dos unidades", cantidad explicita = 2): P7.6-B midio 0/3 bajo configuracion EC2, cerrando con "quieres que avancemos con la cotizacion?". Con el fix: **1/3 ejecuta `select_products` de inmediato** ("Listo, dejé 2 unidades ... en tu selección"); los otros 2/3 no ejecutan la tool pero preguntan por la comuna de entrega en vez de ofrecer el link - un hecho realmente pendiente, no una salida generica.
- **E14 t1** ("mejor cotizamela"): 3/3 preguntan explicitamente por los dos hechos que de verdad faltan (cantidad y comuna) en vez de ofrecer el link o afirmar una cotizacion inexistente. Ningun `ungroundedQuoteClaim` (confirmado tambien por `summary.json`: `ungroundedMutationClaimRate=0`).
- **E15 t0** (multi-hecho en un solo turno): se mantiene en 2/3 con seleccion+destino+shipping completos en el mismo turno (guardia de la seccion 542 del handoff cumplida, sin regresion). El run restante ya no cierra con el link: pide confirmar cantidad+destino juntos (`UNNECESSARY_CONFIRMATION`, no `NO_COMMIT_AFTER_GROUNDING`).

Lectura: el fix si cambia la decision del modelo cuando el turno mismo aporta la senal que le faltaba (cantidad o destino explicitos en un mensaje de seguimiento), pero no cambia la decision dominante - un unico mensaje "quiero X" sin cantidad ya confirmada en el mismo turno - que es exactamente el patron que representa 15/16 de los turnos medidos y el que P7.7 debia corregir.

## 8. Controles negativos

`E01` ("que barras olimpicas tienen?", pura consulta informativa, `forbidden: {}` sin seleccion esperada), mismo config EC2-equivalente, 3 runs: **0/3 llamo `select_products`**; las 3 respuestas presentan el catalogo sin comprometer nada. `E06`/`E08` (prerequisitos de shipping) tampoco mostraron sobre-mutacion: ambos casos piden el hecho faltante (producto+cantidad, o comuna) en vez de llamar `calculate_shipping` sin destino/seleccion. **Sin sobre-mutacion en ningun run.**

## 9. Controles de cantidad y reemplazo

- **Cantidad explicita en el mensaje inicial** (E04 t0, "una barra" = 1): el fix no logro que el modelo comprometiera en el mismo turno pese a que la cantidad ya estaba dicha - mismo patron que el resto de t0.
- **Cantidad explicita en un turno de seguimiento** (E04 t1, "dos unidades"): mejora real, ver seccion 7.
- **Multi-hecho en un turno** (E15, cantidad+destino juntos): sin regresion, 2/3 preservado.
- **Reemplazo de seleccion** (E05 t1, "en realidad prefiero la pro"): los 3 runs piden aclarar a que producto se refiere "la pro" en vez de ejecutar cualquier tool - resultado no concluyente para la semantica de reemplazo en si: es un artefacto de que el stub de catalogo `CATALOG_QUERY_AWARE` resuelve por coincidencia exacta de nombre y la frase no lo dispara limpiamente (el mismo gap que P7.6 seccion 10.1 ya documento para "la Pro" en E05 t1). No se corrompio estado en ningun run (no hubo seleccion duplicada ni reemplazo silencioso incorrecto).

## 10. Architecture signal: RED en la metrica objetivo

Criterio de la tarea (seccion 12/19/20 del brief): la metrica primaria es `commitAfterGroundingRate` sobre el patron "un mensaje con intencion de compra explicita -> producto grounded -> siguiente decision del modelo", y el criterio de cierre exige "mejora clara y consistente sobre el 10% baseline". El resultado medido es **2/18 = 11.1%, estadisticamente indistinguible del baseline** con `n=3` por celda, y el patron de falla (cierre con oferta de link tras el grounding) se reproduce identico en 15 de 16 turnos t0 no-E15, **con el texto del fix confirmado presente en el prompt real que produjo cada una de esas respuestas**.

No se cumple el criterio de "mejora clara" en la metrica declarada como primaria. Por diseño del experimento (seccion 19 del brief: "Si RED: no seguir agregando reglas"), no se itero con reglas mas especificas ni ejemplos hardcodeados para forzar el numero hacia arriba - eso habria sido exactamente el patron de "logica determinista creciente fuera del modelo" que la tarea pide detectar y reportar, no ocultar con mas texto.

Evidencia que matiza sin invalidar el RED:

- El efecto lateral en turnos de seguimiento (seccion 7) es real, medible y consistente con la hipotesis de diseno (el modelo si reacciona a una senal nueva en el turno cuando esa senal es la unica pieza que faltaba) - pero no es la metrica que P7.7 debia mover, y no alcanza para reclasificar el resultado como YELLOW.
- Cero sobre-mutacion (seccion 8) y cero corrupcion de estado (seccion 9): el fix no introdujo un riesgo nuevo, solo no resolvio el problema declarado.
- El cambio fue deliberadamente minimo (dos ediciones, un archivo, ninguna nueva regla especifica por caso) - el RED no es producto de haber probado insuficientes variantes de texto, es evidencia directa de que la politica textual compite con un patron de decision que el modelo no cede ante una instruccion general adicional, por mas que esa instruccion nombre exactamente el conflicto (grounding vs. cierre informativo) y su exclusion explicita.

## 11. Regresiones

Suite dirigida (P4/P5/P6/P7/P7.6/P7.7, `tests/agent-loop/buildAgentStepPromptPackage.test.ts` + `capabilityEligibility*.test.ts` + `objectiveReconciliation.test.ts` + `runSalesAgentRuntimeCycle.test.ts` + `salesAgentRuntime.test.ts` + `trustedExecutionContext.test.ts` + `capabilityInvocationCoherenceTelemetry.test.ts` + `validateAgentStep.test.ts` + `runAgentToolLoop.test.ts` + `openTurnExecution/Progress.test.ts` + `selectProductsCapability.test.ts` + `shippingDestinationCapability.test.ts` + `benchmarkE2E/*.test.ts` + `runCommercialE2ECorpus.test.ts`): **459/464 PASS**. Las 5 fallas restantes (`[P4-C1]`, `[P4-C2]`, `[P5-C1]`, "the result exposes only structured, bounded fields", `P7.2-H`) se verificaron, mediante `git stash`/rerun, **identicas en HEAD limpio sin el fix** - preexistentes, no causadas por este cambio (persistencia de eventos en DB local, no relacionadas con el texto del prompt). El run live de 18+9 turnos tambien confirma ausencia de regresion funcional: `gatewayCompletionRate=1`, `validArgumentsRate=1`, `duplicateToolCallRate=0`, `ungroundedMutationClaimRate=0`, ningun `invalid_arguments` ni rechazo de Gateway.

## 12. Validaciones

```text
npm run typecheck   -> PASS, sin errores
npm run lint         -> 0 errores, 40 warnings preexistentes (ninguno en los archivos tocados)
npm run build         -> PASS
git diff --check       -> sin problemas de whitespace
tests/agent-loop/buildAgentStepPromptPackage.test.ts -> 100/100 PASS
suite dirigida P4-P7/P7.6/P7.7               -> 459/464 PASS (5 preexistentes, verificadas)
```

No se corrio la suite completa de ~200 archivos DB-backed (fuera del alcance declarado de la seccion 21 del brief, que pide P4/P5/P6/P7/P7.1-P7.3/P7.6 - no "todo el repo"). No se apunto ninguna prueba a `main_management` ni a produccion; `crm_test` se uso via `NODE_ENV=test` en todos los runs con DB real.

## 13. Confirmaciones explicitas

- No backend auto-execution.
- No forced tool call ni synthetic tool call.
- No cambio de Gateway policy.
- No P4/P5 steering change (ninguna linea de `CommercialProposal` ni de `objective-reconciliation` tocada).
- No P8 (ningun snapshot obsoleto reproyectado ni continuacion tras efectos).
- No MCP.
- No commit, no push.

## 14. Siguiente fase recomendada por evidencia

**No seguir agregando reglas de prompt para este patron especifico.** Con la causa exacta identificada, el texto correcto ya insertado en el punto de decision, y confirmado presente en el prompt real, y aun asi sin mover la metrica primaria, agregar una tercera o cuarta instruccion mas especifica reproduciria el patron de "logica determinista creciente fuera del modelo" que la seccion 19 del brief pide evitar y reportar, no ocultar.

Recomendado (por el propio criterio de la tarea, seccion 19): **preparar un A/B contra el harness autonomo de DeepSeek** (fuera del alcance de esta fase) para determinar si el patron de cierre-con-link-en-vez-de-compromiso es una caracteristica entrenada especifica de `deepseek-v4-flash` bajo esta politica de prompt, o si es estructural al enfoque hibrido de prompt-policy en general. Separado de esto, con esta misma evidencia: el trafico productivo real de EC2 (documentado en P7.6 seccion 2.8, `select_products` solicitado tras el grounding en 4 de 5 conversaciones) sigue sin explicarse por el corpus sintetico "primer mensaje = quiero X sin cantidad" que P7.4-P7.7 usan - vale la pena, en una fase separada, construir un corpus a partir de conversaciones reales de EC2 (o una aproximacion textual de ellas) en vez de seguir iterando sobre el mismo corpus sintetico que ya demostro ser resistente a este tipo de cambio.
