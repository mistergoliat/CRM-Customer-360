---
title: LLM-R1-T07 — Agent Tool Loop End-to-End Latency Root Cause Audit
doc_id: release-llm-r1-t07-end-to-end-latency-root-cause-audit
status: audit_complete_no_production_change
owner: architecture
last_reviewed: 2026-08-13
source_of_truth_for:
  - execution record of the LLM-R1-T07 latency audit
depends_on:
  - ../audits/SALES-AGENT-LLM-END-TO-END-LATENCY-AUDIT.md
  - ./LLM-R1-T06-live-benchmark-model-decision.md
tags:
  - release
  - agent-loop
  - llm-provider
  - latency
  - audit
---

# LLM-R1-T07 — Agent Tool Loop End-to-End Latency Root Cause Audit

Responde por que la latencia del Agent Tool Loop sigue siendo operacionalmente alta pese a que `LLM-R1-T06` encontro confiabilidad estructural buena (`invalidResponseRate` 0.4%). Auditoria pura: cero cambios a modelo, prompt, timeout, `max_tokens`, retries ni arquitectura del Tool Loop de produccion. El veredicto completo, con las 14 secciones (13 del enunciado + resultado final), vive en `docs/audits/SALES-AGENT-LLM-END-TO-END-LATENCY-AUDIT.md`.

## Que se hizo

1. **Lectura de codigo** de `runAgentToolLoop.ts`, `httpAgentLoopProvider.ts`, `buildAgentStepPromptPackage.ts`, `agentLoopProviderTypes.ts`, `lib/brain/commercial/agent-loop/benchmark/*` y `parseModelJsonOutput.ts` para entender el mecanismo real de deadline/fases/tokens antes de medir nada.
2. **Gap metodologico encontrado**: `LLM-R1-T06` nunca ejecuto el CLI del benchmark (`scripts/benchmark-agent-tool-loop.ts`) con `--out`, asi que no existe ningun `BenchmarkRunSummary` crudo por-llamada de esa corrida — solo los agregados ya publicados en `docs/audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md`. Varias partes de esta auditoria (desglose por-fase, correlaciones por-llamada, reconstruccion run-por-run de C09) requerian esa granularidad.
3. **Autorizacion explicita del usuario** (via pregunta directa, no asumida) para una corrida live nueva, focalizada en `C09` (el caso critico de T06: 60% de timeout) en vez de repetir el corpus completo de 120 turnos — mismo harness/modelo/config exactos que T06, ya validado como seguro por `tests/agent-loop/benchmark/safetyIsolation.test.ts`/`liveGate.test.ts` (9/9 pass, sin re-verificar en esta tarea porque no se toco ese codigo).
4. **Ejecucion**: `BENCHMARK_LIVE_LLM_ENABLED=true npx tsx scripts/benchmark-agent-tool-loop.ts --live --case=C09 --runs=10 --out=<scratchpad>` — 10 corridas, 21 llamadas reales contra `deepseek-v4-flash`. Reproduce la severidad de T06 (7/10 timeouts vs. 6/10 en T06 — misma direccion). El JSON crudo (`BenchmarkRunSummary` completo, `phase`/`elapsedMs`/`inputTokens`/`outputTokens`/`finishReason`/`outcome` por llamada) se guardo en el scratchpad de la sesion, fuera del repo — no es un artefacto versionado (efimero, reproducible re-corriendo el mismo comando).
5. **Probe crudo adicional, gated, fuera del harness** (2 llamadas reales mas al mismo endpoint/modelo): reutiliza `buildAgentStepPromptPackage` sin modificarla para reconstruir el prompt exacto de la primera decision de C09, y llama al proveedor directamente (una vez sin streaming, una vez con `stream:true`) imprimiendo el body crudo **sin parsear** — nunca visible en el runtime real, que descarta todo excepto el AgentStep JSON. Esto confirmo, con evidencia directa y no hipotesis, que el proveedor devuelve un campo `reasoning_content` separado (contabilizado dentro de `usage.completion_tokens` via `completion_tokens_details.reasoning_tokens`) y que el TTFT real es ~626ms (rapido - no es el cuello de botella). Script temporal (`scripts/__t07-raw-probe.ts`), gated tras el mismo `BENCHMARK_LIVE_LLM_ENABLED=true`, **eliminado despues de usarlo** - nunca commiteado.
6. **Hallazgo de codigo, no solo de datos**: lectura linea por linea de `httpAgentLoopProvider.ts` revelo que `attemptSignal.cleanup()` (linea 209) cancela el timer de abort **antes** de `response.json()` (linea 227) - una vez que `fetch()` resuelve, ninguna llamada tiene proteccion de timeout mientras se lee/parsea el body, que es donde vive el tiempo de generacion largo. Confirmado con datos reales: una llamada de la corrida de C09 tomo 83641ms con un `timeoutMs` de turno de 20000ms (4.2x el limite) y aun asi se clasifico `success`, nunca `provider_timeout`.

## Hallazgos principales (resumen - ver la auditoria para el detalle completo)

- **Causa dominante de latencia**: tokens de razonamiento ocultos (`reasoning_content`) que el proveedor genera antes del JSON util, contabilizados dentro de `usage.completion_tokens` y nunca leidos/logueados/acotados por el runtime actual. `correlation(outputTokens, elapsedMs) = 0.995` (n=21, datos reales); `correlation(inputTokens, elapsedMs) = -0.122` (sin correlacion - el prompt no es el problema).
- **Defecto de runtime confirmado, independiente del modelo**: el mecanismo de deadline (`timeoutMs=20000`, per-turno) no protege una llamada ya en curso durante la lectura del body de la respuesta - una correccion de codigo (fuera de alcance de esta tarea) restauraria el contrato real del timeout sin importar que modelo se use.
- **`max_tokens`**: nunca se envio en T06 ni en esta corrida (config no forzada, sin fila publicada) - no hay contradiccion `1024 vs. 5876` que explicar, el techo simplemente no existia en el request.
- **Tools/runtime local**: 0.03% del tiempo total de turno (medido con datos reales, no supuesto) - limite honesto: mide el entorno aislado del harness (mocks locales), no la red real de produccion.
- **Veredicto de la Parte 12**: `BOTH_IN_PARALLEL` - corregir el defecto de deadline (independiente del modelo) y evaluar modelos/configuraciones alternativas (`LLM-R1-T08`, propuesta) en paralelo, con un criterio nuevo explicito: priorizar candidatos donde el razonamiento oculto sea controlable o ausente por defecto.

## Archivos cambiados

- `docs/audits/SALES-AGENT-LLM-END-TO-END-LATENCY-AUDIT.md` - nuevo, las 13 secciones pedidas mas el bloque de resultado.
- `docs/releases/LLM-R1-T07-end-to-end-latency-root-cause-audit.md` - este documento.
- Ningun archivo de codigo de produccion tocado. `scripts/__t07-raw-probe.ts` fue temporal y se elimino antes de cerrar la tarea (confirmado con `git status` limpio).

## Validacion ejecutada

- Lectura completa de `runAgentToolLoop.ts`, `httpAgentLoopProvider.ts`, `buildAgentStepPromptPackage.ts`, `agentLoopProviderTypes.ts`, `parseModelJsonOutput.ts`, `lib/brain/commercial/agent-loop/benchmark/{types,metrics,instrumentedProvider,liveProvider}.ts` antes de medir - ningun numero de esta auditoria se reporta sin haber verificado el mecanismo de codigo que lo produce.
- Corrida live real (`--live --case=C09 --runs=10 --out=...`): 10/10 turnos ejecutados, proceso termino limpio, JSON crudo capturado y analizado (correlaciones, percentiles, desglose por fase, residual tool/LLM) con scripts Node ad-hoc sobre el archivo de salida (no comprometidos al repo).
- Probe crudo (2 llamadas reales adicionales, fuera del harness): confirmo `reasoning_content`/`completion_tokens_details.reasoning_tokens` en el body crudo del proveedor y midio TTFT real via streaming.
- `git status` verificado limpio despues de eliminar el script temporal - ningun cambio de codigo de produccion, prompt, timeout, `max_tokens`, retries ni arquitectura del Tool Loop.
- No se corrio `npm run build`/`npm run typecheck` porque no se modifico ningun archivo `.ts` de produccion ni de test (solo Markdown nuevo) - no aplica.

## Siguiente tarea recomendada

`LLM-R1-T08` (no implementada aqui, ver auditoria seccion 14 para el plan completo priorizado):

1. P0, codigo de produccion: corregir el orden de `attemptSignal.cleanup()` en `httpAgentLoopProvider.ts` para que el deadline proteja tambien `response.json()`.
2. P0, investigacion: confirmar si el proveedor expone algun control de esfuerzo de razonamiento antes de asumir que hace falta cambiar de modelo.
3. P1: comparacion de modelos/configuraciones bajo el mismo harness, con el criterio de seleccion nuevo de la seccion 13 de la auditoria (razonamiento oculto controlable/ausente).
