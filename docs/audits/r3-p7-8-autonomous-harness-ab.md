# P7.8 - Autonomous Harness A/B (hybrid R3 vs minimal autonomous DeepSeek harness)

Experimento de fase. No P8, no MCP, no cambio de Gateway/CommercialWork/DB/capabilities/tool schemas, no cambio del prompt hibrido A, sin commit y sin push. Repo `CRM-Customer-360`, rama `develop`, HEAD `0eb36c0dd810454e279e93e37331c3b87810f234` (+ cambios sin commitear descritos en la seccion 10).

Estado: **P7.8 CLOSED - architecture signal `NO_CLEAR_WINNER`.** B (autonomo) no mejora `commitAfterGroundingRate` respecto a A (hibrido): 3/21 = 14.3% vs 3/20 = 15.0%. B tampoco degrada seguridad ni precision, y usa 62% menos caracteres de system prompt y 58% menos tokens de entrada por turno. Ver seccion 9.

> **Erratum (P7.8-R, `docs/audits/r3-p7-8r-true-harness-capability-tax.md`).** (1) P7.8 comparo A contra un B que seguia usando el MISMO loop R3 (`runAgentToolLoop`, protocolo AgentStep, guardas, contrato de tools); `NO_CLEAR_WINNER` describe "prompt minimo sobre el loop R3", no una comparacion R3 vs DeepSeek autonomo puro. (2) La frase de la seccion 9 sobre que los turnos grounded sin cantidad "piden la cantidad legitimamente" se apoyaba en un detector de regex defectuoso (marcaba "Quedan 15 unidades disponibles. ¿Quieres que te envie el link?" como pedido de cantidad); con un detector estricto la mayoria de esos turnos NO piden la cantidad, sino que presentan el producto u ofrecen el link/agregarlo. Las metricas de commit, sobre-mutacion, Gateway y latencia de este documento no dependen de ese detector y no cambian.

Documentos base: `docs/R3_COMMERCIAL_AGENT_HANDOFF.md` (23.6, 23.7), `docs/audits/r3-p7-6-runtime-config-parity-audit.md`, `docs/audits/r3-p7-7-grounding-to-commit-behavior-fix.md`.

## 0. Baseline verificado antes de editar

```text
git branch --show-current -> develop
git rev-parse HEAD        -> 0eb36c0dd810454e279e93e37331c3b87810f234 (test(r3): close grounding-to-commit prompt fix experiment (P7.7, RED))
git status --short        -> solo scripts/diagnostics/ untracked (preexistente, ajeno)
```

P7.7 marcado `CLOSED - RED` en handoff 23.7; sin cambios experimentales pendientes.

## 1. Arquitecturas

### A - Hybrid (estado actual, P7.7, sin modificar)

`CommercialWork -> DRM -> eligibility P6.3 (vista al modelo) -> prompt-policy hibrido -> Agent Tool Loop -> Gateway -> P4 CommercialProposal -> P5 reconciliation -> estado durable -> outbox`. System prompt: 47,346 caracteres, 150 lineas de politica (medido), mas el catalogo de tools.

### B - Autonomous (nuevo, solo benchmark)

`CommercialWork + estado durable -> prompt autonomo minimo -> tool -> ToolObservation -> ... -> respond -> Gateway existente -> estado durable existente -> outbox`. System prompt: 18,035 caracteres, 14 lineas de politica (medido); el resto es el mismo catalogo de tools que A.

Texto congelado (`autonomousPrompt.ts`, version `p7.8-autonomous-v1`): rol + contrato JSON (`use_tool | respond | handoff`) + la politica general pedida ("si el cliente pide una accion comercial, continua con las tools disponibles hasta que el resultado se complete, este genuinamente bloqueado o requiera informacion que solo el cliente puede dar; no te detengas en grounding informativo cuando queda una accion ejecutable pendiente") + "si solo pide informacion, responde sin cambiar estado" + "pregunta solo lo que no puedas obtener de tools/conversacion" + invariantes de grounding (fuentes de verdad, URL solo si aparece en una observacion, no afirmar acciones sin observacion) + identidad. Sin workflow rigido, sin regla de cierre, sin reglas de `select_products`, sin contrato P4, sin vista P6.3.

## 2. Diferencia arquitectonica exacta

Unica diferencia entre A y B en una corrida:

| Elemento | A | B |
|---|---|---|
| `promptBuilder` del loop | `buildAgentStepPromptPackage` (hibrido) | `buildAutonomousStepPromptPackage` |
| `capabilityEligibilityInputEnabled` (vista P6.3 al modelo) | true | **false** (`eligibilityInfluencedCognition=false`) |
| `commercialProposalShadowEnabled` (P4 pedido al modelo) | true | **false** |
| `commercialObjectiveReconciliationEnabled` (P5) | true | **false** (inerte sin proposal) |

Verificado por `manifest.flagDifferencesBetweenVariants` y por test. P6 sigue calculandose como shadow (`capabilityEligibilityShadowEnabled=true` en ambos) pero nunca llega a la cognicion de B. En B, `eligibilityAtTurnStart` de P7.2 queda `null` (la evaluacion pre-cognicion solo corre con la vista encendida en produccion; no se toco produccion para cambiarlo).

## 3. Infraestructura compartida (identica)

Mismo `runSalesAgentRuntimeCycle -> runSalesAgentRuntime -> runAgentToolLoop` (checkpoint open-turn, evidence gate, guard de duplicados, guard de claims de mutacion sin evidencia), mismo Capability Gateway (registry, identity gate, availability, execucion) y mismas implementaciones/schemas de tools (`buildToolDescriptions` + `renderToolLine`, catalogo byte-identico: `toolCatalogChars` igual), kernel P3.5, estado durable en MariaDB `crm_test`, outbox, stubs de Catalog/Carrier, fixture de identidad, sesion persistente, modelo de mensajes harness-aligned, provider y presupuestos. Ninguna tool es exclusiva de una variante.

Seam de produccion (aditivo, ausente en todo llamador productivo): `RunAgentToolLoopInput.promptBuilder?` reenviado por `salesAgentRuntime.ts` y `runSalesAgentRuntimeCycle.ts`. Ausente => `buildAgentStepPromptPackage`, byte-identico (test). No se creo un segundo Gateway; B nunca llama servicios ni DB.

## 4. Configuracion (identica en ambas variantes; `manifest.sharedConfig`)

`deepseek-v4-flash`, temperature 0, thinking `disabled`, timeout 60000 ms, `maxOutputTokens` 4000, `maxModelRetries` 5, open-turn + harness-aligned + compaction habilitados, catalogo query-aware (P7.7), `crm_test`. `manifest.benchmarkOverrides` registra todos los `BENCHMARK_E2E_*` en efecto. Por run se guarda `runConfig` (variante, modelo, temperature, thinking, timeout, retries, tokens, budgets, `promptVersion`, `promptSha256`, flags efectivos).

No reproducible en el harness (igual para A y B, marcado en el manifest): live assimilation (flag pasado pero inerte; no se inventaron ids numericos), canal EC2 (webhook/settle/delivery/outbox worker). Quote Service BLOCKED localmente en ambos (no evidencia sobre ninguna variante).

## 5. Corpus y corridas

Primario (P7.7, por referencia sin modificar): E02, E04, E05, E07, E14, E15 x3. Controles negativos nuevos: N01 "¿Cuanto cuesta la barra Classic?", N02 "¿Que diferencia hay entre la Classic y la Pro?", N03 "¿Tienen stock de la Classic?", N04 "¿Cual me recomiendas?" x3. Total 10 casos x 3 x 2 variantes = **60 runs**, 60/60 ejecutadas, 0 harness failures.

Orden: plan determinista e intercalado (A y B del mismo par corren seguidos; el primero alterna por indice de par). Sin aleatoriedad.

Cohorte primaria (anotacion fija por turno, `abCorpus.ts`): 9 turnos con intencion de compra explicita x3 = 27 turnos por variante. Cantidad declarada: E04 t0 (1), E04 t1 (2), E15 t0 (2); no declarada: el resto.

## 6. Resultados

`benchmark-results/ab-2026-09-21T16-42-46-588Z-live/` (`manifest/runs/summary/failures/comparison`; sin PII, sin prompts crudos).

### Metrica primaria y durable (definicion identica a P7.7)

| Metrica | A hybrid | B autonomous |
|---|---|---|
| Turnos con intencion explicita | 27 | 27 |
| Turnos grounded (`get_product_details` completado) | 20 | 21 |
| **commitAfterGroundingRate** (`select_products` pedido despues, mismo turno) | **3/20 = 15.0%** | **3/21 = 14.3%** |
| **durableCommitAfterGroundingRate** (completado + seleccion durable) | 3/20 = 15.0% | 3/21 = 14.3% |
| Sensibilidad sin E05 t1 (limitacion del stub) | 3/19 = 15.8% | 3/18 = 16.7% |
| Cohorte fija (todos los 27): `select_products` completado | 4/27 = 14.8% | 5/27 = 18.5% |
| Cantidad declarada, grounded | 3/7 = 42.9% | 3/6 = 50.0% |
| Cantidad NO declarada, grounded | 0/13 | 0/15 |

Denominador: el subconjunto grounded depende del comportamiento (por eso se reporta tambien la cohorte fija, que no depende de la variante). Los intentos coinciden con los completados: cero rechazos de Gateway.

Desglose por turno (grounded / commit tras grounding, 3 runs): E02, E05 t0, E07, E14 t0: 0 commit en A y B; E04 t0 ("una barra"): 0 en ambos; E15 (todo en un mensaje): 3/3 en ambos; E04 t1 ("mejor dos unidades"): A 1/3, B 2/3 (B compromete directo sin regrounding; n pequeno); E14 t1 y E05 t1: sin commit en ambos (piden cantidad/comuna o aclaran "la Pro").

### Controles negativos

`overMutationRate` A 0/12, B 0/12 (ninguna llamada a `select_products`, `set_shipping_destination` o `create_quote`; `overMutationDurable` 0/12 en ambos). B no sobre-muta.

### Tools / Gateway / calidad

| Metrica | A | B |
|---|---|---|
| validArgumentsRate | 1.0 | 1.0 |
| gatewayCompletionRate / RejectionRate | 1.0 / 0 | 1.0 / 0 |
| duplicateToolCallRate | 0 | 0 |
| wrongQuantityRate | 0 | 0 |
| selectionCorruptionRate | 0 | 0 |
| unnecessaryConfirmation (cantidad declarada, sin commit, cierra con pregunta) | 5/9 | 4/9 |
| commercialOutcomeCompletion (expectativas durables, sin objetivo P4/P5) | 4/18 | 5/18 |
| ungroundedMutationClaimRate | 0 | 0 |
| avg tool calls por turno | 1.50 | 1.62 |
| avg provider calls por turno | 2.60 | 2.67 |
| provider calls con JSON invalido | 0/109 | 2/112 (1.8%) |
| turnos terminados por JSON invalido | 0 | 0 |
| terminalReason (42 turnos) | responded 42 | responded 42 |

Los 2 JSON invalidos de B (E04, E05) se recuperaron con la recuperacion estructurada de un intento del loop. En el smoke aparecio un caso donde no se recupero. Diagnostico (scratchpad, fuera del repo): el modelo omite a veces la llave de cierre `}`; es fiabilidad de salida del modelo, no un bug del harness, por eso no se corrigio B.

### Latencia y tokens

| | A | B |
|---|---|---|
| Latencia por llamada p50 / p90 / p95 | 1386 / 2056 / 2145 ms | 1221 / 1550 / 1671 ms |
| Proveedor por turno p50 / p95 | 4081 / 8429 ms | 3609 / 6919 ms |
| Tokens de entrada por turno (media) | 25,518 | 10,683 (-58%) |
| Tokens de salida por turno (media) | 223 | 129 |
| Reasoning tokens | 0 | 0 |

### Distribucion de categorias (turnos clasificados, 39 por variante)

| Categoria | A | B |
|---|---|---|
| COMMIT_SUCCESS | 4 | 5 |
| NO_COMMIT_AFTER_GROUNDING | 13 | 15 |
| UNNECESSARY_CONFIRMATION | 5 | 4 |
| OTHER (sin grounding ni commit; E14 t1 / E05 t1 piden un dato) | 5 | 3 |
| INFORMATIONAL_OK | 12 | 12 |
| OVER_MUTATION, WRONG_QUANTITY, SELECTION_CORRUPTION, TIMEOUT, DEPENDENCY, GATEWAY_REJECTION, HARNESS_FAILURE, AUTONOMOUS_LOOP_FAILURE | 0 | 0 |

## 7. Complejidad (no es un score)

| | A | B |
|---|---|---|
| Lineas de politica del system prompt (medidas) | 150 | 14 |
| Caracteres del system prompt / tokens aprox. (chars/4) | 47,346 / ~11.8k | 18,035 / ~4.5k |
| Codigo cognitivo especifico | `buildAgentStepPromptPackage.ts` (~950 lineas no vacias, ~14 bloques de reglas) | `autonomousPrompt.ts` 70 + `variants.ts` 47 lineas de codigo |
| Componentes cognitivos en el camino critico | DRM->vista P6.3, contrato P4, reconciliacion P5, politica hibrida, sesion, harness-aligned, checkpoint open-turn | prompt minimo, sesion, harness-aligned, checkpoint open-turn (compartidos) |
| Componentes runtime adicionales | - | seam opcional `promptBuilder` (18 lineas netas en 4 archivos de produccion, ausente en produccion) |

Respuesta a "estamos comprando robustez con la complejidad hibrida?": en esta metrica y con este corpus, no se midio robustez adicional atribuible a la complejidad hibrida (ni en commit, ni en over-mutation, ni en calidad de argumentos, ni en Gateway), y B cuesta menos en tokens y latencia. Tampoco se demostro que B sea mejor.

## 8. Reglas de senal (fijadas antes de medir; `P78_SIGNAL_THRESHOLDS`)

`AUTONOMOUS_FAVORED` exige, a la vez: delta >= +0.20 en commit primario y durable, delta >= +0.10 en la cohorte fija, over-mutation <= 0.10 (y <= A + 0.10), valid arguments no degradado (>= A - 0.05), rechazos de Gateway <= A + 0.05, sin corrupcion durable por encima de A, JSON invalido <= A + 0.05 (agregado tras el smoke y antes del batch), wrong quantity no mayor, latencia p95 <= 2x A y denominadores >= 5. `HYBRID_FAVORED`: violacion de seguridad (sobre-mutacion, corrupcion, mas rechazos) o commit materialmente peor. Otro caso: `NO_CLEAR_WINNER`.

Evaluacion: `commitImproved=false` (delta primario -0.7 pp, durable -0.7 pp, cohorte fija +3.7 pp; margenes 20/20/10 pp), todos los criterios de seguridad cumplidos, denominadores suficientes.

## 9. Architecture signal: `NO_CLEAR_WINNER`

- No es `AUTONOMOUS_FAVORED`: B no supera a A en commit tras grounding ni en commit durable; las diferencias (1 turno en 27) estan muy dentro del ruido de n=3 por celda.
- No es `HYBRID_FAVORED`: B no sobre-muta, no corrompe estado, no aumenta rechazos, no baja la calidad de argumentos.
- Lectura causal: quitar toda la politica hibrida (150 -> 14 lineas, P4/P5/P6.3 fuera del camino critico) deja el patron dominante intacto. El modelo, en ambas arquitecturas, trata "quiero X" sin cantidad/confirmacion como informacion y cierra con una pregunta u oferta; cuando el mensaje trae todo (E15) compromete 3/3 en ambas. Esto es coherente con que la causa no sea la politica hibrida sino algo compartido: el modelo `deepseek-v4-flash` y/o el contrato de tools compartido (`select_products` exige `quantity` y su `useWhen` habla de "products and quantities established"; ambos ven el mismo texto). Con `quantity` obligatorio y sin default, ningun turno sin cantidad declarada commitea (0/13 en A, 0/15 en B) - ver el erratum arriba sobre por que la afirmacion original de que "piden la cantidad" no es fiable.
- Esto no valida ni invalida P4/P5/P6 como infraestructura de observabilidad/estado; solo dice que, para esta metrica, no aportan ventaja medible sobre un harness minimo.

## 10. Archivos cambiados / anadidos (sin commit)

Produccion (seam aditivo, 18 lineas): `runAgentToolLoop.ts` (input opcional + 2 call sites), `salesAgentRuntime.ts`, `runSalesAgentRuntimeCycle.ts`, `buildAgentStepPromptPackage.ts` (solo `export` de `renderToolLine`; el prompt A no se modifico).
Instrumento P7.4 (aditivo): `r3CommercialE2E/types.ts` y `durableStateSnapshot.ts` (`selection.items` opcional), `runCommercialE2ECase.ts` (`promptBuilder` opcional).
Nuevos: `lib/brain/commercial/agent-loop/benchmark/r3AutonomousAB/` (`autonomousPrompt.ts`, `variants.ts`, `abCorpus.ts`, `analysis.ts`, `runAutonomousAB.ts`), `scripts/r3-autonomous-ab-benchmark.ts`, `tests/agent-loop/benchmark/r3AutonomousAB/` (3 archivos, 41 tests).
No tocados: Gateway, CommercialWork, schema DB, capabilities, tool schemas, P8, MCP, Quote Service, config EC2, prompt hibrido A. Hashes de los archivos congelados (autonomousPrompt, variants, analysis, abCorpus, buildAgentStepPromptPackage) identicos antes y despues del batch.

## 11. Smoke y decisiones post-smoke

Smoke E02/N01 x A/B: traza completa, config compartida identica, B ejecuta via Gateway, artifacts correctos. Cambios permitidos tras el smoke (todos de instrumento, ninguno del prompt A ni de B): (1) el patron de DEPENDENCY confundia `opportunity_unavailable` (rechazo de dominio) con dependencia externa: acotado a servicios externos; (2) un turno terminado por JSON invalido se clasificaba `DEPENDENCY`: ahora es `AUTONOMOUS_LOOP_FAILURE` (solo B) u `OTHER`; (3) se agrego la metrica de JSON invalido y su criterio. B no se modifico despues de ver resultados.

## 12. Validaciones

```text
tests P7.8 (3 archivos)                         -> 41/41 PASS
regresion dirigida (benchmark E2E + stable, P7.7 prompt, P7.1-P7.6, P6, P5, P4 alcanzable) -> 443/447 PASS
  4 fallas (P7.2-F, [P4-C1], [P4-C2], [P5-C1]): verificadas identicas en HEAD limpio sin mis cambios (alli fallan 5, incluido P7.2-H); persistencia de eventos en DB local, preexistentes, no causadas por P7.8
npm run typecheck                                -> PASS
npm run build                                    -> PASS
lint focalizado (archivos tocados)               -> 0 errores, 0 warnings
git diff --check                                 -> limpio
```

No se uso la base de produccion (`NODE_ENV=test` + `DATABASE_NAME=crm_test`, gate de `setupR3BenchmarkEnvironment`). No se ejecuto la suite completa del repo.

## 13. Limitaciones

n=3 por celda y 27 turnos por variante (IC 95% amplios: p.ej. 3/20 ~ 5%-36%); corpus sintetico "quiero X" (P7.6 vio en produccion `select_products` tras el grounding en 4 de 5 conversaciones; esa muestra no invalida este A/B pero un ganador sintetico no bastaria para adoptar); un solo modelo; Catalog/Carrier/identidad son stubs; E05 t1 limitado por el stub del catalogo (reportado con sensibilidad, no usado como argumento); clasificacion de "pregunta innecesaria" y "pide cantidad" por heuristica de texto (regex, no juez LLM); Quote Service BLOCKED (E14 t1 no mide cotizacion); live assimilation y canal EC2 no ejercitados en ambas; la validez de "solo cambia la capa cognitiva" depende de que P4/P5/P6.3 se consideren parte de esa capa (lo son en la definicion de A).

## 14. Siguiente fase recomendada por evidencia

No adoptar B ni retirar P4/P5/P6. No P8. El patron es comun a ambas arquitecturas, asi que la palanca esta en lo compartido: (1) construir un corpus derivado de trafico real de EC2 (donde el modelo si comprometio tras el grounding) para ver si el problema es del corpus sintetico; (2) probar el contrato compartido de `select_products`/cantidad (metadata de tool, semantica "quantity required") separado de la politica de prompt; (3) opcionalmente, mismo A/B con otro modelo para separar limitacion del modelo de limitacion del contrato.

## 15. Confirmaciones

Sin bypass del Gateway; sin mutacion directa de DB por B (test estatico + ejecucion via Gateway); sin P8; sin MCP; sin tuning tras observar resultados; sin modificar el prompt hibrido A; sin commit; sin push.
