---
release: ACS-R1-05.1
title: Persistent Commercial Memory + Controlled WhatsApp Pilot
doc_id: release-acs-r1-05-1-persistent-commercial-memory-controlled-whatsapp-pilot
status: parallel_in_progress
critical_path: true
updated_at: 2026-07-20
current_task: ACS-R1-05.1-T02.1
current_task_status: planned
next_task: ACS-R1-05.1-T03
blocked: false
owner: product
source_of_truth_for:
  - ACS-R1-05.1 release scope
  - ACS-R1-05.1 task queue
  - ACS-R1-05.1 definition of done
  - controlled WhatsApp pilot gate
depends_on:
  - ../ACTIVE_RELEASE.md
  - ../ROADMAP.md
  - ../product/MVP_EXECUTION_MAP.md
  - ../CAPABILITY_MATRIX.md
  - ./ACS-R1-05-autonomous-follow-up-runtime.md
  - ../audits/follow-up-runtime-reconciliation.md
  - ../product/autonomous-commerce-prd.md
  - ../product/autonomous-commerce-first-vertical.md
  - ../product/autonomous-commerce-state-model.md
  - ../product/sales-agent-contract.md
  - ../product/follow-up-decision-policy.md
  - ../product/lead-opportunity-contract.md
  - ../data/customer-lifecycle-event-contract.md
supersedes: []
tags:
  - release
  - product
---

# ACS-R1-05.1 - Persistent Commercial Memory + Controlled WhatsApp Pilot

## Estado

`status: parallel_in_progress`, `critical_path: true`, `current_task: ACS-R1-05.1-T02.1`, `current_task_status: planned`. `ACS-R1-05.1-T01` (Single Commercial Runtime Authority) esta `accepted`: veredicto exacto `single_commercial_runtime_authority_accepted`. El runtime nativo (`processNativeWhatsAppInbound -> runNativeAutonomousCycle -> operational-loop -> persistCommercialState`) queda como unica autoridad comercial habilitada por defecto; el motor legacy `sales-consultative` queda deshabilitado por defecto (fail-closed) detras de `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED`. Ver "Evidencia de cierre - ACS-R1-05.1-T01" abajo para el detalle completo. `ACS-R1-05.1-T02` (Stable Opportunity Continuity) esta `accepted`: veredicto exacto `stable_opportunity_continuity_accepted`. Ver "Evidencia de cierre - ACS-R1-05.1-T02" abajo. Ninguna otra tarea de esta release ha comenzado su implementacion. Ningun capability row de `CAPABILITY_MATRIX.md` cambia como resultado de este documento.

`parallel_in_progress` (release lifecycle) y `critical_path: true` son campos separados, no un status compuesto: `ACS-R1-05.1` no es una segunda release "activa" en el sentido secuencial de `AGENTS.md` compitiendo con `ACS-R1-04` (`active_blocked_external`, unica release activa en ese sentido). Es, igual que lo fue `ACS-R1-05`, un workstream autorizado a avanzar en paralelo porque no depende del Customer Service externo (`PAUSED_EXTERNAL`, ver `ROADMAP.md`) — con la diferencia de que, a partir de este documento, `critical_path: true` porque es explicitamente el camino hacia el piloto conversacional, no una excepcion acotada al follow-up.

## Objetivo

Convertir las capacidades tecnicas ya construidas y aceptadas (`ACS-R1-01`, `ACS-R1-03`, `ACS-R1-05`) en un vendedor autonomo persistente por WhatsApp, y demostrar el ciclo comercial completo (memoria durable, oportunidad estable, follow-up contextual, opt-out, handoff) con un unico numero real allowlisted (`wa_id`).

## Problema que resuelve

El repositorio ya contiene runtime de identidad provisional, oportunidad, perfil de necesidad, decisiones, acciones, outbox y follow-up endurecido (`ACS-R1-05`), pero ninguna release tiene como gate la demostracion conjunta de esas capacidades frente a un cliente real: vendedor persistente, memoria comercial durable y recuperable, recomendacion grounded en catalogo real, objeciones persistentes, follow-up contextual (no generico), opt-out con autoridad propia, handoff humano, workers supervisados, WhatsApp real, modelo real y catalogo real, validados con un `wa_id` real. `ACS-R1-05.1` cierra exactamente esa brecha.

## Contexto

- `ACS-R1-01` entrego `search_products`/`get_product_details` (`accepted_with_debt`) contra el Capability Gateway; `batch_get_products` (`ACS-R1-05-T06.2`) los complementa para ranking por presupuesto. Ninguno tiene un smoke verificado contra el Catalog Service real.
- `ACS-R1-03` entrego Customer 360 como read model (`accepted_with_debt`), consumido por el ciclo autonomo via `autonomous_customer_context` (`ACS-R1-04-T05`), sin operational smoke.
- `ACS-R1-04` (Customer Identity Resolution + Onboarding) permanece `active_blocked_external`: bloqueada unicamente por la falta de un Customer Service desplegado contra el cual ejecutar el smoke operacional de `ACS-R1-04-T08`. Esa release no se toca ni se cierra por este documento.
- `ACS-R1-05` (Autonomous Follow-up Runtime) cerro con `ACS-R1-05-T07` (`done, accepted`): planner unico, dispatch policy gobernada, worker endurecido (stale-lock recovery, retry, `max_attempts`), outbox consolidado, continuidad de turno reactivo, y validacion E2E de restart/concurrencia contra MariaDB real. Su deuda explicita — nunca oculta — es que el follow-up todavia no esta conectado a una memoria comercial completa y validada frente a un cliente real, y que ningun componente del ciclo fue verificado contra Meta/LLM/Catalog Service reales.
- Ninguna release ACS anterior tuvo como Definition of Done un piloto real con un `wa_id` allowlisted. `ACS-R1-05.1` formaliza ese gate.

## Relacion con ACS-R1-04 y ACS-R1-05

- **ACS-R1-04**: conserva su estado (`active_blocked_external`) y su bloqueo (Customer Service externo, `PAUSED_EXTERNAL`). `ACS-R1-05.1` no depende de que `ACS-R1-04-T08`/`T09` cierren, igual que `ACS-R1-05` no dependio de ello. `ACS-R1-05.1` sigue operando sobre identidad provisional (`wa_id`, `customer_external_identity`, la tabla `master_customer` ya existente) — ver `docs/product/provisional-customer-remediation.md` y la seccion "Customer 360 provisional" de `AGENTS.md`/`CLAUDE.md` — nunca sobre un customer master record definitivo, que todavia no existe.
- **ACS-R1-05**: conserva su identidad historica y su cierre (`accepted`, `ACS-R1-05-T07`). Ninguna tarea de `ACS-R1-05.1` reabre, reescribe o revierte una decision ya aceptada de `ACS-R1-05` (planner, dispatch policy, worker, outbox consolidado). `ACS-R1-05.1` extiende ese runtime con memoria comercial persistente y lo valida contra un piloto real; no lo sustituye.

## Actores beneficiados

- **Cliente final**: recibe respuestas consistentes con lo ya conversado, sin repetir informacion, y puede detener el contacto comercial de forma efectiva (opt-out) o pedir un humano (handoff).
- **Operador comercial humano**: puede tomar ownership de una conversacion sabiendo que la IA se detiene, y ve memoria comercial durable (no solo mensajes) en el Hub.
- **Producto/negocio**: obtiene la primera evidencia end-to-end de que el vendedor autonomo funciona con un cliente real, antes de invertir en Business Policy o Quote.
- **Ingenieria**: obtiene un runtime con un unico writer comercial, sin runtimes paralelos, como base para las releases siguientes.

## Alcance

Cada item pertenece a una tarea de la seccion "Tareas".

- runtime nativo de WhatsApp como unica autoridad comercial (elimina doble writer productivo hacia `crm_opportunities`);
- continuidad estable de una oportunidad durante una misma compra frente a cambios normales de intencion conversacional;
- persistencia de perfil de necesidad, requerimientos, productos considerados y ciclo de vida de objeciones;
- consumo gobernado de propuestas estructuradas del Sales Agent (`entityProposals`) para oportunidad y, si el contrato actual no alcanza, una variante tipada para `need_profile`;
- persistencia atomica de memoria comercial por turno, recuperable en turnos posteriores;
- follow-up contextual que reconstruye memoria comercial real (no un mensaje generico), preservando cancelacion por respuesta, quiet hours, lifecycle, intentos maximos, CAS y restart recovery ya entregados por `ACS-R1-05`;
- reglas de progreso y anti-loop (una pregunta discriminante por turno, no repetir preguntas ya respondidas ni recomendaciones rechazadas sin nueva estrategia);
- supresion de contacto comercial por WhatsApp (opt-out) con una autoridad propia, minima, durable — nunca solo `crm_opportunities.signals_json`;
- handoff humano y bloqueo de IA durante ownership humano (ya parcialmente entregado, validado end-to-end en el piloto);
- despliegue piloto reproducible: WhatsApp real, proveedor LLM real, catalogo real, base de datos real, workers de outbox y follow-up supervisados, allowlist de un unico `wa_id`, kill switches, logs, health checks, restart automatico, rollback;
- evidencia visible en el Hub y UAT con un numero real allowlisted.

## Exclusiones

Fuera de alcance de `ACS-R1-05.1`. Ninguna de estas exclusiones es un gap P0 de esta release ni bloquea su cierre:

- Instagram, Facebook Messenger, Gmail, omnicanalidad;
- configuracion de proveedores/modelos desde el Hub;
- cotizacion formal, checkout, pago, creacion de pedidos (`ACS-R1-07`);
- marketing masivo / `marketing_contact_policy` (fuera del MVP actual, ver `MVP_EXECUTION_MAP.md`);
- Customer Service productivo / cierre de `ACS-R1-04` (permanece bloqueada externamente, no es parte de este piloto);
- Address Book (`DEFERRED`, ver `ROADMAP.md`);
- promociones, voz (`ACS-R1-09`, `DEFERRED`), analytics avanzado.

La arquitectura de esta release no queda bloqueada por estas exclusiones: ninguna de ellas es un prerequisito tecnico del piloto conversacional WhatsApp-only.

## Invariantes

- Un unico runtime productivo puede escribir estado comercial (`T01`).
- Un mismo camino comercial (misma compra/necesidad) reutiliza la misma oportunidad; una oportunidad nueva corresponde a una compra, necesidad o proyecto independiente, nunca solo a una etiqueta de intencion distinta (`T02`).
- El modelo propone, el backend valida, el dominio decide, la persistencia ejecuta — ninguna propuesta del Sales Agent se aplica sin whitelist de campos, evidencia, confidence e idempotency hint (`T03`).
- Un turno comercial se persiste completo o no se persiste nada (`T04`); `persistCommercialState` sigue siendo el unico escritor de los arrays de `crm_opportunities` — no se agrega un segundo writer para requirements/missing requirements/product interests/objections/signals.
- El follow-up demuestra memoria comercial, no solo scheduling (`T05`).
- Cada turno produce progreso comercial verificable o una salida explicita (nuevo dato, cambio de perfil, producto evaluado, objecion, recomendacion, accion, espera, handoff o cierre) (`T06`).
- Cero outbound comercial posterior a un opt-out valido (`T07`).
- El entorno piloto se puede recrear desde documentacion y configuracion versionada, sin secretos expuestos (`T08`).

## Riesgos

- **Disponibilidad de dependencias externas reales**: LLM real, Catalog Service real y Meta WhatsApp real pueden no estar disponibles o ser inestables durante el piloto — mitigacion: continuidad ante fallas ya entregada por `ACS-R1-05-T07` (fallback seguro, sin turnos perdidos por fallos internos).
- **Fragmentacion de memoria por regresion de continuidad**: un cambio de intencion mal clasificado podria crear una oportunidad duplicada — mitigacion: `T02` define el escenario obligatorio y el gate "same commercial path reuses same opportunity".
- **Autoridad de opt-out incompleta**: si la supresion queda solo en `crm_opportunities.signals_json`, un follow-up programado antes del opt-out podria ejecutarse igual — mitigacion: `T07` exige una fuente de verdad propia por `channel`/`channel_account_id`/`external_contact_id`.
- **Doble writer productivo no detectado**: si `n8n` u otro sistema sigue invocando `process-inbound` en paralelo al runtime nativo, la memoria comercial diverge — mitigacion: `T01` audita callers reales antes de declarar autoridad unica y, si esos callers no pueden confirmarse de forma concluyente, deshabilita por defecto (fail-closed) el writer legacy en vez de asumir que no se usa.
- **Alcance de piloto expandiendose a Quote/checkout**: presion de negocio para adelantar transaccionalidad durante el piloto — mitigacion: exclusiones explicitas de esta release, `ACS-R1-06`/`ACS-R1-07` quedan despues.
- **Despliegue de workers no reproducible**: sin procedimiento versionado, el piloto no puede recrearse ni tener rollback confiable — mitigacion: `T08` exige documentacion y configuracion versionada como Definition of Done, no solo codigo.
- **Sobreestimar evidencia como verificacion real**: tests unitarios, mocks o tablas no son `operational: verified` — mitigacion: seccion "Operational evidence levels" en `ROADMAP.md` y regla de no invencion (seccion "Deuda no cerrada" abajo).

## Tareas

| ID | Tarea | Estado | Dependencias | Gate |
| -- | ----- | ------ | ------------ | ---- |
| ACS-R1-05.1-T01 | Single Commercial Runtime Authority | accepted | — | Solo un runtime productivo puede escribir estado comercial |
| ACS-R1-05.1-T02 | Stable Opportunity Continuity | accepted | ACS-R1-05.1-T01 | Same commercial path reuses same opportunity |
| ACS-R1-05.1-T03 | Governed Commercial Memory Proposals | planned | ACS-R1-05.1-T01 | El modelo propone, el backend valida, el dominio decide, la persistencia ejecuta |
| ACS-R1-05.1-T04 | Atomic Commercial Memory Persistence | planned | ACS-R1-05.1-T02, ACS-R1-05.1-T03 | Se persiste todo el turno o no se persiste nada |
| ACS-R1-05.1-T05 | Contextual Follow-up | planned | ACS-R1-05.1-T04 | El follow-up demuestra memoria comercial, no solo scheduling |
| ACS-R1-05.1-T06 | Progress and Anti-loop Policy | planned | ACS-R1-05.1-T04 | Cada turno produce progreso comercial o una salida explicita |
| ACS-R1-05.1-T07 | WhatsApp Contact Suppression | planned | ACS-R1-05.1-T01, ACS-R1-05.1-T03, ACS-R1-05.1-T04 | Cero outbound comercial posterior al opt-out; `additive_migration_required` |
| ACS-R1-05.1-T08 | Controlled Pilot Deployment | planned | ACS-R1-05.1-T01 a T07 | El entorno piloto puede recrearse desde documentacion y configuracion versionada |
| ACS-R1-05.1-T09 | Customer-visible UAT | planned | ACS-R1-05.1-T08 | Memoria durable, cero preguntas repetidas, recomendacion grounded, opt-out y handoff correctos, sin duplicados, sin turnos perdidos por fallos internos |
| ACS-R1-05.1-T10 | Acceptance and Roadmap Reconciliation | planned | ACS-R1-05.1-T09 | Auditoria de aceptacion, evidencia real, roadmap/capability matrix/active release reconciliados |
| ACS-R1-05.1-T02.1 | Grounded Catalog and Commercial Knowledge Readiness | planned | ACS-R1-05.1-T02 | por definir — registrada, no iniciada |

Detalle de cada tarea:

### ACS-R1-05.1-T01 — Single Commercial Runtime Authority

Objetivo: garantizar que WhatsApp real utilice un unico runtime y un unico writer comercial (`WhatsApp -> runNativeAutonomousCycle -> operational-loop -> persistCommercialState`). Debe incluir: verificar callers reales de `process-inbound` (`app/api/brain/process-inbound/route.ts`); determinar si `n8n` u otro sistema sigue invocando el endpoint legacy; impedir que `sales-consultative` (`runSalesConsultativeService`) escriba en paralelo en `crm_opportunities`; congelar `opportunityKeyFor` del motor legacy; mantener aislado `runSalesConsultativeService` preservando solo helpers puros y seguros; agregar un test de regresion que impida reconectar el motor legacy al webhook nativo.

Gate de cierre, no negociable: `not_verified`/`requires_host_verification` no cierran T01 por si solos si la escritura legacy sigue habilitada. Si el inventario de callers no puede confirmar de forma concluyente que ningun sistema externo (`n8n` u otro) invoca todavia el endpoint legacy, la tarea solo cierra cuando se cumple al menos una de: (a) el writer legacy queda tecnicamente deshabilitado para trafico productivo; (b) `process-inbound` redirige al runtime nativo (`runNativeAutonomousCycle`) en vez de invocar el motor legacy; (c) existe un flag fail-closed, deshabilitado por defecto, que bloquea sus escrituras comerciales hasta que se habilite explicitamente. Duda razonable sobre callers externos se resuelve deshabilitando el writer legacy, nunca dejandolo activo "por si acaso".

`accepted` — cerro por la opcion (c): un flag fail-closed, deshabilitado por defecto (`BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED`, default `false`), bloquea las dos vias productivas restantes del motor legacy (`process-inbound` y `native-whatsapp/service.ts#processSalesInbound`). Ver "Evidencia de cierre - ACS-R1-05.1-T01" abajo.

### ACS-R1-05.1-T02 — Stable Opportunity Continuity

Objetivo: un cambio normal de intencion conversacional no debe fragmentar una misma compra. Escenario obligatorio: "Busco una jaula" (product inquiry) -> "Cuanto cuesta" (price request) -> "Tiene stock" (stock request) -> "Esta muy cara" (objection) -> "Cuanto sale el despacho" (delivery request) debe resultar en una unica oportunidad estable, con `opportunity_id`/`opportunity_key` continuos a traves de los cinco turnos. T02 garantiza esa oportunidad estable — no el need profile, el historial comercial completo, la memoria ni la proxima accion, que son la base sobre la que `T03` (Governed Commercial Memory Proposals) y `T04` (Atomic Commercial Memory Persistence) construyen need profile, memoria y proxima accion durable. Una oportunidad nueva corresponde a una compra, necesidad o proyecto independiente, no a una etiqueta de intencion distinta.

Estado de implementacion (`planned` hasta su aceptacion independiente, no cerrada por este parrafo): la auditoria previa a cualquier cambio encontro que `resolveOpportunityIdentity.ts`/`loadCommercialState.ts` filtraban candidatas por igualdad exacta de `primaryIntent`, y que `primaryIntent` queda congelado en el momento de creacion (`reduceCommercialState.ts` nunca lo reescribe sobre una oportunidad existente) - un test escrito antes de tocar produccion (`tests/commercial/opportunityContinuity.test.ts`) reprodujo la fragmentacion exactamente en el segundo turno de la secuencia obligatoria. El mecanismo esta dormido en el runtime nativo hoy (`buildNativeBrainContextShim` fija `latestInboundMessage.intent = null` y no expone `service_code`, asi que `primaryIntent` normaliza siempre a `"unknown"` para WhatsApp real, que ya evitaba este filtro) pero es real y reproducible de forma directa contra el resolver. Corregido (Opcion B, minima): intent pasa a ser una senal de desempate entre 2+ candidatas activas para la misma identidad, nunca un filtro rigido que pueda excluir la unica oportunidad activa en curso - conserva intactos los 5 tests ya existentes que fijan la semantica de ambiguedad/terminal/unknown. La auditoria tambien encontro, y corrigio, un segundo defecto real en `validateCommercialTransition.ts`: `identityResolution.isAmbiguous` solo se anexaba a `blockedReasons` cuando alguna OTRA razon ya bloqueaba la transicion, nunca disparaba el bloqueo por si solo - un turno ambiguo sin ningun otro problema (policy, stage, human/ai) caia en `status: "allowed"` y el loop persistia una tercera oportunidad. Ambos hallazgos, verificados con MariaDB real (`tests/e2e/opportunityContinuity.e2e.test.ts`) y sin regresiones nuevas contra `develop`. `opportunity_key` no cambio de forma. No se implemento `need_profile`, catalogo, memoria comercial nueva, `entityProposals` ni vinculo explicito de follow-up/accion (deuda registrada, ver `ACS-R1-05.1-T02.1` abajo para el catalogo y la seccion "Deuda no cerrada" de este documento para el resto).

Hardening posterior (misma tarea, revision independiente del diff, tres hallazgos reales adicionales, todos corregidos): (1) la reutilizacion de una unica candidata activa era incondicional - un turno de postventa/mantenimiento podia reutilizar silenciosamente una oportunidad de venta activa, o viceversa. `resolveOpportunityIdentity.ts` ahora clasifica cada `CommercialIntent` en familia `sales` (`product_inquiry`, `product_recommendation`, `price_request`, `stock_request`, `quote_request`, `delivery_request`, `discount_request`, `bulk_purchase`, `equipment_project`), `service` (`maintenance_request`, `assembly_request`, `post_sale_request`) o `neutral` (`unknown`, `general_information`) - clasificacion verificada contra el routing legado real del repositorio (`postventa_queue`/`mantenciones_queue` en `context/adapters.ts`, distinto de la cola general de ventas), no inventada. Una candidata cross-domain nunca se reutiliza en silencio: queda excluida del conjunto activo, y el contrato existente (`create_new` cuando no hay candidata, `ambiguous` cuando quedan 2+) decide sin necesidad de un estado nuevo. **Alcance real de este mecanismo**: esta separacion esta implementada y probada en el resolver (unitarios) contra un `primaryIntent` explicito, pero `buildNativeBrainContextShim` sigue fijando `latestInboundMessage.intent = null` y no expone `service_code`/`case_context.active_case` — por lo que en el camino nativo real de WhatsApp, `primaryIntent` normaliza siempre a `"unknown"` (ver "Estado de implementacion" arriba), y la clasificacion cross-domain no llega a activarse porque el turno nunca porta un intent confiable. No se conecta ahora un clasificador improvisado de intent al shim nativo — esa propagacion/clasificacion de intent real debe abordarse junto con la definicion de conocimiento, tools y senales estructuradas (probablemente `T03`/`T02.1`), no como un parche aislado aqui. Hasta entonces, `T02` garantiza el mecanismo de separacion cross-domain, no su operacion demostrada sobre WhatsApp real. (2) `loadCommercialState.ts` seguia asignando `activeState`/`latestDecision` de forma arbitraria (`.find() ?? [0]`) cuando existian 2+ candidatas relevantes, aunque el warning `commercial_state_conflict` ya se emitia - ahora `activeState`/`latestDecision` son `null` en ese caso, sin cambiar el comportamiento cuando existe exactamente una candidata. (3) hallazgo mas profundo, encontrado de forma empirica al construir la evidencia E2E de ambiguedad: `resolveOpportunityIdentity.ts#deriveSelectedState` calculaba `selectedState` de forma especulativa (mismo patron `.find() ?? [0]`) incluso cuando `relevantCount > 1`, y ese campo `identityResolution.selectedState` (no solo `loadResult.activeState`) es leido directamente por `runCommercialOperationalLoop.ts` como `previousState` de respaldo - un turno gobernado-ambiguo llegaba a despachar una accion de fallback (handoff a humano) con el `opportunity_id` de una candidata elegida arbitrariamente. Verificado con MariaDB real antes y despues del fix (Caso 5 del E2E): antes, `crm_agent_actions.opportunity_id` quedaba en una de las dos candidatas; despues, `null`, con el mensaje de fallback completamente generico (sin fuga de `opportunity_key`, intent ni resumen de ninguna candidata). La salida observable para ambiguedad hoy es handoff a humano (`escalate_to_operator`, ya conectado antes de esta tarea, no una funcionalidad nueva) - no existe todavia una pregunta de aclaracion dirigida al cliente ("¿te referis a X o a Y?"); esto queda documentado como hallazgo, no declarado resuelto. Evidencia completa: 16 tests en `tests/commercial/opportunityContinuity.test.ts` (10 originales + 6 cross-domain), 7 casos en `tests/e2e/opportunityContinuity.e2e.test.ts` (Caso 1-6 mas Caso 5b, `loadCommercialState` directo), concurrencia de Caso 3 corrida 5 veces sin fallos, comparacion de suite completa contra `develop` con cero diferencias en el conjunto de fallos (28 preexistentes identicos en ambos lados).

`ACS-R1-05.1-T02` garantiza, verificado con evidencia real: continuidad de `opportunity_id`/`opportunity_key` a traves de un intent que cambia turno a turno dentro de la misma familia comercial; no fragmentacion por intent normal (venta-venta); ambiguedad fail-closed (sin mutacion, sin activeState/selectedState arbitrario, sin tercera oportunidad); terminales sin auto-reopen; el resolver garantiza separacion cross-domain (venta vs. postventa) cuando recibe un intent confiable — mecanismo implementado y probado, no todavia demostrado en el camino nativo real de WhatsApp (ver nota de alcance arriba).

`ACS-R1-05.1-T02` no garantiza todavia: need profile; memoria comercial completa; distincion entre dos necesidades independientes dentro de la MISMA familia y la MISMA identidad (p. ej. dos proyectos de venta distintos del mismo contacto - deuda explicita para `T03`, cuando existan `entityProposals`/need-profile); vinculo explicito follow-up/accion -> oportunidad; catalogo ni grounding comercial; una pregunta de aclaracion dirigida al cliente para el caso ambiguo (hoy es handoff a humano, no una aclaracion conversacional); propagacion/clasificacion de intent confiable en el camino nativo de WhatsApp (`primaryIntent` sigue siendo `"unknown"` ahi hoy, por lo que la separacion cross-domain del resolver no se ejerce todavia en produccion real).

### ACS-R1-05.1-T03 — Governed Commercial Memory Proposals

Objetivo: consumir el contrato estructurado existente del Sales Agent (`entityProposals`, ya presente en `lib/brain/commercial/salesAgentTypes.ts`, `promptBuilder.ts` y `policy/evaluateCommercialEntityProposals.ts`) sin parsear el texto final de la respuesta. Debe incluir: verificar que `entityProposals` esta en tipos, en el schema del proveedor, que el prompt lo solicita, que el adapter HTTP lo conserva y que policy no lo descarta accidentalmente; consumir propuestas para oportunidad; agregar una variante estrictamente tipada para `need_profile` si el contrato actual no puede representarlo; whitelist de campos permitidos; evidencia obligatoria, confidence, mutation intent, idempotency hint, approval requirement; rechazo de campos desconocidos; prohibicion de modificar directamente IDs, versiones, ownership, estados terminales o campos de infraestructura.

### ACS-R1-05.1-T04 — Atomic Commercial Memory Persistence

Objetivo: persistir un turno comercial completo de forma atomica (`crm_opportunities`, `crm_sales_need_profiles`, `crm_agent_decisions`, version optimista, idempotencia por decision, rollback completo, misma `opportunity_key` canonica, misma conexion y transaccion). Aclaracion obligatoria: `persistCommercialState` ya persiste los arrays de `crm_opportunities` (`lib/brain/commercial/operational-loop/persistCommercialState.ts`) — no se agrega un segundo writer para requirements, missing requirements, product interests, objections o signals. El cambio debe ocurrir en `reduceCommercialState.ts`, produciendo un `resultingState` actualizado que `persistCommercialState` escriba una sola vez. La extension de persistencia se centra en el need profile y en la auditoria de propuestas aplicadas/rechazadas.

### ACS-R1-05.1-T05 — Contextual Follow-up

Objetivo: que el follow-up utilice memoria comercial durable (oportunidad, need profile, producto/categoria, uso, presupuesto, espacio, features, productos considerados, objeciones, ultima recomendacion, decisiones recientes, acciones pendientes), conservando cancelacion por respuesta, quiet hours, lifecycle, intentos maximos, CAS, restart recovery, ownership humano y policy gate ya entregados por `ACS-R1-05`. No es suficiente "Hola, sigues interesado?"; el ejemplo esperado es del tipo "Retomo la consulta por la jaula compacta que revisamos. La alternativa dentro de tu presupuesto de $500.000 era X. La diferencia principal frente a Y era la ausencia de poleas."

### ACS-R1-05.1-T06 — Progress and Anti-loop Policy

Objetivo: impedir conversaciones repetitivas sin avance. Invariantes: no preguntar datos ya conocidos; no repetir la misma pregunta sin nueva informacion; no repetir una recomendacion rechazada sin cambiar estrategia; una pregunta discriminante por turno; recomendar cuando hay informacion suficiente; reconocer cuando no hay coincidencia exacta; esperar cuando el cliente pide tiempo; hacer handoff cuando el sistema no puede avanzar; cerrar o pausar cuando no hay progreso; no crear acciones autonomas equivalentes indefinidamente. Cada turno debe producir al menos uno de: nuevo dato, cambio de perfil, producto evaluado, objecion nueva/actualizada, recomendacion nueva, accion, espera explicita, handoff o cierre.

### ACS-R1-05.1-T07 — WhatsApp Contact Suppression

Objetivo: detener outbound comercial cuando el cliente lo solicita ("No me contacten mas", "No quiero recibir mensajes", "No me interesa, no insistan"). Flujo: detectar intencion, persistir supresion, cancelar follow-ups pendientes, bloquear nuevos follow-ups, emitir un unico acknowledgement, permitir que el cliente vuelva a escribir inbound, no reiniciar outreach automaticamente. La autoridad no debe quedar unicamente en `crm_opportunities.signals_json` (hoy sin ningun escritor real, confirmado — ver `docs/audits/follow-up-runtime-reconciliation.md` y la evidencia de cierre `ACS-R1-05-T02`). Para el MVP de WhatsApp debe definirse una supresion minima por `channel`, `channel_account_id`, `external_contact_id`/`wa_id`, `scope`, `status`, `reason`, `source message` y `timestamp`. La oportunidad puede mantener una proyeccion `opt_out`, pero no debe ser la unica fuente de verdad. No existe hoy ninguna tabla `crm_contact_suppression` (o equivalente) en el repositorio — su diseno y creacion son parte de esta tarea, no un hecho ya construido. `additive_migration_required`: esta tarea requiere una migracion aditiva nueva (tabla nueva), nunca una alteracion de tablas existentes ni un cambio retroactivo de esquema — respeta la regla de `AGENTS.md`/`CLAUDE.md` de no crear tablas nuevas de produccion sin tarea explicita, porque esta es esa tarea explicita.

### ACS-R1-05.1-T08 — Controlled Pilot Deployment

Objetivo: crear un entorno reproducible para un unico numero real allowlisted. Debe incluir: proveedor LLM real, modelo real, Catalog Service real, Meta WhatsApp real, base de datos real, outbox worker supervisado, follow-up worker supervisado, allowlist de un unico `wa_id`, kill switches independientes, logs, health checks, restart automatico, procedimiento de rollback, procedimiento de activacion, procedimiento de desactivacion, configuracion versionada sin exponer secretos.

### ACS-R1-05.1-T09 — Customer-visible UAT

Debe probarse con un numero real, tres conversaciones minimas: (1) conversacion principal (consulta -> presupuesto/espacio -> objecion -> "lo voy a pensar" -> silencio -> follow-up contextual -> respuesta -> cancelacion del siguiente follow-up -> solicitud de humano -> IA detenida bajo ownership humano); (2) conversacion de opt-out (consulta -> follow-up programado -> opt-out -> follow-up cancelado -> ningun outbound posterior -> nuevo inbound voluntario -> respuesta reactiva permitida sin reactivar outreach automatico); (3) recuperacion (restart antes del worker, restart entre accion y outbox, replay del webhook, mismo inbound concurrente, caida temporal del LLM/catalogo/Meta).

### ACS-R1-05.1-T10 — Acceptance and Roadmap Reconciliation

Debe producir: auditoria de aceptacion, evidencia E2E, evidencia del piloto real, SHA de cierre, deuda remanente, decision sobre la siguiente release, actualizacion final de `ROADMAP.md`, `CAPABILITY_MATRIX.md` y `ACTIVE_RELEASE.md`.

### ACS-R1-05.1-T02.1 — Grounded Catalog and Commercial Knowledge Readiness

Registrada como workstream separado durante `ACS-R1-05.1-T02` (no implementada, no iniciada). Cubre lo que `T02` deliberadamente dejo fuera de alcance para no mezclar continuidad de identidad con grounding comercial: catalogo, precios, stock, FAQ, y cualquier conocimiento de producto que el resolver de oportunidad pudiera necesitar en el futuro para distinguir "misma compra, pregunta nueva" de "necesidad genuinamente distinta en la misma identidad" (deuda documentada en "Deuda no cerrada" de este documento). Alcance, dependencias y gate por definir cuando esta tarea inicie su planificacion — este parrafo no anticipa ese alcance.

## Tarea actual

`ACS-R1-05.1-T02.1` — Grounded Catalog and Commercial Knowledge Readiness. No iniciada, alcance por definir. (`ACS-R1-05.1-T01` aceptada — ver "Evidencia de cierre - ACS-R1-05.1-T01"; `ACS-R1-05.1-T02` aceptada — ver "Evidencia de cierre - ACS-R1-05.1-T02" abajo.)

## Definition of Done (release)

- una oportunidad por camino comercial, memoria durable, cero preguntas repetidas;
- recomendacion grounded en catalogo real, objecion utilizada en el follow-up;
- follow-up contextual (no generico), cancelacion correcta, opt-out correcto, handoff correcto;
- sin duplicados, sin turnos perdidos por fallos internos, sin errores internos visibles al cliente;
- entorno piloto reproducible desde documentacion y configuracion versionada;
- UAT completa (conversacion principal, opt-out, recuperacion) ejecutada contra un `wa_id` real allowlisted;
- Meta WhatsApp, proveedor LLM y Catalog Service en `verified_real` (ver "Operational evidence levels" en `ROADMAP.md`) para ese `wa_id` — esta release, a diferencia de `ACS-R1-05`, no cierra con esos tres ejes en `not_verified`;
- `CAPABILITY_MATRIX.md`, `ROADMAP.md` y `ACTIVE_RELEASE.md` reconciliados con el resultado real, nunca con el resultado esperado.

## Definition of Done de T01 (cerrada, cumplida)

Cumplida en su totalidad — `ACS-R1-05.1-T01` aceptada (`single_commercial_runtime_authority_accepted`). Ver "Evidencia de cierre - ACS-R1-05.1-T01" abajo para el detalle completo.

- inventario verificado de callers reales de `process-inbound` (query directa al codigo, no inferencia);
- si ese inventario no puede confirmar de forma concluyente que ningun sistema externo (`n8n` u otro) invoca el endpoint legacy, el writer legacy queda deshabilitado por defecto para trafico productivo (fail-closed) antes de cerrar T01 — `not_verified`/`requires_host_verification` no son, por si solos, un cierre valido mientras la escritura legacy siga habilitada (ver gate de cierre en la seccion de tareas arriba);
- `sales-consultative` no escribe en paralelo en `crm_opportunities` para trafico real de WhatsApp;
- `opportunityKeyFor` del motor legacy queda congelado (sin nuevos callers productivos);
- test de regresion que falla si el motor legacy vuelve a conectarse al webhook nativo.

## Definition of Done de T02 (cerrada, cumplida)

Cumplida — `ACS-R1-05.1-T02` aceptada (`stable_opportunity_continuity_accepted`). Ver "Evidencia de cierre - ACS-R1-05.1-T02" abajo para el detalle completo. Gate: `Same commercial path reuses same opportunity`, cumplido dentro de la misma familia comercial (venta-venta); separacion cross-domain (venta/postventa) implementada en el resolver, no todavia demostrada en el camino nativo real (ver nota de alcance en la seccion de tareas).

## Definition of Done de la tarea actual (T02.1)

`ACS-R1-05.1-T02.1` no tiene alcance, dependencias ni gate definidos todavia — ver `### ACS-R1-05.1-T02.1` arriba. Se redacta al iniciar su planificacion.

## Siguiente tarea

`ACS-R1-05.1-T03` — Governed Commercial Memory Proposals. No depende de que `T02.1` inicie o cierre (su dependencia declarada es `ACS-R1-05.1-T01`, ya aceptada); puede planificarse en paralelo a `T02.1`.

## Evidencia de cierre - ACS-R1-05.1-T01

`accepted`. Veredicto exacto: `single_commercial_runtime_authority_accepted`. Rama `feat/acs-r1-05-1-t01-single-commercial-runtime-authority`. Commits (orden cronologico, sin squash): `b08e4d0` (gate del motor legacy sales-consultative detras de un flag fail-closed), `f2d1531` (aplicacion del gate en `process-inbound` y `processSalesInbound`), `439d1a3` (endurecimiento del test arquitectonico de callers para cubrir `middleware.ts`), `a8bdf14` (correccion de un defecto real encontrado durante la aceptacion, ver abajo).

Evidencia verificada:

- el runtime nativo (`processNativeWhatsAppInbound -> runNativeAutonomousCycle -> operational-loop -> persistCommercialState`) queda como unica autoridad comercial habilitada por defecto para trafico real de WhatsApp;
- el motor legacy `sales-consultative` (`runSalesConsultativeService`) queda deshabilitado por defecto (`disabled by default`) en sus dos vias productivas restantes;
- flag fail-closed `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED` (unico lector: `commercialCycleConfig.ts#buildLegacySalesConsultativeFeatureFlags`, misma convencion `readEnvFlag` que el resto del ciclo comercial — ausente/vacio/`"false"`/cualquier valor distinto de `"true"` resuelven a deshabilitado);
- `process-inbound` conserva su contrato: con el flag ausente, `"false"` o invalido (`"yes"`), la respuesta sigue siendo `ok:true`, con warning estructurado `legacy_sales_consultative_disabled`, cero llamadas a `runSalesConsultativeService` y cero error 500 causado por el gate;
- `processSalesInbound` falla antes de cualquier acceso a base de datos mediante un error de dominio nombrado (`LegacySalesConsultativeDisabledError`), nunca un `Error` generico;
- test arquitectonico de callers (`tests/commercial/legacySalesConsultativeRuntimeAuthority.test.ts`): prueba por grep de todo el arbol de produccion (`app/lib/scripts/components` + archivos raiz, incluido `middleware.ts`) que `runSalesConsultativeService` no tiene referencias productivas fuera de su propia definicion y las dos vias flag-gated ya conocidas;
- MariaDB E2E aprobado: suite completa 1414/1431 tests en verde sobre la rama (`crm_test`, migraciones limpias); los 17 fallos restantes son subconjunto estricto de los 26 fallos preexistentes en `develop` (comparado en worktree separado contra el merge `49f3a7b`) — cero regresiones nuevas;
- replay aprobado: reentrega del mismo `providerMessageId` es reconocida como duplicado (`duplicate:true`), sin filas comerciales adicionales;
- same-inbound concurrency aprobado a nivel de persistencia: dos llamadas concurrentes con el mismo `providerMessageId` nuevo colapsan a exactamente una fila en `conversation_message` y un unico par accion/outbox, aunque ambas llamadas computen `duplicate:false` a nivel de aplicacion (ver deuda registrada abajo);
- cero regresiones nuevas respecto de `develop` (ver punto de MariaDB E2E arriba).

Defecto real encontrado y corregido durante la aceptacion (commit `a8bdf14`, sin amend sobre `439d1a3`): `tests/commercial/legacySalesConsultativeAuthority.test.ts` tenia un `after(() => getPool().end())` sobrante — ninguno de sus 5 tests toca base de datos real (todo via DI), pero como cada archivo de `tsx --test` corre en su propio proceso aislado, `getPool()` lanzaba `Missing DATABASE_NAME` en cualquier proceso sin variables de entorno de DB, marcando el archivo completo como fallido pese a que las 5 aserciones reales pasaban. Se elimino el hook y el import `getPool` no usado; se re-ejecutaron todos los gates (`tsc`, `docs:validate`, `build`, suite completa) despues del fix.

Deuda registrada (no bloquea el cierre de T01, no resuelta en este commit):

1. checksum drift preexistente en `025_action_outcome_idempotency_and_opportunity_delivery_projection.sql` contra la base `main_management` (target por defecto de `npm run db:migrate`, hardcodeado en `scripts/db-utils.ts`) — confirmado no relacionado con T01 (la rama no toca ningun archivo bajo `database/`/`infra/`).
2. `processNativeWhatsAppInbound` no ofrece una seam de proveedor (`provider`) para pruebas ad-hoc — a diferencia de `runNativeAutonomousCycle`/`ensureAutonomousSalesTurnContinuity`, que si la aceptan — por lo que una prueba manual contra ese punto de entrada con el operational-loop activo puede terminar ejecutando el proveedor LLM configurado en el entorno real.
3. ambas llamadas concurrentes al mismo inbound pueden calcular `duplicate:false` en la capa de aplicacion antes de que la restriccion de base de datos consolide el inbound a una sola fila — la persistencia final es unica (verificado), pero la senal de aplicacion (`duplicate`) no es fiable bajo concurrencia real.

## Evidencia de cierre - ACS-R1-05.1-T02

`accepted`. Veredicto exacto: `stable_opportunity_continuity_accepted`. Rama `feat/acs-r1-05-1-t02-stable-opportunity-continuity`. Commits (orden cronologico, sin squash): `4a35c41` (test que reproduce la fragmentacion antes de tocar produccion), `8055584` (fix minimo — intent como desempate, no filtro rigido; correccion del gate de ambiguedad en `validateCommercialTransition.ts`), `db49246` (docs), `a88ead2` (hardening — separacion cross-domain venta/postventa, `activeState`/`selectedState` arbitrario corregido en dos ubicaciones, Caso 3 reescrito sin riesgo de proveedor real), `6e60345` (docs del hardening), mas el commit final de aceptacion de esta seccion.

Que garantiza T02, verificado con evidencia real (unitarios + MariaDB real, ver "Estado de implementacion"/"Hardening posterior" arriba para el detalle tecnico completo): continuidad de `opportunity_id`/`opportunity_key` a traves de un intent que cambia turno a turno dentro de la misma familia comercial; ambiguedad fail-closed (sin `activeState`/`selectedState` arbitrario en ninguna de las tres ubicaciones donde existia el patron, sin tercera oportunidad, sin mutacion de las candidatas existentes); terminales sin auto-reopen; el resolver separa venta de postventa cuando recibe un intent confiable.

Que NO garantiza todavia (lista completa en "T02 no garantiza todavia" arriba, repetida aqui por ser parte del criterio de aceptacion): need profile; memoria comercial completa; distincion de dos necesidades independientes dentro de la MISMA familia y MISMA identidad; vinculo explicito follow-up/accion -> oportunidad; catalogo/grounding comercial; una pregunta de aclaracion real dirigida al cliente ante ambiguedad (hoy es handoff a humano generico); y, critico para el piloto, **propagacion de intent confiable en el camino nativo de WhatsApp** — `buildNativeBrainContextShim` sigue fijando `primaryIntent = "unknown"` para todo turno real, por lo que la separacion cross-domain esta probada en el resolver pero no demostrada operando sobre WhatsApp real. No se conecto un clasificador de intent improvisado para cerrar ese gap; se deja para cuando se defina conocimiento/tools/senales estructuradas (`T02.1`/`T03`).

Deuda conservada (no bloquea el cierre de T02, no resuelta en este commit): `native intent propagation` (arriba); `same-family distinct-need disambiguation`; `explicit follow-up-to-opportunity linkage`; `customer-facing ambiguity clarification`. Mas la deuda heredada de T01 (checksum drift migracion 025, sin seam de proveedor en `processNativeWhatsAppInbound`, senal `duplicate` no fiable bajo concurrencia a nivel de aplicacion).

Tests: 18/18 en `tests/commercial/opportunityContinuity.test.ts` (10 continuidad + 6 cross-domain + 2 simetria), 31/31 aserciones preexistentes intactas en `tests/commercial/runCommercialOperationalLoop.test.ts`, 7/7 casos MariaDB real en `tests/e2e/opportunityContinuity.e2e.test.ts`, concurrencia de Caso 3 verificada 5/5 sin fallos. Suite completa comparada contra `develop`: cero diferencias en el conjunto de fallos preexistentes. `npx tsc --noEmit`, `npm run build`, `npm run docs:validate` limpios en cada punto de control.

## Dependencias

### Internas

- `lib/brain/commercial/sales-consultative/repository.ts` (planner de follow-up, `ACS-R1-05-T01`);
- `lib/brain/commercial/policy/evaluateCommercialPolicy.ts` (`follow_up_dispatch_policy`, `ACS-R1-05-T02`);
- `lib/brain/commercial/followup/runFollowupTick.ts` (worker endurecido, `ACS-R1-05-T03`);
- `lib/brain/messaging/canonicalOutboxWriter.ts` (outbox consolidado, `ACS-R1-05-T04`);
- `lib/brain/commercial/continuity/` (`ensureAutonomousSalesTurnContinuity`, `ACS-R1-05-T06.2`);
- `lib/brain/commercial/operational-loop/{reduceCommercialState,persistCommercialState}.ts`;
- `lib/brain/commercial/salesAgentTypes.ts` / `policy/evaluateCommercialEntityProposals.ts` (`entityProposals`);
- Capability Gateway (`search_products`, `get_product_details`, `batch_get_products`).

### Externas

- Meta WhatsApp Business API real (numero allowlisted);
- proveedor LLM real con credenciales de produccion/piloto;
- Catalog Service real (`ACS-R1-01` sigue con debt `not_verified` en este eje);
- instancia de base de datos real para el piloto (no `crm_test` desechable).

## Evidencia requerida

- inventario de callers de `process-inbound`, mas evidencia del gate fail-closed (writer legacy deshabilitado, `process-inbound` redirigido, o flag fail-closed) si el inventario no es concluyente (`T01`);
- evidencia E2E (tests end-to-end contra el runtime nativo y MariaDB real) del escenario obligatorio de continuidad — no requiere todavia un transcript contra WhatsApp real (`T02`);
- diff de tipos/schema/prompt/adapter que prueba que `entityProposals` fluye completo (`T03`);
- test de atomicidad (fallo parcial no deja estado inconsistente) (`T04`);
- evidencia E2E (tests end-to-end contra MariaDB real) de un follow-up contextual que cita memoria comercial durable — no requiere todavia Meta/LLM/Catalog Service reales (`T05`);
- log de un turno que produce progreso explicito o una salida explicita, sin repeticion (`T06`);
- evidencia de la tabla/mecanismo de supresion (migracion aditiva, `additive_migration_required`) y de cero outbound posterior a un opt-out real (`T07`);
- despliegue real de Meta WhatsApp, proveedor LLM y Catalog Service (`verified_real`), mas procedimiento de despliegue ejecutado desde cero por una persona distinta de quien lo escribio, o evidencia equivalente de reproducibilidad (`T08`);
- transcripts reales de las tres conversaciones de UAT, ejecutadas contra el `wa_id` real allowlisted (`T09`);
- auditoria de aceptacion con SHA de cierre (`T10`).

Ninguna de estas evidencias existe todavia. Este documento no las da por cumplidas.

## Criterios de aceptación

Los del gate de `ACS-R1-05.1-T09` (Customer-visible UAT): una oportunidad; memoria durable; cero preguntas repetidas; recomendacion grounded; objecion utilizada; follow-up contextual; cancelacion correcta; opt-out correcto; handoff correcto; sin duplicados; sin turnos perdidos por fallos internos; sin errores internos visibles — mas la reconciliacion de `ACS-R1-05.1-T10`.

## Deuda no cerrada

Ver tambien la tabla "Carried release debt" en `docs/ROADMAP.md`, seccion "Camino critico al piloto controlado" — esta seccion no la duplica, la referencia.

- `search_products`/`get_product_details`/`batch_get_products` siguen `operational: not_verified` contra un Catalog Service real (heredado de `ACS-R1-01`/`ACS-R1-05-T06.2`) hasta que `T08`/`T09` ejecuten un smoke real.
- `resolve_customer`/`create_customer`/`link_external_identity` siguen `operational: not_verified` (heredado de `ACS-R1-04`, `PAUSED_EXTERNAL`) — `ACS-R1-05.1` no depende de ellos ni los desbloquea.
- Frequency cap por customer sigue sin existir en ningun path (heredado de `ACS-R1-05`, deuda declarada P3, no bloqueante).
- `metaSendAdapter.ts` permanece sin usar por ningun worker productivo hasta `T08` (heredado de `ACS-R1-05`, P3-1 de la auditoria original).
- `ACS-R1-05.1-T02`: no existe vinculo explicito follow-up/accion -> oportunidad en el resolver; la continuidad de una respuesta a un follow-up depende enteramente de que la identidad (wa_id/conversation_case_id) tenga una unica oportunidad activa. Si el mismo contacto llegara a tener dos oportunidades activas simultaneas, el resolver no puede hoy determinar a cual pertenece una respuesta de follow-up (queda `ambiguous`, fail-closed, nunca elige mal - pero tampoco resuelve). Requeriria una senal explicita nueva (p. ej. `crm_agent_actions.opportunity_id` propagado al turno reactivo), fuera de alcance de T02.
- `ACS-R1-05.1-T02`: el resolver no distingue "dos necesidades independientes en el mismo hilo/identidad" de "la misma compra con una pregunta nueva" - no existe hoy ninguna senal de "nueva necesidad comercial" en el codigo (`entityProposals`/need profile son `T03`+). Con una unica oportunidad activa por identidad, cualquier mensaje nuevo se asume parte de esa misma oportunidad; una necesidad genuinamente distinta en la MISMA identidad puede mezclarse silenciosamente hasta que exista esa senal.

## Secuencia posterior

`ACS-R1-05.1` (piloto controlado) -> `ACS-R1-06` (Business Policy, `planned`) -> `ACS-R1-07` (Quote, `planned`) -> `ACS-R1-08` (Operator Readiness, `planned`). Ninguna de estas tres queda renumerada ni se presenta como trabajo anterior al piloto.

## Bloqueos

Ninguno propio de esta release. No depende de Customer Service (`PAUSED_EXTERNAL`) ni de que `ACS-R1-04-T08`/`T09` cierren. No depende de Address Book ni Voice (`DEFERRED`).

## ADRs aplicables

- [ADR-001 - Commercial vs AI decisions](../architecture/adr/ADR-001-commercial-vs-ai-decisions.md)
- [ADR-003 - Commercial action source of truth](../architecture/adr/ADR-003-commercial-action-source-of-truth.md)
- [ADR-004 - Next best action ownership](../architecture/adr/ADR-004-next-best-action-ownership.md)
- [ADR-006 - Autonomous planning and capability governance](../architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md)
- [ADR-007 - Failure escalation and outcomes](../architecture/adr/ADR-007-failure-escalation-and-outcomes.md)

## Required reading

- [Autonomous Commerce PRD](../product/autonomous-commerce-prd.md)
- [ROADMAP](../ROADMAP.md)
- [ACTIVE_RELEASE](../ACTIVE_RELEASE.md)
- [MVP execution map](../product/MVP_EXECUTION_MAP.md)
- [ACS-R1-05 - Autonomous Follow-up Runtime](ACS-R1-05-autonomous-follow-up-runtime.md)
- [Follow-up runtime reconciliation](../audits/follow-up-runtime-reconciliation.md)
- [Autonomous Commerce First Vertical](../product/autonomous-commerce-first-vertical.md)
- [Autonomous Commerce State Model](../product/autonomous-commerce-state-model.md)
- [Sales Agent contract](../product/sales-agent-contract.md)
- [Follow-up decision policy](../product/follow-up-decision-policy.md)
- [Lead/opportunity contract](../product/lead-opportunity-contract.md)
- [CAPABILITY_MATRIX](../CAPABILITY_MATRIX.md)
