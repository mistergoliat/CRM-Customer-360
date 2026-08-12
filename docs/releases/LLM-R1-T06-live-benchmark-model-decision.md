---
title: LLM-R1-T06 — Live Agent Tool Loop Benchmark and Model Decision
doc_id: release-llm-r1-t06-live-benchmark-model-decision
status: implemented
owner: architecture
last_reviewed: 2026-08-12
source_of_truth_for:
  - live execution results of the LLM-R1-T05 benchmark harness against deepseek-v4-flash
  - C09 multi-intent latency/timeout root cause
depends_on:
  - ../audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md
  - ./LLM-R1-T05-production-measurement-model-benchmark.md
tags:
  - release
  - agent-loop
  - llm-provider
  - benchmark
  - live-execution
---

# LLM-R1-T06 — Live Agent Tool Loop Benchmark and Model Decision

Ejecuta el benchmark live que `LLM-R1-T05` construyo pero dejo sin correr, exclusivamente contra el proveedor/modelo actual (`deepseek-v4-flash`), y emite un veredicto basado en 120 turnos reales. No se cambio modelo, prompt, retries, timeout, `max_tokens`, temperatura ni tools de produccion. El unico cambio de codigo es una correccion al propio harness (CLI que no cerraba su pool de DB). El veredicto completo, con las 14 secciones requeridas, vive en `docs/audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md` (actualizado por esta tarea) - este documento cubre la ejecucion, el defecto encontrado/corregido, y un resumen de los hallazgos.

## Seguridad verificada antes de habilitar live

Antes de correr una sola llamada real se re-confirmo, por codigo y por test (`tests/agent-loop/benchmark/safetyIsolation.test.ts` + `liveGate.test.ts`, 9/9 pass):

- `runCorpus.ts#runBenchmarkCase` arma `setupBenchmarkEnvironment()` **antes** de decidir el modo - el aislamiento (Catalog Service mock local, Carrier MS fake, resolver de comunas real sobre datos fake, DB de test local) es identico en offline y en live; el modo solo decide que `AgentLoopProvider` recibe el loop.
- Ningun archivo del harness offline importa modulos de WhatsApp/outbox/Meta (chequeo estatico de imports).
- El gate `BENCHMARK_LIVE_LLM_ENABLED` exige el string exacto `"true"` - la sola presencia de `BRAIN_MODEL_API_KEY` en `.env` nunca habilita el modo live por si sola.

## Configuracion usada

`BRAIN_MODEL_API_URL`/`BRAIN_MODEL_API_KEY`/`BRAIN_MODEL_NAME` leidos de `.env` (produccion) directamente en el shell (`set -a; source <(grep ... .env); set +a`) - nunca escritos en un comando ni impresos en ningun log. `temperature=0`, `maxModelRetries=0` (default de `liveProvider.ts`, coincide con `SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT`). `maxOutputTokens` deliberadamente sin forzar - coincide con el comportamiento real de `resolveEffectiveModelConfiguration` cuando no hay una fila de configuracion publicada (nunca cappea con un numero inventado). `timeoutMs` del loop: `DEFAULT_TIMEOUT_MS=20000` (no seteado por el harness, mismo default que produccion). Ver seccion 2 y 4 de la auditoria actualizada para el detalle completo de esta decision.

## Fase 1 — Smoke (12 casos x 1 corrida)

Ejecutada primero, como pedia la tarea. Sin side effects externos inesperados: la unica llamada de red real fue al proveedor LLM (`api.deepseek.com`), confirmado por diseño del harness (Catalog/Carrier siguen siendo mocks locales/`127.0.0.1` sin importar el modo). **Defecto encontrado**: el CLI (`scripts/benchmark-agent-tool-loop.ts`) nunca cerraba el pool de conexiones de DB que `select_products`/`set_shipping_destination` abren - el proceso quedaba colgado indefinidamente aunque el benchmark ya hubiera terminado y escrito su resultado completo (confirmado: el archivo `--out` ya existia y el reporte completo ya se habia impreso). Corregido con `getPool().end()` en un bloque `finally` de `main()` - el CLI ahora termina por si solo (confirmado con `--case=C02` offline tras el fix). Cero cambios a codigo de produccion; typecheck y lint limpios tras el fix; los 48 tests del harness siguen pasando.

## Fase 2 — Medicion (12 casos x 10 corridas = 120 turnos)

Ejecutada tras confirmar el smoke sano. **No se ejecuto `--runs=30`** - la muestra de 10 no resulto ruidosa (los hallazgos son claros y consistentes: C09 concentra 6/7 de los timeouts, C02/C07 tienen una explicacion estructural clara via inspeccion de sus propios steps, el resto del corpus es limpio al 100%).

## Resultados (resumen — ver la auditoria actualizada para el detalle completo)

- **Confiabilidad de contenido**: alta. `invalidResponseRate` 0.4% (1/247 llamadas), `invalidModelJsonRate` 0%, `schemaFailureRate` 0%. El unico fallo real (`empty_response`, caso C04) fue recuperado por el mecanismo de `LLM-R1-T01`/`T04` en su unico intento de recovery.
- **Latencia**: mejoro sustancialmente en la mediana (p50 de llamada 4266ms vs. los 14-26s que documentaba la auditoria original) pero la cola sigue siendo severa (p95 de llamada 19857ms, maximo real observado **97002ms** en una sola llamada).
- **Timeouts**: 7/120 turnos (5.8%) terminaron en `terminalReason: timeout` (el deadline de 20s del propio loop, `DEFAULT_TIMEOUT_MS`, no un fallo de contenido del modelo) - **6 de esos 7 en el caso C09** (multi-intencion: "quiero 2 de la classic y saber cuanto sale el despacho"), un **60% de fallo por timeout en ese caso especifico**.
- **Causa raiz de C09**: no es numero de llamadas (2.2 promedio, normal para el corpus) sino **longitud de la respuesta** - 5876 tokens de output promedio por turno completado, vs. 100-2000 en el resto del corpus, correlacionado directamente con su latencia de llamada (p50 11184ms, p95 58271ms, maximo 97002ms).
- **Dos hallazgos de diseño del corpus, no del modelo**: C02's `overallPassRate` bajo (10%) se explica por `get_product_details` estar en `requiredTools` pese a que la nota del propio fixture lo describe como buena practica opcional (`toolArgumentAccuracy` real: 100%). C07's `overallPassRate` bajo (0%) se explica porque el modelo evita completamente el intento de seleccion no sustentada (comportamiento seguro) en vez de intentarlo y ser bloqueado (lo que el `groundTruth` esperaba observar).
- **Llamadas por turno**: promedio 2.06, maximo 3 - muy cercano a la prediccion estructural offline de `T05` (2.17/3), validando que el harness offline es un buen proxy del control flow real.

## Veredicto

**`BENCHMARK_ALTERNATIVES`**. Reliability de contenido no es el problema; latencia de cola (especialmente en flujos multi-intencion como C09) si lo es, y es material (5.8% de timeout global, 60% en el caso afectado). No se compara ningun modelo alternativo en esta tarea - se propone `LLM-R1-T07` para eso, bajo el mismo harness/corpus/configuracion.

## Archivos cambiados

- `scripts/benchmark-agent-tool-loop.ts` - agrega `getPool().end()` en un `finally` para que el CLI termine por si solo (defecto del harness, no de produccion).
- `docs/audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md` - reescrito con resultados live (las 14 secciones), veredicto actualizado, bloque de cierre de `T06` (el bloque `T05` se preserva como historico al final del documento).
- `docs/releases/LLM-R1-T06-live-benchmark-model-decision.md` - este documento.

## Validacion ejecutada

- `npm run typecheck` - limpio.
- `npm run lint` sobre `scripts/benchmark-agent-tool-loop.ts` - 0 problemas.
- `tests/agent-loop/benchmark/*.test.ts` (48 tests) - 48/48 pass tras el fix del CLI.
- Fase 1 (smoke, live): 12/12 turnos completaron, cero side effects externos inesperados (confirmado por diseño del harness + inspeccion de logs).
- Fase 2 (medicion, live): 120/120 turnos ejecutados, proceso termino limpio (`exit code 0`) tras el fix.
- No se re-corrio la suite completa de 2900+ tests: el unico archivo modificado (`scripts/benchmark-agent-tool-loop.ts`) es un CLI standalone sin importadores en `tests/`, y su unico cambio (cierre de pool en `finally`) no altera ninguna ruta de codigo de produccion ni del harness ya cubierta por los 48 tests existentes.

## Siguiente tarea recomendada

`LLM-R1-T07` - comparacion A/B de `deepseek-v4-flash` contra 1-2 modelos candidatos bajo exactamente el mismo harness (`--live`, mismo corpus C01-C12, misma configuracion salvo el modelo/endpoint), priorizando candidatos con mejor latencia de cola en generaciones largas. Mantener runsPerCase>=10 para comparabilidad directa con esta tarea.
