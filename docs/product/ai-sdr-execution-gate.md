# AI SDR Execution Gate

## Objetivo

Este contrato define un execution gate agnostico de storage para convertir una accion elegible en una intencion de ejecucion persistible.

No ejecuta mensajes reales. No llama Meta. No crea worker. No crea scheduler. No escribe SQL directo.

## Diferencia entre gate, outbox y worker

- `Execution Gate`: decide si una accion puede pasar a comando canónico.
- `Outbox`: almacena la intencion de envio en forma persistible e idempotente.
- `Worker`: consumira el outbox en un milestone futuro para enviar realmente.

El gate decide y persiste intencion.
El worker envia.
`P1K-012F-A` define el worker puro y determinista que consumira esa cola sin mezclar la logica de decision del gate ni el envio real.
`P1K-012F-B` define el adapter de transporte WhatsApp que vive debajo del worker, traduce el comando canonico a request de proveedor y sigue sin llamar Meta directamente.

## Arquitectura storage-agnostic

El core depende de interfaces, no de clientes SQL:

- `AgentActionRepository`
- `OutboxRepository`
- `ExecutionUnitOfWork`

Esto permite probar el contrato con adapters in-memory antes de implementar MariaDB, PostgreSQL o Supabase.

## Lifecycle

Flujo esperado:

```text
CrmAgentAction
-> Sandbox Eligibility
-> Execution Gate
-> Canonical Outbox Command
-> Repository Transaction
-> Future Worker
-> Future Meta Send
```

Estados permitidos para esta etapa:

- `proposed`
- `approved`
- `planned`

The execution gate only receives actions that have already been declared ready by the follow-up scheduling decision engine or that remain approved/planned candidates after that check.
If a follow-up action needs cancellation, expiration, blocking or replanning, that work is described earlier by the follow-up cancellation and replanning contract, not by the gate itself.

Transiciones permitidas para el gate:

- `proposed -> planned`
- `approved -> planned`

No se permite ir directamente a `executed`.

## Idempotencia

La clave idempotente canonica se deriva de la accion y su clave original.

Casos cubiertos:

- retry con la misma clave -> duplicate;
- outbox existente -> duplicate;
- accion ya vinculada a outbox -> duplicate;
- action row faltante -> invalid o duplicate segun la evidencia observada.

## Transaccion

Dentro del unit of work:

```text
insert outbox
-> mark action planned
```

Si el update falla, la implementacion real debe hacer rollback.
La implementacion in-memory simula ese comportamiento para tests.

## Sandbox

El gate reevalua la elegibilidad sandbox antes de construir el comando.

El sandbox sigue siendo solo preview read-only.
La whitelist existe solo para pruebas controladas y no es arquitectura permanente.

## Action types soportados

Solo se soportan:

- `send_whatsapp_reply`
- `request_more_context`

Todavia no se soportan:

- `schedule_followup`
- `prepare_quote_draft`
- `take_over_case`
- `create_internal_task`
- `mark_lost_candidate`
- `pause_ai`

## Seguridad

El gate bloquea o degrada por:

- riesgo alto;
- approval no satisfecha;
- humano activo;
- AI bloqueada;
- caso cerrado;
- idempotency faltante;
- mensaje inseguro;
- conflicto con otra accion;
- expiracion;
- lifecycle invalido.

No contiene:

- tokens;
- headers;
- payload Meta;
- credenciales;
- SQL.

## Por que no llama Meta

Meta debe quedar fuera del gate.

Este contrato solo prepara el comando canónico y la persistencia transaccional. El envio real queda para un worker posterior.

## Relacion futura con MariaDB

MariaDB podra implementar los repositorios reales cuando exista el adapter de storage correspondiente.

El core no debe importar `mysql2` ni escribir SQL.

## Relacion futura con PostgreSQL / Supabase

La misma interfaz permite implementar adapters alternativos sin cambiar el core.

Eso evita acoplar el gate a una base especifica.

## Persistence decision

P1K-012D-B cierra la decision de persistencia para el nuevo brain:

- MariaDB queda para el legado de casos y mensajes durante P1.
- PostgreSQL/Supabase queda como destino del brain operativo nuevo.
- `P1K-012D-C` implementara los repository adapters del motor elegido.
- No hay dual-write no coordinado para la misma entidad.

P1K-012E-A and P1K-012E-B stay earlier in the chain: first decide the scheduling state, then describe the mutation plan.
`P1K-012F-A` sits after the gate and before any live send: it classifies transport outcomes and lease semantics, but still does not call Meta.
`P1K-012F-B` sits below that worker as the provider-specific transport adapter. It validates the WhatsApp command, builds the request and keeps the HTTP client boundary injectable.

## Criterios para P1K-012D-C

P1K-012D-C queda listo cuando exista al menos un adapter real de storage y la transaccion preserve:

- idempotencia;
- rollback;
- link entre action y outbox;
- observabilidad;
- ausencia de send real.

## Criterios para live test

Antes de cualquier live test:

- gate y bridge deben estar activados de forma explicita;
- el worker debe seguir separado;
- debe existir audit persistente;
- no debe haber numeros reales en logs o previews;
- el rollout debe ser acotado y reversible.
## P1K-012G

The autonomous commercial loop uses the execution gate as one stage in the broader in-memory pipeline. The gate still owns eligibility and block reasoning.

## P1K-012H

The scenario simulator reuses the execution gate outcome inside synthetic runs. It does not bypass gate logic and does not introduce live writes.
