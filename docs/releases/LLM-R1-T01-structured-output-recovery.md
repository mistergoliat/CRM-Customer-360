---
title: LLM-R1-T01 — Bounded Structured-Output Recovery for the Native Agent Tool Loop
doc_id: release-llm-r1-t01-structured-output-recovery
status: implemented_pending_real_smoke
owner: architecture
last_reviewed: 2026-08-12
source_of_truth_for:
  - structured-recovery contract for `normalizedReason === "invalid_response"` in `runAgentToolLoop.ts`
  - gathering/finalization bounded-retry semantics for provider structural failures
depends_on:
  - ../audits/SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md
tags:
  - release
  - agent-loop
  - llm-provider
  - reliability
---

# LLM-R1-T01 — Bounded Structured-Output Recovery for the Native Agent Tool Loop

Implementa la recomendacion P0-1 de la auditoria `docs/audits/SALES-AGENT-LLM-PROVIDER-LATENCY-STRUCTURED-OUTPUT-AUDIT.md`: un fallo estructural del proveedor LLM (`normalizedReason === "invalid_response"`) ya no mata el turno de inmediato — dispone de exactamente un intento adicional, acotado, en la misma fase donde ocurrio. No se toco el modelo configurado, ni `timeoutMs`, ni `maxModelRetries`, ni `max_tokens`/temperatura, ni la politica de reintentos tecnicos del provider.

## Problema

En produccion se observaron fallos `agent_tool_loop_provider_failure` con `httpStatus=200`, `normalizedReason=invalid_response` (`errorCode` `empty_response` o `invalid_model_json`), `attemptCount=1`, `retryable=false`. Durante un smoke real, un turno completo `get_product_details -> completed`, `select_products -> completed` (ambas tools persistidas correctamente) termino igual en un fallback generico porque la inferencia de finalizacion — la que traduce ese trabajo ya hecho en una respuesta al cliente — fallo con `invalid_model_json` y el turno se abortaba sin usar el segundo intento de finalizacion que el loop ya reservaba.

## Causa confirmada

`runAgentToolLoop.ts` trataba **cualquier** excepcion del proveedor de forma identica, sin importar `normalizedReason`: tanto en gathering (`invoked.kind === "error"` dentro del `while` de la fase 1) como en finalization (dentro del `for` de la fase 2), la primera excepcion terminaba el turno entero con `terminalReason: "provider_unavailable"`, de inmediato. Esto ocurria incluso en el **primer** de los 2 intentos que `FINALIZATION_MAX_ATTEMPTS` ya reserva — ese segundo intento nunca se usaba para este tipo de fallo. El mecanismo de reparacion que si existia (`gatheringRetryUsed`, el `for` de finalization) solo cubria `AgentStep` sintacticamente valido pero con forma incorrecta (fallo de `validateAgentStep`), nunca una excepcion lanzada por el propio proveedor. Este comportamiento estaba confirmado como intencional y testeado explicitamente por `tests/agent-loop/runAgentToolLoop.test.ts` `[PF11]`/`[PF12]` antes de este cambio.

## Comportamiento anterior

```text
Gathering:
  provider invalid_response -> provider_unavailable inmediato (turno termina)

Finalization:
  finalization attempt 1 -> invalid_response -> provider_unavailable inmediato
  (attempt 2, ya reservado, nunca se usa)
```

## Comportamiento nuevo

```text
Gathering:
  provider invalid_response (1ra vez este turno)
    -> exactamente 1 structured-recovery attempt (mismo slot de decision, mismo prompt)
    -> si el 2do intento es valido: continua normalmente
    -> si el 2do intento tambien es invalid_response: provider_unavailable (nunca un 3er intento)

Finalization:
  finalization attempt 1 -> invalid_response
    -> usa el attempt 2 ya reservado (FINALIZATION_MAX_ATTEMPTS=2), sin contador nuevo
    -> si attempt 2 responde valido: responded/handoff normalmente
    -> si attempt 2 tambien es invalid_response: provider_unavailable (nunca un attempt 3)

Cualquier otro normalizedReason (timeout, rate_limited, authentication_error,
network_error, provider_server_error, model_unavailable, unknown_provider_error):
  sin cambio - falla inmediato, exactamente como antes de esta tarea.
```

La recuperacion es deliberadamente "ciega" en esta tarea: reenvia el mismo prompt (via `buildAgentStepPromptPackage`, sin tocar `priorSteps`), sin incluir el output invalido previo ni una linea de correccion guiada. Guided repair queda explicitamente fuera de alcance (`LLM-R1-T04`).

## Archivos modificados

- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts`:
  - Fase 1 (gathering): nueva variable `gatheringStructuredRecoveryUsed` (deliberadamente separada de `gatheringRetryUsed` — nunca conflacionadas, una repara forma de `AgentStep`, la otra repara una excepcion estructural del proveedor). En el branch `invoked.kind === "error"`, si `providerFailure.normalizedReason === "invalid_response"` y el flag aun no se uso, se marca usado, se agrega el warning `agent_loop_structured_recovery_attempted:gathering` y se hace `continue` (mismo `decisionIndex`, mismo prompt). Cualquier otro caso conserva el `return finalize("provider_unavailable", providerFailure)` original.
  - Fase 2 (finalization): mismo criterio, reutilizando el `for` de `FINALIZATION_MAX_ATTEMPTS` existente — sin contador nuevo. Si `normalizedReason === "invalid_response"` y `attempt < FINALIZATION_MAX_ATTEMPTS - 1`, se agrega el warning `agent_loop_structured_recovery_attempted:finalization` y `continue` (avanza al siguiente `attempt`, que ya incrementa el `for`). Cualquier otro caso conserva el comportamiento original.
  - No se toco `httpAgentLoopProvider.ts` (la clasificacion `retryable: false` de `empty_response`/`invalid_model_json` a nivel de transporte queda intacta, tal como pedia el alcance) ni `providerFailureClassification.ts`.
- `tests/agent-loop/runAgentToolLoop.test.ts`: 5 tests nuevos (detalle abajo) mas el helper `invalidResponseFailure(errorCode)`. `[PF11]`/`[PF12]` no se modificaron y siguen pasando sin cambios (cubren `authentication_error`/`provider_server_error`, ninguno de los dos es `invalid_response`).

## Tests agregados

Todos en `tests/agent-loop/runAgentToolLoop.test.ts`, junto a `[PF11]`/`[PF12]`:

- **`[LLM-R1-T01 Case 1]`** — gathering: 1er intento `invalid_model_json`, 2do intento `respond` valido. Verifica `terminalReason: "responded"`, exactamente 2 llamadas al provider, warning `agent_loop_structured_recovery_attempted:gathering` presente.
- **`[LLM-R1-T01 Case 2]`** — gathering: `empty_response` dos veces seguidas. Verifica `terminalReason: "provider_unavailable"`, exactamente 2 llamadas (nunca una 3ra), `providerFailure.errorCode === "empty_response"`.
- **`[LLM-R1-T01 Case 3]`** — reproduce el incidente real: `get_product_details` completado, `select_products` completado (tool budget agotado, `toolExecutionCount=2`), entra a finalization, attempt 1 `invalid_model_json`, attempt 2 `respond` valido. Verifica `terminalReason: "responded"`, exactamente 4 llamadas al provider, `toolExecutionCount` se mantiene en 2, y — la garantia de side effects — `result.steps.filter(use_tool).map(tool)` es exactamente `["get_product_details", "select_products"]`: cada tool, incluida la mutante `select_products`, aparece una sola vez en todo el trace del turno.
- **`[LLM-R1-T01 Case 4]`** — mismo setup que Case 3 pero ambos intentos de finalization fallan (`empty_response` x2). Verifica `terminalReason: "provider_unavailable"`, exactamente 4 llamadas totales (2 tools + 2 intentos de finalization, nunca un 3ro), `toolExecutionCount` se mantiene en 2 (las tools ya completadas nunca se re-ejecutan solo porque finalization fallo).
- **`[LLM-R1-T01 Case 5]`** — `authentication_error` (401) en gathering. Verifica `terminalReason: "provider_unavailable"` inmediato, exactamente 1 llamada al provider (nunca structured recovery), y que ningun warning `agent_loop_structured_recovery_attempted*` se agrego.
- **Case 6 (reintento tecnico sin cambios)**: no se agrego un test nuevo — cubierto por regresion: `[PF12]` (503/`provider_server_error` en finalization sigue fallando en el primer intento, sin usar el segundo) y toda la suite `tests/agent-loop/httpAgentLoopProvider.test.ts` (`[HP15]`/`[HP15b]`/`[HP15c]`/`[HP16]`/`[HP16b]`/`[HP17]`-`[HP19]`, reintentos tecnicos 429/5xx/timeout/network error a nivel de transporte) — las 23 pasan sin cambios, confirmando que `httpAgentLoopProvider.ts` no fue tocado.

## Garantia de bounded retry

- Gathering: a lo sumo 1 structured-recovery attempt para **todo** el turno (flag `gatheringStructuredRecoveryUsed`, nunca por decision individual) — un segundo `invalid_response` en gathering falla cerrado, nunca cae a finalization ni reintenta una 3ra vez.
- Finalization: a lo sumo 1 attempt adicional, expresado como "queda un `attempt` dentro de `FINALIZATION_MAX_ATTEMPTS=2`" — nunca mas de 2 llamadas de finalization en total, sin importar cuantas veces falle `invalid_response`.
- El deadline global del turno (`deadline = Date.now() + timeoutMs`) sigue vigente sin cambios: el chequeo `if (Date.now() > deadline)` al inicio de cada iteracion de ambos loops corre igual antes de un intento de recuperacion, asi que un intento adicional nunca se dispara si ya no queda presupuesto de tiempo.
- Ningun otro `normalizedReason` (`provider_timeout`, `rate_limited`, `authentication_error`, `network_error`, `model_unavailable`, `provider_server_error`, `unknown_provider_error`) obtiene recuperacion — siguen fallando en el primer intento, exactamente igual que antes (`[PF11]`, `[PF12]`, `[LLM-R1-T01 Case 5]`, y toda la suite de `httpAgentLoopProvider.test.ts`).

## Garantia de no duplicacion de side effects

La recuperacion nunca reejecuta una tool ya completada porque, por construccion:

- El structured-recovery attempt de gathering solo repite la invocacion del provider para el **mismo** `decisionIndex` que acaba de fallar — nunca reprocesa `steps` ya empujados (`processUseToolStep` solo se llama una vez, tras obtener un `AgentStep` valido de tipo `use_tool`).
- La fase de finalization no tiene, estructuralmente, ningun camino de codigo que ejecute una tool: `availableTools: []` en el prompt y `validateAgentStep(raw, FINALIZATION_ALLOWED_TYPES)` rechaza cualquier `use_tool` como `AgentStep` invalido — un intento de recuperacion en finalization solo puede terminar en `respond`, `handoff`, o un nuevo fallo, nunca en una ejecucion de tool.
- `[LLM-R1-T01 Case 3]`/`[LLM-R1-T01 Case 4]` verifican esto de forma concreta: `toolExecutionCount` se mantiene en 2 en ambos casos, y Case 3 verifica ademas que la tool mutante `select_products` (`governance.sideEffect: "mutating"`, `lib/brain/commercial/capability-gateway/selectProductsCapability.ts:70`) aparece exactamente una vez en `result.steps`, sin importar que la inferencia posterior haya fallado y se haya recuperado.

## Fuera de alcance (explicito)

- Guided/semantic repair (reenviar el output invalido o el motivo de rechazo al modelo en el prompt de recuperacion) — `LLM-R1-T04`.
- Observabilidad nueva (latencia por llamada exitosa, tokens, `finish_reason`) — `LLM-R1-T02` (ver "Siguiente tarea").
- Prompt trimming / prefix caching — tarea separada de la auditoria (P1-2).
- Cambios a `maxModelRetries`, `maxDecisions`, `maxToolExecutions`, `timeoutMs`, `max_tokens`, temperatura o modelo configurado.
- Cambios a Catalog, Carrier, shipping o cualquier otra capability.
- El defecto independiente `catalog_response_mismatch` en `calculateShippingCapability.ts` (documentado en la auditoria, no tocado aqui).

## Validacion ejecutada

- `npm run typecheck` — limpio.
- `npm run lint` — 0 errores (34 warnings preexistentes, ninguno en los archivos de esta tarea).
- `npx tsx --test tests/agent-loop/runAgentToolLoop.test.ts` — 79/79 pass (incluye los 5 tests nuevos y `[PF11]`/`[PF12]` sin regresion).
- `npx tsx --test tests/agent-loop/httpAgentLoopProvider.test.ts` — 23/23 pass (confirma que la politica de reintentos tecnicos del provider no cambio).
- Suite completa (`npm test`, contra MariaDB local real, `infra/docker-compose.dev.yml`): 2842 tests, 2811 pass / 31 fail. Comparado explicitamente contra el mismo baseline sin este cambio (`git stash` de los 2 archivos modificados + re-run completo: 2837 tests, 2804 pass / 33 fail) - el conjunto de fallos es identico salvo 2 tests de concurrencia ya conocidos como flaky (`ACS-R1-05-T06.2 (P2)` y `[P25] a failed publish attempt...`) que fallaron en el baseline y pasaron en esta rama en la misma corrida, consistente con timing/race, no con este cambio. Ninguno de los fallos preexistentes toca `tests/agent-loop/*` ni `runAgentToolLoop.ts` (checksum drift de migracion 025, mocks de transporte WhatsApp, tests de ownership/pilot-isolation del outbox worker - deuda ya documentada en `docs/ACTIVE_RELEASE.md`, no relacionada con el Agent Tool Loop).

## Siguiente tarea recomendada

`LLM-R1-T02 — Provider Observability`: capturar `elapsedMs`/`inputTokens`/`outputTokens`/`finishReason` en toda llamada al provider (exito y fallo, hoy solo se capturan en el camino de fallo y ni siquiera `finishReason` llega a loguearse), y agregar un rollup por turno a `AgentToolLoopCompletedRecordedPayload`. Es el prerrequisito de datos para confirmar o descartar la hipotesis de truncamiento por `max_tokens` (P2-1 de la auditoria) y para el benchmark plan de la seccion 13 de la auditoria.
