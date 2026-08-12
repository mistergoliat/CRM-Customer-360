---
title: LLM-R1-T05 — Reproducible Agent Tool Loop Benchmark Harness
doc_id: release-llm-r1-t05-model-benchmark
status: implemented_offline_only_live_pending
owner: architecture
last_reviewed: 2026-08-12
source_of_truth_for:
  - BenchmarkCase/BenchmarkGroundTruth corpus contract (lib/brain/commercial/agent-loop/benchmark/types.ts)
  - offline vs live AgentLoopProvider selection for the benchmark harness
  - BENCHMARK_LIVE_LLM_ENABLED gate contract
depends_on:
  - ../audits/SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md
  - ../audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md
  - ./LLM-R1-T01-structured-output-recovery.md
  - ./LLM-R1-T02-provider-observability.md
  - ./LLM-R1-T03-prompt-finalization-reduction.md
  - ./LLM-R1-T04-guided-structured-repair.md
tags:
  - release
  - agent-loop
  - llm-provider
  - benchmark
  - observability
---

# LLM-R1-T05 — Reproducible Agent Tool Loop Benchmark Harness

Construye el proceso de medicion reproducible pedido en la seccion 13 del audit original: un corpus fijo de 12 casos con ground truth estructural, un harness aislado (Catalog Service mock local, Carrier MS fake, resolver de comunas real sobre datos fake, DB de test local) que ejecuta el `AgentLoopProvider` real (`runAgentToolLoop`, sin modificar) contra un proveedor scripted por defecto y, opcionalmente y bajo un flag explicito, contra el proveedor LLM real. No se toco modelo, prompts, retries, timeouts, tools, Capability Gateway, logica comercial, shipping, Catalog, Customer Profile ni envio de WhatsApp - esta tarea es puramente instrumentacion de medicion sobre codigo ya existente (`LLM-R1-T01`-`T04`).

## Que se construyo

### Harness aislado (`lib/brain/commercial/agent-loop/benchmark/`)

- **`types.ts`**: `BenchmarkCase`/`BenchmarkGroundTruth`/`BenchmarkOfflineStep`/`BenchmarkCaseScore`/`BenchmarkTurnResult`/`BenchmarkRunSummary` - el contrato de fixture y de resultado.
- **`validateCorpus.ts`**: validacion en runtime de un corpus (`caseId` unico, `offlineScript` no vacio, tools no simultaneamente requeridas/prohibidas, `expectsStructuredFailure` respaldado por al menos un paso `invalid_response`) - un fixture invalido se rechaza antes de correr, nunca produce un resultado silenciosamente enganoso.
- **`environment.ts`**: un Catalog Service HTTP real en `127.0.0.1` (puerto efimero), un Carrier MS fake inyectado directamente (`setCalculateShippingCarrierServiceForTests`), un `CommuneCatalogPort` fake envuelto por el `createCommuneResolver` **real** (para que la ambiguedad de "Santiago" - `knownAmbiguous.ts` - se resuelva exactamente como en produccion, nunca una copia manual de esa logica), y un `opportunityId` sintetico fresco por corrida. `select_products`/`set_shipping_destination` no tienen seam de inyeccion para su propia persistencia - como cualquier otro test existente que los ejercita (`tests/commercial/calculateShippingCapability.test.ts`), usan la misma DB de test local que `npm test` ya requiere, nunca produccion.
- **`offlineProvider.ts`**: interpreta un `BenchmarkOfflineStep[]` fijo en un `AgentLoopProvider` determinista - `use_tool`/`respond`/`handoff` se convierten en el `rawOutput` correspondiente; `invalid_response` lanza una falla clasificada via el mismo `markAgentLoopProviderFailure` que usa produccion (nunca una simulacion paralela); tokens se reportan `null` (no `0`) porque no hubo inferencia real.
- **`instrumentedProvider.ts`**: envuelve cualquier `AgentLoopProvider` (offline o live) y graba un `BenchmarkProviderCallRecord` por invocacion real, clasificando fallos con el mismo `classifyAgentLoopProviderFailure` de `LLM-R1-T01`/`T02` - da granularidad de `errorCode` (`empty_response` vs `invalid_model_json` vs `invalid_json_response`) que el campo `outcome` de T02 no expone por si solo. Nunca altera lo que el proveedor interno devuelve o lanza.
- **`liveProvider.ts`**: `isLiveBenchmarkEnabled`/`resolveLiveBenchmarkProviderConfig` - el gate explicito de la Parte D (ver abajo).
- **`scoring.ts`**: `scoreCase` - compara un `AgentLoopResult` real contra el `BenchmarkGroundTruth` de un caso, leyendo solo `loop.steps`/`loop.terminalReason`/`loop.llmCalls` (nunca comparacion textual del mensaje final).
- **`metrics.ts`**: `computeAggregateMetrics`/`computeMetricsByCase` - correctness, robustez estructural, latencia (p50/p95), tokens, distribucion de `finishReason`. Toda tasa es `null` (nunca `0` inventado) cuando su denominador es cero.
- **`runCorpus.ts`**: `runBenchmarkCase`/`runCorpus` - arma el environment, corre el `setup` del fixture si existe, envuelve el provider (scripted u live) en el instrumentado, llama a `runAgentToolLoop` real, anota, hace teardown en `finally`.

### Corpus (`tests/fixtures/agent-loop-benchmark/corpus.ts`)

12 casos (C01-C12), el minimo pedido por la tarea, cada uno con `groundTruth` explicito y un `offlineScript` fijo:

| Caso | Escenario | Ground truth clave |
|---|---|---|
| C01 | Busqueda simple | `requiredTools: [search_products]` |
| C02 | Seleccion contextual ("las classic") | `select_products` con `productId=31`, `quantity=2` |
| C03 | Shipping con seleccion ya confirmada | `set_shipping_destination`+`calculate_shipping`, communeId=99, `select_products` prohibido |
| C04 | Cambio de cantidad | `select_products` con `productId=31`, `quantity=3` |
| C05 | Cambio de comuna | `set_shipping_destination` communeId=100, `select_products` prohibido |
| C06 | Destino ambiguo ("Santiago") | `expectedDestinationCommuneId: null` (nunca auto-mapear) |
| C07 | Producto no observado | `expectsControlledToolFailure` (evidence gate bloquea) |
| C08 | Conversacion sin tool ("gracias") | cero tool calls (`forbiddenTools` = todo `AGENT_LOOP_TOOL_POOL`) |
| C09 | Multi-intencion simple | solo `select_products` exigido (budget real `maxToolExecutions=2` no alcanza para las dos intenciones en una ronda - ver Parte E) |
| C10 | Tool failure controlado | Catalog mock devuelve 503 para producto 999, `expectsControlledToolFailure` |
| C11 | `invalid_response` recuperable | attempt 1 falla, T01 concede 1 recovery, attempt 2 responde - `expectsStructuredFailure` |
| C12 | `invalid_response` persistente | ambos intentos fallan - `expectedTerminalReason: provider_unavailable`, fail closed, sin tercer intento |

### CLI (`scripts/benchmark-agent-tool-loop.ts`)

```text
npx tsx scripts/benchmark-agent-tool-loop.ts                       # offline, runs=1, corpus completo
npx tsx scripts/benchmark-agent-tool-loop.ts --runs=10              # offline, 10 corridas por caso
npx tsx scripts/benchmark-agent-tool-loop.ts --case=C01,C08         # subconjunto
npx tsx scripts/benchmark-agent-tool-loop.ts --out=resultado.json   # BenchmarkRunSummary crudo a disco

BENCHMARK_LIVE_LLM_ENABLED=true npx tsx scripts/benchmark-agent-tool-loop.ts --live --runs=10
```

Valida el corpus (`validateBenchmarkCorpus`) antes de correr; en `--live` sin el gate habilitado, o con el gate habilitado pero config incompleta, **rechaza explicitamente** (exit code 1) - nunca cae de vuelta a offline en silencio. Carga credenciales de DB local via el mismo `loadLocalEnv()` (`scripts/db-utils.ts`) que ya usa `scripts/dev-local.ts` - nunca hardcodea credenciales nuevas.

## Parte D: gate de ejecucion live

`BENCHMARK_LIVE_LLM_ENABLED` debe ser exactamente el string `"true"` (case-insensitive, trim) - ausente o cualquier otro valor deja el benchmark en modo offline/rechazado. Con el gate activo, `resolveLiveBenchmarkProviderConfig` exige ademas `BRAIN_MODEL_API_URL`+`BRAIN_MODEL_API_KEY` (las mismas variables de configuracion de produccion, para no requerir un secreto de benchmark separado) y un modelo resoluble (`BENCHMARK_LIVE_LLM_MODEL` o, si esta ausente, `BRAIN_MODEL_NAME`). La API key nunca se escribe a una variable que sobreviva la llamada, nunca se loguea, nunca se persiste - se lee una vez y se pasa directo a `createHttpAgentLoopProvider` (el mismo provider de produccion, sin modificar). Catalog Service/Carrier MS/DB permanecen siempre aislados (environment.ts) sin importar el modo - lo unico que cambia entre offline y live es cual `AgentLoopProvider` se inyecta.

**Esta tarea no ejecuto el modo live.** No hay `BENCHMARK_LIVE_LLM_ENABLED` en este entorno, y no se solicito autorizacion explicita para gastar requests reales contra el proveedor. Ver `docs/audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md` para el veredicto formal (`INSUFFICIENT_DATA`).

## Parte C: ejecucion offline (obligatoria, cumplida)

`tests/agent-loop/benchmark/offlineHarnessEndToEnd.test.ts` corre el corpus completo (`runCorpus(BENCHMARK_CORPUS, {mode:"offline", runsPerCase:1})`) dentro de la suite automatizada y confirma que las 12 corridas cumplen su propio `groundTruth` (`score.overallPass === true` en las 12), mas dos tests dedicados que verifican, contra el `runAgentToolLoop` real (no un doble): C11 recupera exactamente en el segundo intento (`llmCalls.length === 2`, `outcome` `invalid_response` -> `success`) y C12 falla cerrado exactamente en dos intentos (`terminalReason: provider_unavailable`, sin tercer intento). Esto valida el harness/scoring/metrics end-to-end, no solo por tipos.

## Que NO se toco

- `runAgentToolLoop.ts`, `buildAgentStepPromptPackage.ts`, `validateAgentStep.ts`, `agentStepTypes.ts`, `httpAgentLoopProvider.ts`, `providerFailureClassification.ts`, `runNativeAgentToolLoopCycle.ts` - **cero lineas tocadas**. El benchmark solo importa y compone lo ya existente.
- Capability Gateway registry/definiciones de tools - sin cambios; solo se redirige el `CatalogPort`/`CarrierService`/`CommuneCatalogPort` via los seams de test ya existentes (`resetCapabilityGatewayCatalogPortForTests`, `setCalculateShippingCarrierServiceForTests`, `setCommuneResolverForTests`).
- Ningun envio real de WhatsApp, ningun outbox, ninguna escritura a Catalog Service o Carrier MS reales, ninguna DB de produccion - ver `tests/agent-loop/benchmark/safetyIsolation.test.ts` (chequeo estatico de imports) y la propia arquitectura de `environment.ts` (Catalog Service mock atado solo a `127.0.0.1`).

## Archivos nuevos

- `lib/brain/commercial/agent-loop/benchmark/{types,validateCorpus,scoring,metrics,environment,offlineProvider,instrumentedProvider,liveProvider,runCorpus,index}.ts`
- `tests/fixtures/agent-loop-benchmark/corpus.ts`
- `scripts/benchmark-agent-tool-loop.ts`
- `tests/agent-loop/benchmark/{corpus,scoring,metrics,providers,liveGate,safetyIsolation,offlineHarnessEndToEnd}.test.ts`
- `docs/audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md`

## Tests

48 tests nuevos, todos en `tests/agent-loop/benchmark/`:

- `corpus.test.ts` (7): el corpus tiene exactamente C01-C12 sin duplicados, `validateBenchmarkCorpus` acepta el corpus real y rechaza fixtures rotos (caseId duplicado, script vacio, tool requerida+prohibida, `expectsStructuredFailure` sin paso `invalid_response`).
- `scoring.test.ts` (10): `scoreCase` unitario - tool requerido faltante/presente, tool prohibido, argumentos de `select_products` correctos/incorrectos, destino ambiguo esperado pero resuelto (debe fallar), destino resuelto correcto, `terminalReason` incorrecto, controlled tool failure/structured failure esperados pero ausentes.
- `metrics.test.ts` (10): `computeAggregateMetrics`/`computeMetricsByCase` - conjunto vacio (todo `null`, nunca `0` inventado), conteos, tasas de correctness, tasas de `invalid_response`/`empty_response`/`invalid_model_json` separadas, activacion/exito de recovery estructural y de schema repair (via prefijos de `loop.warnings`), percentiles p50/p95 exactos sobre un dataset conocido, promedio/max de llamadas por turno, `usageComplete` falso cuando falta un token, distribucion de `finishReason`.
- `providers.test.ts` (9): `offlineProvider` interpreta cada `kind` de paso correctamente (incluyendo omision/presencia de `pendingCatalogAction`, repeticion del ultimo paso), lanza fallas correctamente clasificadas; `instrumentedProvider` graba exito/fallo con los campos correctos y re-lanza el error original sin alterarlo.
- `liveGate.test.ts` (7): deshabilitado por defecto, la sola presencia de una API key nunca habilita el modo live, el flag debe ser exactamente `"true"`, rechazo por falta de endpoint/apiKey/modelo, resolucion completa con precedencia de modelo y overrides de temperatura/tokens/reintentos.
- `safetyIsolation.test.ts` (2): ningun archivo del harness offline importa modulos de WhatsApp/outbox/Meta; el mock de Catalog Service solo se ata a `127.0.0.1`.
- `offlineHarnessEndToEnd.test.ts` (3): corpus completo de 12 casos pasa su propio ground truth end-to-end contra `runAgentToolLoop` real; C11 recupera; C12 falla cerrado sin tercer intento; el env de `CATALOG_SERVICE_BASE_URL` queda exactamente como estaba antes de la corrida (sin fuga de estado).

## Validacion ejecutada

- `npm run typecheck` - limpio.
- `npm run lint` - 0 errores; 34 warnings preexistentes en el repo (ninguna en archivos de esta tarea - confirmado con una corrida de lint aislada sobre solo los archivos nuevos).
- Focused: 48/48 pass (incluye la corrida real del corpus de 12 casos contra MariaDB local, no simulada).
- Suite completa (`npm test`, contra MariaDB local real): **2936 tests, 2902 pass / 34 fail**. `LLM-R1-T05` no modifico ningun archivo existente (solo agrego archivos nuevos), asi que no aplica el procedimiento de `git stash` de `T01`-`T04` - no hay nada que revertir para obtener un baseline. Los 34 fallos son preexistentes y ajenos por completo a `agent-loop/`/`benchmark/`: drift de checksum de migracion (022-024), mocks de transporte WhatsApp, ownership/pilot-isolation del outbox worker, concurrencia de `sales-agent-configuration` (`[P25]`) y de `ACS-R1-05-T06.2`, y el bloque completo de tests de `ACS-R1-04` (identidad de cliente) - consistente con `docs/ACTIVE_RELEASE.md` marcando esa release como `active_blocked_external`. Ninguno de los 34 nombres de test pertenece a un archivo de esta tarea ni a `runAgentToolLoop.ts`/`buildAgentStepPromptPackage.ts`/`validateAgentStep.ts`/`httpAgentLoopProvider.ts`/`providerFailureClassification.ts` (cero lineas tocadas de esos archivos - ver arriba).

## Siguiente paso recomendado

Ejecutar el benchmark en modo `--live` bajo autorizacion explicita (costo real de API) para reemplazar los campos `NOT_MEASURED` de `docs/audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md` con datos reales de `deepseek-v4-flash`, con `--runs=10` como minimo diagnostico. Solo entonces evaluar un modelo candidato bajo el mismo harness (mismo corpus, mismo `AgentStep` schema, mismos fixtures de tools, mismo `commercialContext`, misma temperatura, mismo budget de tokens, misma politica de reintentos) - nunca cambiar prompt/contrato/budgets al mismo tiempo que el modelo.
