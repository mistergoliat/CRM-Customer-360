---
title: ROADMAP
doc_id: product-roadmap
status: active
version: "2.2.0"
owner: product
last_reviewed: 2026-07-19
source_of_truth_for:
  - roadmap
  - PAUSED_EXTERNAL and DEFERRED external-dependency status vocabulary
  - release lifecycle vocabulary
  - capability operational evidence level vocabulary
depends_on:
  - ./ACTIVE_RELEASE.md
  - ./releases/README.md
  - ./product/MVP_EXECUTION_MAP.md
supersedes: []
tags:
  - product
  - release
---

# ROADMAP

La secuencia ACS es la unica roadmap normativa activa.

## Releases

| Release | Estado | Workstream principal | Workstreams secundarios | Contratos tocados | Integraciones habilitadas | Capabilities entregadas | Gate |
|---|---|---|---|---|---|---|---|
| `ACS-R1-01` | `accepted_with_debt` | Platform & Integrations | Commercial Runtime | Catalog boundary, capability gateway | Catalog HTTP adapter | `search_products`, `get_product_details` | Search/get product details operativos y auditados |
| `ACS-R1-02` | `superseded` | Customer & Identity | Platform & Integrations | Customer Service boundary draft | none independent | none independent | Absorbida por `ACS-R1-04` |
| `ACS-R1-03` | `accepted_with_debt` | Customer & Identity | Operator CRM, Analytics | Customer 360 contract, lifecycle event contract | Customer 360 read model | Customer 360 consolidado | Acceptance de Customer 360 y boundary de lectura |
| `ACS-R1-04` | `active_blocked_external` | Customer & Identity | Commercial Runtime, Platform & Integrations, Operator CRM | Customer onboarding identity, customer creation linking authority, customer service capability, customer service HTTP contract | Customer Service port, native inbound, Customer 360 access gate | identity resolution, onboarding, create/link, customer 360 gate | T08 integracion completa; pendiente smoke contra Customer Service desplegado |
| `ACS-R1-05` | `accepted` | Commercial Runtime | Platform & Integrations | follow-up-decision-policy, customer-lifecycle-event-contract | autonomous-followup-worker, outbox bridge consolidation | follow_up_dispatch_policy, consolidated `crm_agent_actions` writer, hardened worker | follow-up durable, gobernado, recuperable y probado end-to-end contra MariaDB real (cerrado por `ACS-R1-05-T07`, merge PR #57) |
| `ACS-R1-05.1` | `parallel_in_progress` (`critical_path: true`) | Commercial Runtime | Platform & Integrations, Operator CRM | sales-agent-contract (`entityProposals`), follow-up-decision-policy, lead-opportunity-contract, customer-lifecycle-event-contract | WhatsApp real, proveedor LLM real, Catalog Service real, worker de outbox y follow-up supervisados | governed commercial memory (need profile), contextual follow-up, WhatsApp contact suppression, controlled pilot deployment | vendedor autonomo completo validado con un unico `wa_id` allowlisted: memoria persistente, oportunidad estable, follow-up contextual, opt-out, handoff |
| `ACS-R1-06` | `planned` | Platform & Integrations | Commercial Runtime | Policy and authority contracts | Business policy | Business policy | Piloto controlado (`ACS-R1-05.1`) aceptado |
| `ACS-R1-07` | `planned` | Quotes & Transactions | Operator CRM, Commercial Runtime | Quote, catalog, order contracts | Quote flow | Quote creation and persistence | Catalog, customer context, policy y piloto controlado listos |
| `ACS-R1-08` | `planned` | Operator CRM | Commercial Runtime | Operator readiness contracts | Operator controls | Operator readiness | Execution trace, approvals y supervision listos |
| `ACS-R1-09` | `deferred` | Voice | Platform & Integrations | Voice contract | Voice initiation | Voice outcomes and transcription linkage | Consent, authority y outcomes listos |
| `ACS-R2` | `planned` | Quotes & Transactions | Voice, Platform & Integrations | Transactional contracts | Transactional integrations | Transactional capabilities | Gating transaccional completo |

## Deferred capabilities / future_release_not_scheduled

Capacidades sin release ACS activa asignada. No compiten por secuencia con `ACS-R1-04`/`ACS-R1-05`; se retoman cuando su gate de reanudacion se cumpla.

| Capacidad | Owner | Motivo | Reanudar antes de |
|---|---|---|---|
| Address Book + address confirmation | Customer & Identity | Sin release ACS asignada tras la reasignacion de `ACS-R1-05` a Autonomous Follow-up Runtime; no bloquea el SDR autonomo ni el follow-up | shipping, checkout, creacion de pedidos, seleccion/confirmacion de direccion |

## Dependencias externas y capacidades en pausa

`ROADMAP.md` es la fuente normativa para los estados `PAUSED_EXTERNAL` y `DEFERRED`. `docs/ACTIVE_RELEASE.md`, `docs/product/MVP_EXECUTION_MAP.md` y las auditorias enlazan o resumen esta seccion; no la duplican.

### `PAUSED_EXTERNAL`

Una dependencia esta `PAUSED_EXTERNAL` cuando el bloqueo es enteramente externo al repositorio (endpoint, contrato, credenciales o entorno no disponibles) y no bloquea workstreams independientes.

- **Customer Service** (bloquea `ACS-R1-04`): no estan disponibles el endpoint, contrato real, credenciales, OpenAPI/Postman ni detalles operacionales del servicio unificador de clientes. Pendiente al reanudar: validar `resolve_customer`, `create_customer`, `link_external_identity`; confirmar que retorna `master_customer.id` como `customerMasterId`; validar autenticacion, idempotencia y manejo de sincronizacion parcial entre plataformas; ejecutar smoke operacional de `ACS-R1-04-T08`. Impacto: `ACS-R1-04-T08` continua bloqueada; `ACS-R1-04-T09` no puede cerrar la release; **no bloquea `ACS-R1-05` (Autonomous Follow-up Runtime) ni otros workstreams independientes**. No se declara que Customer Service deba construirse desde cero - existe un posible endpoint unificador externo que debera auditarse cuando este disponible.

### `DEFERRED`

Una capacidad esta `DEFERRED` cuando no pertenece al camino critico del MVP autonomo actual.

- **Address Book + address confirmation**: ver tabla "Deferred capabilities" arriba. No bloquea el SDR autonomo ni el follow-up. Administra multiples direcciones, destinatarios y confirmacion de direccion; no es el Customer Master. Reanudar antes de: shipping; checkout; creacion de pedidos; seleccion o confirmacion de direccion.
- **Voice** (`ACS-R1-09`): no pertenece al camino critico del MVP autonomo por WhatsApp. Reanudar despues de: conversacion autonoma estable; follow-up productivo; cancelacion por respuesta; outbox y delivery verificados; piloto real por WhatsApp.

Estado tecnico real del runtime de follow-up (que existe, que esta conectado, gaps): [Follow-up runtime reconciliation](audits/follow-up-runtime-reconciliation.md).

## Camino critico al piloto controlado

`ACS-R1-05.1`: `status: parallel_in_progress`, `critical_path: true`, `current_task: ACS-R1-05.1-T01`, `current_task_status: planned`. Estos son campos separados, no un status compuesto: el lifecycle de la release (`parallel_in_progress`, ver "Release lifecycle" abajo) no cambia por ser el camino critico; `critical_path: true` es una bandera aparte que declara que este es el camino activo hacia el primer vertical conversacional operativo. `ACS-R1-04` no bloquea este camino: permanece `active_blocked_external` (unica release secuencial activa en el sentido de `AGENTS.md`) solo por Customer Service externo, y esa dependencia no pertenece hoy al camino critico del primer vertical conversacional por WhatsApp (aunque sigue siendo necesaria para identidad canonica, onboarding completo y operaciones transaccionales futuras).

```text
ACS-R1-05
Autonomous Follow-up Runtime foundation (accepted)
  |
  v
ACS-R1-05.1
Persistent Commercial Memory
  |
  v
Controlled WhatsApp Pilot (gate: ver "Controlled pilot gate" abajo)
  |
  v
ACS-R1-06
Business Policy (planned, despues del piloto)
  |
  v
ACS-R1-07
Quote (planned)
```

`ACS-R1-06` (Business Policy) y `ACS-R1-07` (Quote) no son trabajo anterior al piloto: ambas quedan `planned` despues de que `ACS-R1-05.1` acepte el piloto controlado.

## Controlled pilot gate

`ACS-R1-05.1-T09` (Customer-visible UAT) no cierra sin que las siguientes condiciones esten declaradas y evidenciadas — spec completa en [ACS-R1-05.1](releases/ACS-R1-05.1-persistent-commercial-memory-controlled-whatsapp-pilot.md):

- **canal**: WhatsApp (Meta real), unico canal del piloto;
- **identidad operacional**: `wa_id` (identidad provisional, nunca un customer master record definitivo);
- **allowlist**: un unico `wa_id` real autorizado, aplicada antes de cualquier LLM/DB (patron ya usado por `ACS-R1-05-T06.1`);
- **modelo**: proveedor LLM real, no simulador ni shadow;
- **catalogo**: Catalog Service real, no HTTP double;
- **memoria**: oportunidad, need profile, productos considerados y objeciones persistidos y recuperables entre turnos;
- **oportunidad**: continuidad estable frente a cambio de intencion (`ACS-R1-05.1-T02`);
- **follow-up**: contextual, no generico, con cancelacion por respuesta y quiet hours vigentes;
- **opt-out**: fuente de verdad propia, cero outbound posterior;
- **handoff**: IA detenida bajo ownership humano, verificado en el piloto;
- **outbox**: writer canonico unico, worker supervisado;
- **workers**: outbox y follow-up supervisados, con health checks y restart automatico;
- **restart**: recuperacion sin duplicar ni perder envios (extiende la cobertura de `ACS-R1-05-T07`);
- **kill switches**: independientes por worker/capacidad;
- **UAT**: las tres conversaciones de `ACS-R1-05.1-T09` (principal, opt-out, recuperacion) ejecutadas contra el `wa_id` real;
- **evidencia**: transcripts o logs estructurados reales, nunca solo tests unitarios o mocks (ver "Operational evidence levels" abajo).

## Carried release debt

Deuda que otra release entrega y que `ACS-R1-05.1` recibe explicitamente, sin ocultarla ni tratarla como resuelta:

| Origen | Deuda | Impacto | Release de cierre |
|---|---|---|---|
| `ACS-R1-01` | configuracion/catalogo real (`search_products`/`get_product_details`/`batch_get_products` siguen `operational: not_verified` contra un Catalog Service real) | recomendacion real sin smoke operacional | `ACS-R1-05.1` |
| `ACS-R1-04` | Customer Service externo (`PAUSED_EXTERNAL`) | identidad canonica y transacciones futuras | permanece bloqueada externamente; no cierra en `ACS-R1-05.1` |
| `ACS-R1-05` | follow-up sin memoria comercial completa | seguimiento no suficientemente contextual | `ACS-R1-05.1` |
| Commercial Runtime | doble writer potencial (`sales-consultative` legacy vs. runtime nativo) | oportunidades divergentes | `ACS-R1-05.1` |
| Commercial Runtime | continuidad de oportunidad no probada frente a cambio de intent | fragmentacion de memoria | `ACS-R1-05.1` |
| Follow-up Policy | opt-out sin productor durable propio | contacto comercial indebido | `ACS-R1-05.1` |
| Platform | workers sin despliegue reproducible verificado | indisponibilidad operacional | `ACS-R1-05.1` |

## Release lifecycle vs. Operational evidence levels

Dos vocabularios distintos, deliberadamente separados y nunca conflados. El primero describe el ciclo de vida de una release ACS completa; el segundo describe el estado real de una capacidad o pieza de infraestructura dentro de una release. Una release puede estar `accepted` mientras alguna de sus capacidades individuales sigue en `not_verified`/`connected` en `CAPABILITY_MATRIX.md` (ver `ACS-R1-05`, que cierra `accepted` con Meta/LLM/Catalog Service todavia `not_verified`) — eso no es una contradiccion, es la razon por la que existen dos vocabularios.

### Release lifecycle

Estado del ciclo de vida de una release ACS completa (columna "Estado" de la tabla de arriba y de `docs/releases/README.md`):

- **`planned`**: descrita en un documento, sin trabajo iniciado.
- **`parallel_in_progress`**: workstream autorizado a avanzar en paralelo a la release secuencial activa (ver `docs/releases/README.md`); puede o no llevar `critical_path: true` como campo separado.
- **`active_blocked_external`**: la unica release secuencial activa en el sentido de `AGENTS.md`, bloqueada exclusivamente por una dependencia externa (ver `PAUSED_EXTERNAL` arriba).
- **`accepted`**: la release cumplio su alcance y su Definition of Done.
- **`accepted_with_debt`**: la release cumplio su Definition of Done, pero conserva deuda no bloqueante perteneciente a su propio alcance (no deuda heredada de otra release, que se registra en "Carried release debt").

`superseded` y `deferred` (ver tabla de Releases y "Dependencias externas y capacidades en pausa" arriba) tambien son valores de este eje, para releases absorbidas por otra o fuera del camino critico actual.

### Capability operational evidence

Niveles diferenciados para describir el estado real de una capacidad o pieza de infraestructura, independientes del lifecycle de la release que la contiene. Ningun documento de este repositorio puede declarar `verified_real` solo porque existen tests unitarios, mocks, tablas o codigo — esos artefactos alcanzan como maximo `implemented` o `connected`. `CAPABILITY_MATRIX.md` mantiene su propio eje `Operational` (`verified`/`pending_smoke_test`/`connected`/`planned`/`not_verified`) para cada capability row; esta lista es un modelo de madurez mas amplio, pensado para describir infraestructura de piloto (workers, despliegue) que una fila de capability individual no cubre.

- **`implemented`**: codigo existe y compila/pasa tests puros o con dobles (mocks/fakes), sin conexion end-to-end confirmada.
- **`connected`**: conectada a su runtime real (ej. registrada en el Capability Gateway, invocada desde el ciclo autonomo), probada contra una base de datos real o un doble HTTP fiel al contrato — no contra el sistema externo real.
- **`enabled`**: el flag/config que la activa en produccion esta encendido y su contrato de arranque fail-closed esta verificado, sin que necesariamente haya trafico real todavia.
- **`deployed`**: el servicio/worker que la ejecuta corre en un entorno reproducible (piloto o produccion), con logs y health checks, sin necesariamente haber procesado trafico real.
- **`verified_real`**: ejecutada al menos una vez contra el sistema externo real (Meta real, LLM real, Catalog Service real, Customer Service real), con evidencia (transcript, log estructurado o smoke test) que un humano puede auditar.

## Criterios generales

- Entrada: la release especifique alcance, dependencias, ADR y contratos aplicables.
- Salida: la release cierre su tarea activa, deje evidencia y solo entonces habilite la siguiente.
- El roadmap no define tareas ni contratos de bajo nivel.
- Los workstreams no crean roadmaps paralelos.
- P1/P2/P3 son etiquetas historicas y no gobiernan la secuencia actual.
