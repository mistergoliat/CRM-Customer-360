# AI SDR Scenario Simulator

## Objetivo

El simulador end-to-end ejecuta escenarios sintéticos sobre el autonomous commercial loop para validar, comparar e inspeccionar comportamientos sin DB, sin red, sin Meta y sin scheduler real.

## Relacion con el loop autonomo

El simulador no reimplementa reglas comerciales. Solo consume `AutonomousCommercialLoopInput`, invoca `executeScenario`, reutiliza el runtime in-memory y resume el resultado con snapshots, expectations e invariants.

## Catálogo

Los escenarios cubren reply autonomo, request_more_context, whitelist mismatch, human handoff, complaint block, closed case, AI blocked, retries de transporte, idempotencia, follow-up wait/ready/expire, cancellation, stage replacement y rollback.

## Ejecucion multi-step

Un mismo runtime se conserva entre pasos. Cada step recibe el snapshot anterior y produce un nuevo snapshot, diffs y validaciones. Esto permite modelar secuencias como inbound, reply, schedule follow-up, customer reply y cancellation.

## Expectations e invariants

Las expectations comparan paths cerrados y seguros. Los invariants validan unicidad de acciones, outbox, audit order, side effects nulos, ausencia de leaks y trazabilidad de replacement lineage.

## Safe report

El reporte exportado omite mensajes completos, telefonos completos, tokens, request raw y provider payloads. Solo conserva un resumen seguro, deterministico y apto para UI read-only o evidencia de pruebas.

## UI

La ruta de desarrollo `/dev/ai-sdr-simulator` monta el panel read-only. El selector usa GET, la ejecucion permanece dentro del backend de desarrollo y `execute_fake` queda apagado por defecto salvo flag explicito en boundary.

## Flags

`BRAIN_SCENARIO_SIMULATOR_ENABLED=false`

`BRAIN_SCENARIO_SIMULATOR_ALLOW_EXECUTE_FAKE=false`

## Determinismo

IDs, reportes y diffs se derivan de inputs explicitos. No se usa `Date.now()`, `Math.random()`, `crypto.randomUUID()`, fetch, DB ni timers en el core.

## Limites actuales

No hay persistencia real, no hay scheduler real, no hay Meta real, no hay operator write controls y no hay exportacion a archivos. El simulador existe para aceptacion, inspeccion y comparacion.

## Relacion con P1K

Esta capa valida que el pipeline comercial sea demostrable como sistema y prepara el terreno para la aceptacion final de P1K y el inicio de la fase CRM visual.
