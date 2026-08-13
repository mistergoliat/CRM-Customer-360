---
title: LLM-R1-T08A — Provider Deadline Enforcement Fix
doc_id: release-llm-r1-t08a-provider-deadline-enforcement-fix
status: implemented
owner: architecture
last_reviewed: 2026-08-13
source_of_truth_for:
  - the httpAgentLoopProvider.ts attempt-cleanup lifecycle (fetch + response.json() share one deadline)
depends_on:
  - ../audits/SALES-AGENT-LLM-END-TO-END-LATENCY-AUDIT.md
  - ./LLM-R1-T07-end-to-end-latency-root-cause-audit.md
tags:
  - release
  - agent-loop
  - llm-provider
  - reliability
---

# LLM-R1-T08A — Provider Deadline Enforcement Fix

Corrige el defecto confirmado en `docs/audits/SALES-AGENT-LLM-END-TO-END-LATENCY-AUDIT.md` (seccion 8): `lib/brain/commercial/agent-loop/providers/httpAgentLoopProvider.ts` cancelaba el timer de abort (`attemptSignal.cleanup()`) justo despues de que `fetch()` resolvia y **antes** de `response.json()` - una vez que llegaban las cabeceras HTTP, ninguna llamada tenia proteccion de timeout mientras se leia/parseaba el cuerpo, que es donde vive el tiempo real de generacion de una respuesta no-streaming. Confirmado con datos reales en `T07`: una llamada corrio 83641ms contra un `timeoutMs` de turno de 20000ms (4.2x el limite) y aun asi se clasifico `success`.

Tarea puramente de codigo, alcance unico: el mecanismo de deadline/cleanup de un intento HTTP. Sin cambios a modelo, thinking mode, retries, timeout default, prompts, `max_tokens`, ni semantica del Agent Tool Loop.

## Que se cambio

`lib/brain/commercial/agent-loop/providers/httpAgentLoopProvider.ts`:

1. El cuerpo entero de un intento (`fetch()` -> chequeo `response.ok` -> `response.json()` -> extraccion de `content` -> `parseModelJson`) queda envuelto en un unico `try { ... } finally { attemptSignal.cleanup(); }`. `cleanup()` ahora corre **exactamente una vez por intento**, sin importar si ese intento termina en exito, en un `continue` de retry, o en un `throw` - nunca antes de que el intento realmente termine.
2. `attemptSignal.signal` (el mismo `AbortSignal` pasado a `fetch()`) permanece armado durante `response.json()` tambien - el timer del deadline y el listener del signal externo (turno) ya no se destruyen apenas llegan las cabeceras. Esto es lo que permite que el deadline efectivamente aborte una lectura de body colgada, en vez de solo poder abortar mientras `fetch()` mismo esta pendiente.
3. Nuevo helper interno `handleTransportFailure(error, attempt)` (closure dentro de `invoke()`, comparte `deadline`/`model`/`maxModelRetries`/`options.signal` por scope) - centraliza la clasificacion de un fallo de transporte (abort externo -> re-throw tal cual; retry-eligible -> backoff + `"retry"`; agotado -> `classifyRawProviderError` -> `normalizedReason: "provider_timeout"`). Se llama desde el `catch` de `fetch()` (comportamiento identico al que ya existia) **y** desde el nuevo `catch` de `response.json()`, que ahora distingue explicitamente `isAbortError(error)` (delega a `handleTransportFailure`, nunca se clasifica como `invalid_json_response`) de un `SyntaxError` real sobre un body completo pero malformado (comportamiento sin cambios: `invalid_json_response`, no retryable).

Ningun otro archivo de codigo de produccion se toco. `runAgentToolLoop.ts` no se modifico - su propio mecanismo de deadline (el `AbortController` de `invokeProviderWithDeadline`) sigue exactamente igual; lo que cambia es que ahora el `AbortSignal` que `httpAgentLoopProvider.ts` pasa a `fetch()` realmente protege la llamada completa, no solo su primera mitad.

## Por que el fix funciona (mecanica real, no solo teoria)

`response.json()` lee del mismo `response.body` cuyo stream esta atado al `signal` original de `fetch()` - abortar ese signal mientras el body todavia se esta leyendo cancela la lectura y `response.json()` rechaza con `AbortError`, exactamente igual que abortar durante `fetch()` mismo. El bug pre-existente nunca dependia de un comportamiento exotico del proveedor: `attemptSignal.cleanup()` llamaba `clearTimeout(timer)` **antes** de que existiera la oportunidad de que ese timer disparara durante `response.json()` - una vez limpiado, no quedaba ningun timer armado, punto. Confirmado empiricamente con datos reales, no solo con el codigo: los 5 tests nuevos (`[HP24]`-`[HP28]`) reproducen el escenario exacto (cabeceras HTTP inmediatas, cuerpo retenido deliberadamente mas alla del deadline via un `http.Server` local real) y verifican que ahora aborta a tiempo.

## Tests (mapeo a los 9 obligatorios)

Archivo: `tests/agent-loop/httpAgentLoopProvider.test.ts` (5 tests nuevos, `[HP24]`-`[HP28]`).

1. **fetch rapido + response.json rapido -> success**: `[HP24]` (nuevo, explicito) - ademas ya cubierto implicitamente por `[HP11]`-`[HP13]`/`[HP15c]` preexistentes.
2. **fetch nunca completa -> timeout existente**: `[HP14]`/`[PF5]` preexistentes, sin cambios, siguen en verde - no se duplico.
3. **fetch resuelve headers pero response.json queda pendiente mas alla del timeout -> provider_timeout**: `[HP25]` (nuevo) - servidor HTTP local real envia cabeceras (`res.flushHeaders()`) y retiene el cuerpo 3000ms contra un `timeoutMs=200`; verifica `cause.normalizedReason === "provider_timeout"` y que el abort ocurre cerca de 200ms, nunca esperando los 3000ms completos.
4. **body completa antes del deadline -> success**: `[HP26]` (nuevo) - cuerpo retenido 100ms contra `timeoutMs=1000`, exito normal.
5. **cleanup ocurre exactamente una vez**: `[HP27]` (nuevo, via `node:events#getEventListeners` sobre un `AbortSignal` externo compartido a traves de 2 reintentos + 1 exito - verifica que el listener de cada intento se remueve, sin fugas) + una segunda verificacion del mismo invariante en el camino de timeout dentro de `[HP25]`.
6. **timeout durante body no se clasifica como invalid_json_response**: assercion explicita dentro de `[HP25]` (`assert.notEqual(cause.errorCode, "invalid_json_response")`).
7. **retries tecnicos existentes continuan intactos**: `[HP15]`/`[HP15b]`/`[HP15c]`/`[HP16]`/`[HP16b]`/`[HP17]`/`[HP18]`/`[HP19]` preexistentes, sin cambios de codigo, siguen en verde.
8. **T01 structured recovery intacto**: `tests/agent-loop/runAgentToolLoop.test.ts` (casos `[LLM-R1-T01 Case 1]`-`[LLM-R1-T01 Case 5]`) - 93/93 tests del archivo en verde, cero cambios a `runAgentToolLoop.ts`.
9. **T02 observability registra correctamente elapsed/outcome del timeout**: `[HP28]` (nuevo, integracion real: `runAgentToolLoop` real + `createHttpAgentLoopProvider` real + servidor HTTP local real reteniendo el body 5000ms contra `timeoutMs=300`) - verifica `result.terminalReason === "timeout"`, `result.llmCalls[0].outcome === "provider_timeout"`, `result.llmCalls[0].phase === "gathering"`, y que `elapsedMs` refleja el deadline real (~300ms), nunca los 5000ms retenidos.

## Validacion ejecutada

- `npx tsc --noEmit` (proyecto completo) - limpio.
- `npx eslint lib/brain/commercial/agent-loop/providers/httpAgentLoopProvider.ts` - 0 problemas.
- `tests/agent-loop/httpAgentLoopProvider.test.ts` - 33/33 pass (28 preexistentes + 5 nuevos).
- `tests/agent-loop/runAgentToolLoop.test.ts` - 93/93 pass (T01/T02/T04/pendingCatalogAction/recommendation continuity, cero regresiones).
- `tests/agent-loop/**/*.test.ts` + `tests/agent-loop/benchmark/**/*.test.ts` completo: 451 tests, 442 pass / 9 fail. **Los 9 fallos son preexistentes**, confirmado con `git stash` + la misma corrida sobre el arbol limpio (baseline: 446 tests, 437 pass / los mismos 9 fallos, mismos nombres exactos) - todos dependientes de una conexion MariaDB (`DB: ...`) o de outbox/persistencia (`[W6]`-`[W9]`, `[T05] offline benchmark`) no disponible en este entorno, ninguno relacionado con `httpAgentLoopProvider.ts` ni con el mecanismo de deadline. La diferencia de 5 tests (451 vs 446, 442 vs 437) es exactamente `[HP24]`-`[HP28]`, todos en verde.
- No se ejecuto el benchmark live (explicitamente fuera de alcance de `T08A` - queda para `T08B`).

## Archivos cambiados

- `lib/brain/commercial/agent-loop/providers/httpAgentLoopProvider.ts` - reordena el cleanup del intento (fix).
- `tests/agent-loop/httpAgentLoopProvider.test.ts` - 5 tests nuevos (`[HP24]`-`[HP28]`) mas el import de `runAgentToolLoop`/`getEventListeners`.
- `docs/releases/LLM-R1-T08A-provider-deadline-enforcement-fix.md` - este documento.

## Riesgos y deuda

- El mecanismo de doble timer (el `AbortController` propio de `invokeProviderWithDeadline` en `runAgentToolLoop.ts` y el de `buildAttemptSignal` en `httpAgentLoopProvider.ts`, ambos derivados del mismo deadline absoluto pero calculados independientemente) ya existia antes de esta tarea y no se toco - sigue siendo una carrera de milisegundos entre dos timers casi simultaneos, no una fuente unica de verdad. En la practica converge de forma confiable al mismo resultado observable (`terminalReason: "timeout"`, `outcome: "provider_timeout"`) tanto antes como despues de este fix, confirmado por los 5 tests nuevos ademas de los preexistentes `[HP14]`/`[PF5]`. Simplificar esto a un unico deadline compartido es un cambio de arquitectura mas amplio, fuera del alcance quirurgico de `T08A`.
- No se cambio la politica de timeout (per-turno vs. per-llamada) que la auditoria `T07` tambien senalo como candidato `P1` - esta tarea solo hace que el `timeoutMs` actual (per-turno) sea un contrato real, no lo rediseña.

## Siguiente tarea

`LLM-R1-T08B` (no implementada aqui): comparacion live `deepseek-v4-flash` con thinking habilitado vs. deshabilitado, mismo harness `T05`/`T06`, 10 runs/caso, con las metricas especificadas por el usuario (tool/argument accuracy, structured failure rate, reasoning/completion tokens por llamada, latencia LLM/turno p50/p95, timeout rate agregado y de C09 especificamente).
