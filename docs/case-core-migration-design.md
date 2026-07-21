# Case Core Migration Design

Documento de diseno para TASK-005 y TASK-006. No implementa cambios funcionales, no modifica schema DB y no migra n8n.

## 1. Estado actual detectado

El core de casos ya existe, pero esta repartido entre rutas API, helpers de dominio y vistas legacy:

- Las acciones operativas viven en `lib/caseActions.ts`.
- El estado y timeline se leen desde `lib/cases.ts` y `lib/case-detail.ts`.
- La UI de casos y chats consume `n8n_vw_hub_cases` y fallback legacy de colas operativas.
- La persistencia de respuesta manual escribe en `n8n_conversation_messages` y `n8n_wa_inbound_messages`.
- La auditoria vive en `hub_audit_log`.
- El estado de caso hoy se expresa con una mezcla de `status`, `lifecycle_status`, `requires_human`, `final_action`, `priority`, `bot_replied` y `ai_blocked`.
- El HUB ya tiene acciones server-side para reply, close, reopen, priority y block AI, pero cada ruta resuelve parte del flujo por su cuenta.

## 2. Archivos involucrados

Archivos de logica actual:

- `lib/caseActions.ts`
- `lib/cases.ts`
- `lib/chats.ts`
- `lib/case-detail.ts`
- `lib/audit.ts`
- `lib/write-access.ts`
- `lib/meta.ts`
- `app/api/cases/[id]/reply/route.ts`
- `app/api/cases/[id]/close/route.ts`
- `app/api/cases/[id]/reopen/route.ts`
- `app/api/cases/[id]/priority/route.ts`
- `app/api/cases/[id]/block-ai/route.ts`
- `components/cases/*`
- `components/chats/ChatInbox.tsx`
- `app/(hub)/cases/[id]/page.tsx`
- `app/(hub)/cases/page.tsx`
- `app/(hub)/chats/page.tsx`

Tablas y vistas observadas:

- `n8n_vw_hub_cases`
- `n8n_conversation_cases`
- `n8n_conversation_messages`
- `n8n_wa_inbound_messages`
- `hub_audit_log`

## 3. Comandos de caso existentes

| Comando | Entrada actual | Efecto principal | Persistencia actual |
|---|---|---|---|
| `manualReply` | `POST /api/cases/[id]/reply` | Envía texto por Meta, inserta outbound y actualiza metadata del caso | `n8n_conversation_messages`, `n8n_wa_inbound_messages`, `n8n_conversation_cases`, `hub_audit_log` |
| `closeCase` | `POST /api/cases/[id]/close` | Marca el caso como cerrado | `n8n_conversation_cases`, `hub_audit_log` |
| `reopenCase` | `POST /api/cases/[id]/reopen` | Devuelve el caso a estado de atencion humana | `n8n_conversation_cases`, `hub_audit_log` |
| `changePriority` | `POST /api/cases/[id]/priority` | Cambia prioridad sin tocar el contenido conversacional | `n8n_conversation_cases`, `hub_audit_log` |
| `blockAi` | `POST /api/cases/[id]/block-ai` | Bloquea IA/autorespuesta segun columna disponible | `n8n_conversation_cases`, `hub_audit_log` |

## 4. Problemas actuales

- La logica de negocio, validacion, persistencia y auditoria esta fragmentada en varias capas.
- El estado de caso no tiene un contrato canonico unico; `status` y `lifecycle_status` se usan como parte de la maquina, pero tambien como legado de lectura.
- `manualReply` mezcla reglas de negocio, validacion de ventana WhatsApp, envio a Meta, persistencia DB y auditoria en una sola funcion.
- `blockAi` depende de descubrir la columna disponible en runtime, lo que indica inconsistencia de schema legacy.
- Las rutas API repiten patron de auth, try/catch y audit de error.
- El hub consume aliases de estado distintos en casos, chats y dashboard.
- No existe un envelope estructurado unico para resultados de comando.
- Hoy no hay una capa intermedia que permita introducir transiciones sin romper compatibilidad con `n8n_*`.

## 5. Propuesta de capa `CaseCommandService`

Objetivo: centralizar la ejecucion de comandos de caso sin cambiar schema ni quitar compatibilidad con `n8n_*`.

Responsabilidades:

- Cargar el caso y normalizar su estado actual.
- Validar si el comando esta permitido para el estado actual.
- Aplicar reglas de ventana WhatsApp y bloqueos operativos.
- Ejecutar el write plan sobre tablas legacy.
- Registrar auditoria estructurada.
- Devolver un resultado consistente para las rutas API y futuras capas internas.

Contrato propuesto:

- `execute(command)` o metodos equivalentes por comando.
- Entrada con `caseId`, `commandType`, `payload`, `actorContext`.
- Salida con `ok`, `caseId`, `before`, `after`, `warnings`, `auditAction`, `providerMessageId`, `transition`.

Subcapas internas:

- `CaseStateResolver` para traducir aliases legacy.
- `CaseTransitionValidator` para decidir si un cambio es legal.
- `CaseWriteAdapter` para persistir en `n8n_*`.
- `CaseAuditAdapter` para emitir eventos en `hub_audit_log`.
- `CaseReplyAdapter` para el envio a Meta y el write de mensajes.

## 6. Maquina de estados propuesta

La maquina debe ser canonica a nivel de contrato, aunque siga persistiendo en campos legacy.

Estados canonicos propuestos:

- `open`
- `waiting_human`
- `closed`

Mapeo de aliases legacy:

- `open` <- `active`, `open`, `pending`
- `waiting_human` <- `human_required`, `waiting_human`
- `closed` <- `closed`, `resolved`, `done`

Regla de fondo:

- `status` y `lifecycle_status` se consideran representaciones legacy del mismo contrato de estado.
- `priority`, `requires_human`, `bot_replied`, `final_action`, `ai_blocked` y `whatsapp_window_open` son dimensiones ortogonales, no estados.

## 7. Transiciones permitidas

| Desde | Hacia | Comando o evento |
|---|---|---|
| `open` | `open` | `manualReply`, `changePriority`, `blockAi` |
| `open` | `waiting_human` | handoff humano o escalamiento controlado |
| `open` | `closed` | `closeCase` |
| `waiting_human` | `waiting_human` | `manualReply`, `changePriority`, `blockAi` |
| `waiting_human` | `closed` | `closeCase` |
| `closed` | `waiting_human` | `reopenCase` |

Notas:

- `manualReply` no debe mover por si solo la maquina de estados; solo actualiza el rastro operativo.
- `changePriority` y `blockAi` son comandos ortogonales.
- `reopenCase` no debe volver directo a `open`; debe devolver a `waiting_human` para forzar revision humana.

## 8. Transiciones prohibidas

- `closed -> open` sin un paso intermedio controlado.
- `closed -> manualReply`.
- `closed -> prioridad` como efecto de estado.
- `closed -> blockAi` como cambio de lifecycle.
- `open` o `waiting_human` hacia estados no reconocidos por la maquina canonica.
- Actualizar `status` sin una razon equivalente en `lifecycle_status` o viceversa.
- Introducir nuevos alias de estado sin resolverlos en la capa de normalizacion.

## 9. Estrategia de compatibilidad con `n8n_*`

Lectura:

- Mantener `n8n_vw_hub_cases` como fuente de lectura para listados y detalle.
- Mantener el timeline desde `n8n_conversation_messages` y fallback a `n8n_wa_inbound_messages` donde ya exista.
- Mantener el detalle de colas legacy como referencia compatible, no como contrato canonico.

Escritura:

- Seguir escribiendo en `n8n_conversation_cases` mientras la migracion no termine.
- Seguir insertando outbound en `n8n_conversation_messages` y `n8n_wa_inbound_messages`.
- Seguir escribiendo `hub_audit_log` para trazabilidad operacional.

Compatibilidad de contrato:

- La normalizacion de estado debe vivir en codigo, no en schema nuevo.
- Cualquier nuevo comando debe publicar un envelope estructurado, aunque por debajo siga escribiendo en tablas legacy.
- No remover ni renombrar campos legacy observados por la UI hasta que exista remplazo confirmado.

## 10. Plan de implementacion por PRs pequenas

PR 1:

- Introducir el contrato de `CaseCommandService` y el mapa canonico de estados.
- No cambiar comportamiento.
- No tocar schema.

PR 2:

- Crear una capa servicio que delegue en las funciones actuales.
- Unificar el shape de respuesta y de auditoria.
- Mantener las rutas API sin cambios externos.

PR 3:

- Reemplazar la logica duplicada de cada ruta por el servicio.
- Centralizar validacion de transicion y escritura.
- Mantener compatibilidad con `n8n_*`.

PR 4:

- Introducir tests de transiciones y fixtures de estados legacy.
- Marcar aliases obsoletos y preparar deprecation controlada.

## 11. Riesgos

- Desalineacion entre `status` y `lifecycle_status`.
- Consumidores ocultos que dependan de valores legacy de `status`.
- Schema legacy incompleto para bloqueo de IA.
- Doble escritura parcial en mensajes si Meta responde pero la DB falla.
- Confusion entre comandos de estado y comandos ortogonales como prioridad o bloqueo.
- Aumento de complejidad si la capa servicio replica demasiada logica de transporte.

## 12. Criterios de aceptacion

- Cada comando de caso tiene contrato, validacion y resultado estructurado.
- La maquina de estados tiene estados canonicos, aliases y transiciones documentadas.
- `n8n_*` sigue funcionando como fuente de compatibilidad durante la transicion.
- No se cambia schema DB ni se rompe la preview del HUB.
- La logica de casos queda preparada para migrar a backend propio sin reescribir todo de golpe.
- `docs/ROADMAP.md` queda alineado con el estado real del trabajo de diseno (el `docs/backlog.md` original de este criterio quedo historico en `docs/archive/`).

## 13. Design Review Findings

| Severity | Finding | Evidence | Impact | Recommendation |
|---|---|---|---|---|
| BLOCKER | La maquina de estados canonica no cubre todos los estados legacy ya observados en el repo. | `lib/status.ts` reconoce `open`, `pending`, `waiting_human`, `human_required`, `closed`, `resolved`, `done`; workflows de n8n usan `waiting_customer`; `app/(hub)/cases/[id]/page.tsx` y `lib/caseActions.ts` consideran `closed/resolved/done`, y `tmp/n8n-*` contiene `waiting_customer` y `archived`. | Si se implementa tal cual, se pierde compatibilidad con estados reales que hoy ya circulan en `n8n_conversation_cases` y en workflows legacy. | Ampliar la capa de compatibilidad para incluir al menos `waiting_customer`, `archived` y `rejected/rechazado` como legacy observados o documentar explicitamente su tratamiento. |
| BLOCKER | La propuesta no define con precision la semantica de `waiting_customer`, `waiting_company`, `human_required` y `waiting_human` en transiciones reales. | `waiting_customer` aparece en workflows y queries legacy, `human_required` aparece en UI y codigo actual, pero el documento solo canoniza `open`, `waiting_human` y `closed`. No hay evidencia en el repo de `waiting_company`, pero tampoco una regla para tratarlo como estado desconocido. | Riesgo de romper reply manual, cierre automatico y handoff humano al traducir estados a una maquina demasiado simple. | Definir un mapa formal de alias y estados no canonicos: separar `waiting_customer` de `waiting_human`, tratar `human_required` como alias operativo de handoff y declarar `waiting_company` como estado no verificado hasta encontrar evidencia en DB o exports. |
| IMPORTANT | Falta semantica de idempotencia y concurrencia para comandos de caso. | `manualReply`, `closeCase`, `reopenCase`, `changePriority` y `blockAi` no declaran versionado de fila, lock optimista ni `operation_id`; la documentacion solo habla de resultados estructurados. | Doble click, reintentos HTTP, webhooks concurrentes o ejecuciones paralelas pueden duplicar mensajes, cerrar dos veces o dejar auditoria inconsistente. | Agregar reglas de idempotencia por comando, por ejemplo `operation_id`, comparacion de `updated_at` o control de `affectedRows`, y explicitar comportamiento ante reintentos. |
| IMPORTANT | La doble escritura en `n8n_conversation_messages` y `n8n_wa_inbound_messages` no tiene estrategia de atomicidad ni dedupe. | El documento dice que ambos writes seguiran ocurriendo, pero no define orden, rollback, compensacion ni clave de deduplicacion. | Puede haber outbound insertado en una tabla y no en la otra, o duplicados si el comando se reintenta. | Definir orden de escritura, clave de deduplicacion, politica de retry y criterio de rollback/compensacion antes de centralizar comandos en el servicio. |
| IMPORTANT | Falta estrategia de rollback para volver al comportamiento actual sin deploy adicional grande. | El plan por PRs define migracion progresiva, pero no una via de desactivacion del servicio nuevo por comando o por ruta. | Si una transicion falla en produccion, no hay una ruta clara para volver al handler actual sin revertir toda la serie de PRs. | Introducir rollback por feature flag o adapter switch por comando/ruta, manteniendo el camino legacy disponible durante toda la transicion. |
| IMPORTANT | El plan por PRs es razonable, pero la PR de reemplazo de rutas sigue siendo demasiado amplia. | PR 1 y PR 2 estan bien acotadas; PR 3 propone reemplazar la logica duplicada de cada ruta por el servicio. | Si PR 3 falla, se mezcla el riesgo de reply, close, reopen, priority y block AI en un solo cambio. | Dividir PR 3 por familias de comandos, idealmente reply por un lado y lifecycle/policy por otro, para reducir blast radius y facilitar rollback. |
| NICE_TO_HAVE | Faltan criterios de aceptacion verificables contra inventario real de estados legacy. | La seccion de aceptacion pide contratos y compatibilidad, pero no exige una lista validada de estados observados en DB o exports de n8n. | El diseño podria quedar "correcto en papel" pero desalineado con el set real de estados que ya existen. | Exigir un anexo de inventario de estados observados con evidencia de repositorio o DB antes de pasar a implementacion. |
