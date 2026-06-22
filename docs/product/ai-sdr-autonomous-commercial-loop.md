# AI SDR Autonomous Commercial Loop

## Objetivo

`P1K-012G` conecta los contratos comerciales existentes en un unico orquestador puro. Su funcion es tomar un contexto comercial canonicamente estructurado y producir una ejecucion simulada o in-memory del loop completo sin DB real, sin HTTP real y sin Meta real.

## Pipeline

```text
context
→ opportunity
→ decision
→ action
→ sandbox
→ execution gate
→ outbox
→ worker
→ transport
→ delivery reconciliation
→ follow-up scheduling
→ follow-up replanning
→ audit
```

## Modos

### observe

Genera preview de oportunidad, decision y action. No crea outbox en memoria, no llama transporte y no aplica mutaciones.

### simulate

Ejecuta todo el pipeline logico y devuelve los mismos contratos que `execute_fake`, pero sin aplicar cambios en memoria ni invocar el fake transport.

### execute_fake

Ejecuta la ruta completa en memoria. Crea outbox, procesa worker, usa transporte fake, reconcilia delivery y aplica planes de follow-up sin efectos reales.

## Runtime in-memory

El runtime conserva:

* opportunities
* decisions
* actions
* outbox
* delivery results
* follow-up mutation plans
* audit events
* processed correlation IDs
* processed provider message IDs

Tambien soporta snapshots y rollback por aislamiento de la operacion at atomica.

## Idempotencia

El mismo `correlationId`, `providerMessageId` y estado inicial producen el mismo resultado. El runtime corta duplicados antes de reejecutar el pipeline.

## Reconciliacion de delivery

* `delivered` -> action `executed`
* `retry_scheduled` -> action permanece `planned`
* `dead_letter` -> action `failed`
* `expired` -> action `expired`

## Follow-up

La ruta de follow-up consume `FollowUpSchedulingResult` y produce un `FollowUpMutationPlan`:

* `wait` -> sin cambios logicos
* `ready` -> sin cambios logicos
* `cancel` -> cancelacion logica
* `expire` -> expiracion logica
* `block` -> bloqueo logico
* `replan` -> replanificacion in-place o replacement

Si la accion deriva de un reply inmediato y el inbound posterior invalida el contexto, el loop cancela el follow-up y no envia nada.

## Atomicidad

`execute_fake` aplica todo en memoria de forma at atomica. Si una etapa falla, el runtime no conserva estados parciales fuera del resultado retornado.

## Auditoria

Cada corrida produce eventos canonicamente estructurados sin incluir:

* cuerpo completo del mensaje
* telefono completo
* token
* raw request
* raw response
* stack trace

## Fixtures

Se incluyen fixtures deterministicas para:

* low risk reply
* request more context
* human handoff
* complaint blocked
* customer reply cancels follow-up
* temporary transport failure
* rate limited transport
* permanent transport failure
* duplicate inbound
* duplicate execution
* closed case
* AI blocked
* opportunity won

## Limites actuales

Este loop no reemplaza:

* scheduler runtime real
* DB real
* WhatsApp real
* delivery webhook reconciliation real
* operator write controls

## Relacion con P1K-012H

`P1K-012H` deberia convertir este orquestador en simulador de escenarios end-to-end con ramas reproducibles y checks de cobertura por pipeline.

## Relacion con persistencia futura

La version actual mantiene toda la ejecucion en memoria. La persistencia real queda para adapters posteriores y no cambia el contrato del loop.

## Relacion con P1K-012H

`P1K-012H` monta un simulador end-to-end sobre este loop y lo usa como orquestador de escenario. No cambia reglas de negocio ni agrega efectos externos.
