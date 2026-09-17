# R3 Commercial Agent — Architecture & Handoff

Documento técnico canónico de handoff para retomar la línea R3 Commercial Agent después de P6.3. Describe contratos y seams vigentes en `develop`; no convierte la telemetría P6 en autorización ni cambia el roadmap de la release activa.

## 1. Purpose

R3 resuelve el problema de sostener una cognición comercial por turnos sin convertir al LLM en autoridad de negocio ni volver a los workflows semánticos R2. `CommercialWork` es el case kernel durable externo: conserva el estado comercial, objetivos, bloqueos y versión. `SalesAgentRuntime` es el motor de cognición/harness R3: recibe el turno, usa el provider y produce respuesta, handoff, tool calls y, desde P4, una `CommercialProposal` estructurada.

El `Capability Gateway` es la frontera de autoridad para capacidades: registry, policy, identidad, disponibilidad, ejecución, retry acotado y auditoría. El Outbox es la vía canónica de entrega de mensajes; el runtime no salta esa frontera. El `CommercialDomainReadModel` (DRM) proyecta hechos comerciales y su frescura para cognición/observación, sin convertirse en un segundo dominio de escritura.

`CommercialProposal` describe la transición sugerida y evidenciada por el último turno. P5 la reconcilia contra `CommercialWork` durable. P6 calcula `capability eligibility`: una señal descriptiva de si no existe un bloqueador estructural conocido según objetivo durable, hechos actuales e identidad proyectada. No autoriza ejecución.

## 2. Current Architecture

```text
Inbound turn
  -> Turn Settlement (cuando está habilitado; default sin espera)
  -> runNativeAutonomousCycle
  -> CommercialWork kernel (P3.5)
  -> cierre P2 para construir CommercialDomainReadModel
  -> eligibility pre-cognición (P6.3) -> AgentTurnInput -> R3 provider-harness
  -> CommercialProposal (P4, mismo harness)
  -> objective reconciliation (P5)
  -> structural capability eligibility post-reconciliation shadow (P6.2)
  -> terminal response or handoff
  -> canonical Outbox dispatch
```

Implementado: turn settlement, kernel P3.5, DRM P0/P2, runtime/harness, proposal P4, reconciliación P5, eligibility P6.2 y su vista cognitiva P6.3, y dispatcher R3 nativo. P6.3 informa el prompt, pero no altera la tool pool ni la autoridad de ejecución. P7/P8/P9 representan la integración posterior de eligibility con ejecución gobernada, reproyección/continuación y recuperación durable; no están implementados por P6.

El execution path de capabilities ya existe en R3:

```text
R3 provider/harness
-> use_tool
-> Agent Tool Loop
-> Capability Gateway
-> domain/service read or mutation
-> ToolObservation
-> R3 continuation dentro del presupuesto actual del loop
```

P6.2 todavía no condiciona esa ejecución: eligibility permanece shadow-only. El roadmap posterior no construye Gateway desde cero:

```text
P6.3 -> informar cognición con eligibility
P7   -> integrar/revalidar eligibility con el execution path gobernado existente
P8   -> reproyectar estado durable después de efectos y continuar cognición
P9   -> recovery/retry/wait durable
```

Puntos de entrada y ownership de ciclo:

- `lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts#runNativeAutonomousCycle` resuelve flags y llama al ciclo.
- `lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts#runSalesAgentRuntimeCycle` coordina kernel, runtime, P5, P6 y dispatch.
- `lib/brain/commercial/sales-agent-runtime/salesAgentRuntime.ts#runSalesAgentRuntime` ejecuta cognición/harness y el shadow P2 antes del provider.
- `lib/brain/commercial/sales-agent-runtime/dispatchSalesAgentTerminalOutcome.ts#dispatchSalesAgentTerminalOutcome` conserva el límite de entrega; los dispatchers escriben el outbox canónico.

## 3. Architectural Invariants

- `CommercialWork` es el outer durable case kernel; `SalesAgentRuntime` es cognición/harness, no su reemplazo.
- `CommercialProposal` es la transición solicitada/evidenciada del último turno, no un snapshot durable.
- Un acknowledgement/courtesy sin transición comercial usa `proposal.objective = null`.
- P5 es determinista: no interpreta lenguaje natural, no llama LLM, no ejecuta capabilities ni lee/escribe DB al decidir.
- P6 es elegibilidad estructural/descriptiva, nunca autorización ni predicción de éxito; Gateway/P7 conserva la autoridad final.
- R3 no debe volver a depender de `deriveCommercialWorkSteps` ni reintroducir `reconcileCommercialTrigger`/el planner semántico R2.
- No modelar una cotización como workflow rígido paso 1→2→3; el objetivo durable y los hechos actuales gobiernan la preparación.
- `create_quote` no requiere shipping, destino ni shipping selection estructuralmente en el contrato actual. `get_quote` usa identidad `NONE`.
- P6 no duplica pricing, tax, catalog hydration, validación de Quote Service, registries, policy de identidad ni governance de Gateway.
- Capability names son los nombres canónicos del registry. Una definition P6 sin registry/operación/identity policy canónica falla cerrada.
- `UNKNOWN`, `STALE`, `SUPERSEDED` e `HISTORICAL` bloquean prerequisites que requieren facts CURRENT. No inventar TTL si no existe política canónica.
- `AgentSession` guarda memoria conversacional; `CommercialWork` y domain facts son la verdad comercial durable, nunca el prompt.
- P6 no ejecuta Gateway/capabilities, no consulta disponibilidad, no hace HTTP/DB/LLM y no muta `CommercialWork`.
- El Outbox es la vía canónica de entrega. No usar una DB productiva para “hacer pasar” tests.

## 4. Ownership Model

| Concern | Canonical owner |
|---|---|
| Conversation messages | conversación durable / inbound nativo y outbox de mensajería |
| Turn settlement | `lib/brain/commercial/turn-settlement/` |
| CommercialWork | `lib/brain/commercial/work/` y su repositorio/proyección |
| Objective | `CommercialWork.objectives`; P5 sólo decide la transición |
| Blockers | proyección/evaluación de `CommercialWork` |
| Request facts | hechos durables comerciales, no el prompt |
| Cart / selection | dominio `commercial-line-items` y proyección DRM |
| Destination | dominio `shipping-destination` y proyección DRM |
| Shipping | capabilities Gateway y proyección DRM |
| Customer identity | sesión nativa confiable + identity gate canónico |
| Catalog | Catalog Service/`CatalogPort` vía Gateway |
| Quote | Quote Service/created quote y sus proyecciones |
| AgentSession | `lib/brain/commercial/agent-session/` |
| R3 reasoning | `SalesAgentRuntime` y Agent Tool Loop/provider |
| Capability Gateway | `lib/brain/commercial/capability-gateway/` |
| Outbox | dispatch R3 y `brain_message_outbox` |
| Follow-up | runtime/worker de follow-up, separado del turno vivo |
| Event telemetry | `lib/brain/commercial/events/` |

## 5. Roadmap Status

| Fase | Estado | Entrega |
|---|---|---|
| P0 DomainReadModel | CLOSED | DRM con projections, provenance y freshness |
| P1 AgentTurnInput | CLOSED | contrato/observación de input para cognición |
| P2 Shadow integration | CLOSED | DRM construido antes del provider, sin exponerlo aún al modelo |
| P3 runtime/env hardening | CLOSED | runtime R3 y boundaries fail-closed endurecidos |
| P3.5 CommercialWork kernel | CLOSED | create/reuse de case durable sin planner R2 |
| P4 CommercialProposal | CLOSED | salida estructurada del mismo harness |
| P5 Objective reconciliation | CLOSED | decisión determinista y CAS de objetivos |
| P6.1 capability/wiring audit | CLOSED | límites y autoridad auditados |
| P6.2-A structural eligibility base | CLOSED | evaluator puro y evento shadow |
| P6.2-B create_quote/get_quote | CLOSED | scope quote e identidad canónica |
| P6.2-C integrated shadow validation | CLOSED | wiring post-P5 y regresiones integradas |
| P6.3 eligibility → AgentTurnInput/R3 | CLOSED | informar cognición sin filtrar herramientas |
| P7.0 comparative harness/runtime audit | CLOSED | `docs/audits/r3-p7-0-comparative-harness-capability-runtime-audit.md`; scope minimo validado para P7.1+ |
| P7.1 trusted execution context | CLOSED | workId/workVersion/objectiveId/objectiveType threadeados de runtime a `CapabilityGatewayContext`, sin autoridad de ejecución |
| P7.2 eligibility/request/outcome correlation | NEXT | observar cómo la invocación se relaciona con la eligibility pre-cognición que vio el modelo |
| P7.3 in-turn relevant change detection | PENDING | distinguir bloqueador resuelto en el turno vs pedido repetido sin evidencia nueva |
| P7.4 benchmark connection | PENDING | conectar P7 al benchmark E2E |
| P8 reproject + continue cognition | PENDING | observar resultado y continuar |
| P9 durable retry/wait/recovery | PENDING | recuperación durable |
| P10 follow-up | PENDING | continuidad programada |
| P11 benchmark/hardening | PENDING | evidencia operacional y endurecimiento |
| P12+ multichannel/voice | POST CORE | expansión posterior al core |

## 6. P4 — CommercialProposal Contract

El contrato vive en `lib/brain/commercial/commercial-proposal/types.ts`. Es companion structured output del mismo harness/provider que genera `AgentStep`: no hay segundo model call, no muta work, no crea IDs y no autoriza capabilities.

Campos: `objective` (`kind`, `operation`, `confidence`) o `null`; `requestedOutcome`; `requirementSignals`; `evidenceCodes` fijos y bounded; y `ambiguity`. Los objectives canónicos incluyen `DISCOVER_NEED`, `SELECT_PRODUCTS`, `QUOTE`, `ORDER` y `AFTER_SALES`; P6.3 no amplía su scope a ORDER/AFTER_SALES.

Semántica de cortesía aceptada:

```text
"gracias"
-> objective null
-> operation null (no existe operación fuera de objective)
-> requestedOutcome null
-> requirementSignals []
-> evidenceCodes [COURTESY_CLOSING]
```

La ausencia de objective no borra ni reemplaza el objective durable existente.

## 7. P5 — Objective Reconciliation Contract

`lib/brain/commercial/work/objective-reconciliation/reconcile.ts#decideCommercialObjectiveReconciliation` decide sobre proposal, objective activo, estado del work e ID determinista de turno. `applyCommercialObjectiveReconciliationDecision` es la frontera que hace una decisión durable mediante CAS.

| Operation | Regla |
|---|---|
| START | sin activo: START; mismo kind: CONTINUE; kind distinto: REJECT |
| CONTINUE | exige activo del mismo kind; no escribe |
| MODIFY | exige activo del mismo kind; no escribe en v1 |
| REPLACE | sin activo: START; con activo: supersede y crea; reintento del mismo ID: CONTINUE |
| COMPLETE | REJECT hasta que exista evidencia durable cableada |
| CANCEL | exige mismo kind y cancela el objective, no el work |
| NONE | NOOP |

`proposal = null` o `proposal.objective = null` también son NOOP. El ID de objetivo es determinista por `(workPublicId, inboundMessageId)`. Un `VERSION_CONFLICT` se propaga como conflicto real: P5 no hace reread ni retry interno; los reintentos del caller deben respetar la idempotencia del turno.

## 8. P6 — Structural Capability Eligibility

Definición: **“no known structural blocker according to durable objective + known current facts + identity projection”**.

No significa autorización de ejecución, dependencia saludable ni éxito garantizado. Sus componentes son:

- `lib/brain/commercial/capability-eligibility/definitions.ts`: sidecar estrecho de prerequisites/objectives.
- Validación contra `capability-gateway/registry`; `executionClass` se deriva de `governance.sideEffect` del Gateway.
- `evaluateCapabilityEligibility`: evaluator sincrónico y puro.
- `CAPABILITY_ELIGIBILITY_METADATA_VERSION` y `CapabilityEligibilitySnapshot`.
- `runCapabilityEligibilityShadow`: adapter flag-gated que evalúa y registra una vez.
- evento `commercial_capability_eligibility_evaluated`, sólo de observación.

## 9. P6 Capability Scope

Las definitions P6 actuales son estas, no el inventario completo del Gateway.

| Grupo | Capabilities |
|---|---|
| Read | `search_products`, `search_products_by_semantics`, `explore_catalog`, `get_product_details`, `recommend_catalog_products`, `get_quote` |
| Mutation / commercial preparation | `select_products`, `set_shipping_destination`, `calculate_shipping`, `create_quote` |

`executionClass` siempre refleja Gateway. En particular, `calculate_shipping` puede ser `read_only` en Gateway y aun así P6 bloquearla por prerequisites estructurales.

### calculate_shipping

Requiere objective `QUOTE`, selección `CURRENT` y destino `CURRENT`. No llama Carrier ni `checkAvailability`; no afirma disponibilidad de Carrier.

### create_quote

Requiere objective `QUOTE`, selección `CURRENT` e identidad al menos `LEVEL_2_MASTER_RESOLVED`. No requiere estructuralmente destino, cálculo de shipping ni shipping selection. La validación final sigue en Gateway/`assembleQuoteInput`.

### get_quote

Requiere objective `QUOTE`, proyección/locator quote `CURRENT` e identidad `NONE`. P6 no hace checks de disponibilidad runtime.

## 10. Capability Gateway

El registry `lib/brain/commercial/capability-gateway/registry.ts` registra capability, versión y governance. `types.ts` define side effect (`read_only`/`mutating`), authority, risk, `checkAvailability` y `execute`. `executeCapability.ts#executeGovernedCapability` aplica registry, identity gate, disponibilidad, retry acotado de la capability y auditoría de ejecución.

P6 structural eligibility responde si los facts conocidos no muestran un bloqueador. Gateway execution valida identidad, policy, argumentos y disponibilidad real antes de ejecutar; conserva la última palabra. El runtime R3 ya usa capacidades gobernadas por este boundary, pero P6 todavía no controla exposición de herramientas ni despacha una capability por sí mismo.

## 11. CommercialDomainReadModel

`lib/brain/commercial/domain-read-model/types.ts` define projections de case/work, objective, cart, destination, shipping, quote, customer, conversación y evidencia. Su freshness común, en `freshness.ts`, es `CURRENT`, `STALE`, `SUPERSEDED`, `HISTORICAL` o `UNKNOWN`; timestamps son provenance, mientras versiones y anchors permiten razonar sobre vigencia.

Ausencia conocida no equivale a unknown: `null` puede significar una fact ausente; un reader que no puede afirmar el estado entrega failure/UNKNOWN. Quote y shipping están anclados a facts conocidos, pero aún existe deuda: la frescura del locator/proyección quote y la verdad remota pueden colapsar conservadoramente en `UNKNOWN`; no existe TTL temporal canónico para inventar.

P6 no construye otro DRM ni duplica freshness. Reutiliza el DRM P2 ya construido, añade cero HTTP/DB y no inventa truth.

## 12. Current P6.3 Wiring

```text
runNativeAutonomousCycle
-> runSalesAgentRuntimeCycle
-> ensureCommercialWorkCase (kernel P3.5)
-> runSalesAgentRuntime
-> buildDomainReadModel P2 (una vez, antes del provider)
-> evaluate pre-cognition eligibility (work durable al inicio del turno)
-> compact AgentCapabilityEligibilityView -> AgentTurnInput -> prompt/provider
-> provider/harness
-> CommercialProposal
-> P5 reconciliation
-> work post-reconciliation -> runCapabilityEligibilityShadow
-> commercial_capability_eligibility_evaluated
-> dispatchSalesAgentTerminalOutcome
```

La eligibility que llega al modelo es pre-cognición: usa el work durable al inicio del turno y el DRM ya construido. El shadow/evento existente conserva su semántica post-P5: `runSalesAgentRuntimeCycle` empieza con el work del kernel y, si P5 aplica una mutación, reemplaza la referencia por `updatedWork`. Proposal `null` con QUOTE durable es NOOP P5 y el snapshot post-reconciliation sigue evaluando QUOTE. No son un snapshot único ni se ejecuta un segundo DRM o provider call. Si no hay DRM para P6.3, el input cognitivo degrada a `capabilityEligibility: null`; para P6.2 post-P5 no se reconstruye DRM ni se emite evento.

## 13. Same-turn Context

P6.3 retiró el `WeakMap` temporal P2→P6. `SalesAgentRuntimeResult.cognitionContext` mantiene explícitamente, sólo durante el ciclo en memoria, el DRM ya construido y el `preCognitionCapabilityEligibility` interno. No cruza turns, no se persiste y no alcanza provider, dispatcher ni Gateway. El provider recibe solamente `AgentCapabilityEligibilityView` dentro del `AgentTurnInput`/prompt.

## 14. Feature Flags

Todas se resuelven en `lib/brain/commercial/config/commercialCycleConfig.ts` con `readEnvFlag(..., false)`. `.env.example` declara explícitamente P2, P3.5, P6 y el runtime legacy; P4/P5 son igualmente fail-closed en código, pero no tienen entrada explícita allí al estado de este handoff. Para un shadow productivo completo deben declararse conscientemente en el entorno, no inferirse de su ausencia.

| Flag | Función | Default en código | Dependencia | Shadow productivo completo |
|---|---|---|---|
| `BRAIN_R3_AGENT_TURN_INPUT_SHADOW_ENABLED` | construye observación P2/DRM | `false` | necesaria para P6 | `true` |
| `BRAIN_R3_COMMERCIAL_WORK_KERNEL_ENABLED` | create/reuse del case kernel P3.5 | `false` | necesaria para work P6 | `true` |
| `BRAIN_R3_COMMERCIAL_PROPOSAL_SHADOW_ENABLED` | proposal P4 del mismo harness | `false` | necesaria para transición nueva del turno | `true` |
| `BRAIN_R3_COMMERCIAL_OBJECTIVE_RECONCILIATION_ENABLED` | P5 proposal→work | `false` | requiere proposal + kernel | `true` |
| `BRAIN_R3_CAPABILITY_ELIGIBILITY_SHADOW_ENABLED` | evaluator/event P6 | `false` | requiere DRM + work para emitir | `true` |
| `BRAIN_R3_CAPABILITY_ELIGIBILITY_INPUT_ENABLED` | vista P6.3 para AgentTurnInput/prompt | `false` | requiere DRM; `null` si no puede construirse | `false` hasta activación controlada |
| `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED` | runtime histórico CommercialWork/R2 | `false` | independiente; no usar para R3 kernel | `false` |

El mínimo observacional P6 sobre work ya existente es P2 + kernel + P6. El conjunto de cinco flags es el necesario para validar la transición completa proposal→P5→P6.

## 15. Event Ordering

Orden real para un turno con mutación P5:

```text
commercial_work_kernel_resolved
-> commercial_objective_reconciliation_decided
-> commercial_objective_reconciled (si mutation)
-> commercial_capability_eligibility_evaluated
-> dispatch
-> commercial_proposal_shadow_built
```

La proposal existe en memoria antes de P5; su evento se persiste más tarde, post-dispatch. El dedupe P6 es `commercial-capability-eligibility-evaluated:<inboundMessageId>`. El evento usa `sourceEventId = inboundMessageId`, conserva `correlationId` y tiene payload PII-safe: work/version/objective, capability names, reason codes y metadata version; no customer text, IDs de customer/product ni CoT.

## 16. Test Baseline

Validación al cierre P6.3:

- P4: 17/17 PASS.
- P5: 35/35 PASS.
- P6: 26/26 PASS (20 base/B + 6 integración C).
- P6.3: 10/10 PASS (contrato/view, prompt/provider, fallback `null` y momentos pre/post).
- `npm run typecheck`: PASS.
- lint focalizado: PASS.
- `git diff --check`: PASS.

Suites DB se clasifican `ENVIRONMENT_BLOCKED` si MariaDB local no está disponible. Nunca apuntar tests a producción para obtener verde.

## 17. Relevant Commits

| Commit | Propósito |
|---|---|
| `1b266bc` | P3.5 CommercialWork kernel bootstrap |
| `5a8ce29` | fix de dynamic import del worker/turn settlement |
| `a8e0b6b` | P4 CommercialProposal shadow |
| `099ef07` | P5 objective reconciliation determinista |
| `b2fd0c5` | limpieza TypeScript/validación |
| `2a74ed5` | P6.2-A structural capability eligibility shadow |
| `f09e308` | P6.2-B create_quote/get_quote eligibility |
| `e233c78` | P6.2-C integration validation |

## 18. Known Technical Debt

**Architectural debt**

- P6.3 no filtra tools y Gateway continúa como autoridad runtime; esa integración queda para P7.
- TTL/freshness temporal no está formalizado; quote locator freshness y remote truth pueden terminar en `UNKNOWN`.
- Registries y paths legacy/R2 aún existen físicamente y no deben recuperar autoridad.

**Operational debt**

- Quote Service requiere smoke operacional donde aplique; no inferir disponibilidad desde P6.
- Suites DB pueden estar environment-blocked por MariaDB/Docker local.
- La deuda operativa de Elastic IP/hostname EC2 debe verificarse contra la documentación/infra vigente antes de cualquier rollout; no existe como input de P6.

**Trabajo diferido intencionalmente**

- Filtrado dinámico de tools y control de ejecución por eligibility.
- P7/P8/P9, incluyendo reprojection/continuación y recovery durable.

## 19. P6.3 Delivered Integration

P6.3 conecta:

```text
CapabilityEligibilitySnapshot
-> AgentTurnInput
-> prompt evidence
-> R3 cognition
```

Regla central: **“Eligibility informs cognition. Gateway authorizes execution.”** Conserva el mismo provider/harness, Gateway y tool pool; no habilita hard filtering.

## 20. P6.3 Non-Goals

- No dynamic tool pruning todavía.
- No reemplazar Gateway ni bypass de capability execution.
- No reutilizar planner R2 ni depender de `deriveCommercialWorkSteps`.
- No ORDER/AFTER_SALES, `issue_quote` ni `send_quote_email` sin fase explícita.
- No segundo DRM, segundo registry ni evaluación LLM de eligibility.
- No prediction de availability ni workflow rígido.
- No requisito nuevo de shipping para `create_quote`.

## 21. P6.3 Cognitive View

Representación implementada, compacta y determinista:

```yaml
capabilityEligibility:
  eligible:
    - search_products
    - calculate_shipping
    - create_quote
  blocked:
    - capability: get_quote
      reasons:
        - MISSING_QUOTE
```

No es el snapshot interno completo: omite `workId`, versiones de work, `objectiveId`, `evaluatedAt`, clases de ejecución, PII y DRM. Conserva únicamente `schemaVersion`, `metadataVersion`, capability names y reason codes canónicos.

## 22. P6.3 Acceptance Criteria

1. El snapshot llega a AgentTurnInput y el provider ve la misma eligibility.
2. Tool pool y Gateway execution permanecen iguales.
3. El prompt declara eligibility advisory, nunca autoridad.
4. El modelo no pide una capability BLOCKED salvo nueva evidencia/facts en el turno.
5. ELIGIBLE no implica éxito garantizado.
6. No hay DRM ni registry duplicados.
7. P4/P5 no regresan; cortesía/proposal null se conserva.
8. `create_quote` sigue elegible sin shipping cuando cumple sus requisitos; `get_quote` exige quote CURRENT.
9. Flags permiten apagar por completo la influencia P6.3 y hay fallback seguro si no existe snapshot.
10. Telemetría P6 shadow sigue disponible.

## 23. Next Implementation Sequence

P6.3-A/B/C/D está cerrado en código y pruebas locales. La activación de `BRAIN_R3_CAPABILITY_ELIGIBILITY_INPUT_ENABLED` queda apagada por defecto y requiere rollout controlado separado. P7.0 (auditoría comparativa, `docs/audits/r3-p7-0-comparative-harness-capability-runtime-audit.md`) y P7.1 (trusted execution context) están cerrados. Después: P7.2 eligibility/request/outcome correlation, P7.3 in-turn relevant change detection, P7.4 benchmark connection, P8 reprojection + continuation y P9 durable recovery. No crear fases alternativas sin reconciliarlas con la documentación activa.

## 23.1. P7.1 — Trusted Execution Context

P7.1 threads trusted CommercialWork/objective context through capability invocation without granting it execution authority.

`CapabilityGatewayContext` (`capability-gateway/types.ts`) gana cuatro campos opcionales: `workId`, `workVersion`, `objectiveId`, `objectiveType`. Se derivan en `resolveTrustedCommercialExecutionContext` (`sales-agent-runtime/salesAgentRuntime.ts`) a partir del mismo work que el kernel P3.5 ya resolvió este turno (`capabilityEligibilityInput.work`) - sin segunda lectura de DB, sin build de DRM, sin segundo llamado al provider - y se transportan por `RunAgentToolLoopInput` hasta `buildAgentLoopGatewayContext` (`agent-loop/runAgentToolLoop.ts`), que construye el `gatewayContext` compartido de todo el turno.

Invariantes de P7.1:

- Nunca provienen de `AgentStepUseTool.arguments` - no hay canal para que el modelo los suministre o sobreescriba.
- Ninguna capability, `checkAvailability`, `execute`, identity gate ni policy de Gateway los lee para decidir nada; Gateway sigue siendo la autoridad final, sin cambios.
- No se persisten (`crm_capability_executions` no gana columnas), no aparecen en `ToolObservation` ni en el prompt/tool schema.
- `workId`/`workVersion` null significa que no existe work durable este turno; `objectiveId`/`objectiveType` null (con work presente) significa que el work no tiene objective activo - nunca un string sentinel.

El seam para P7.2 (correlacionar la invocación con `preCognitionCapabilityEligibility`, ya calculada en el mismo punto) queda identificado pero no implementado.

## 24. Do Not Accidentally Reintroduce

- No usar `CommercialProposal` como estado persistente ni dejar que el LLM decida directamente el objective durable.
- No crear otro planner ni volver al workflow R2.
- No usar P6 como autorización, llamar services desde P6 ni construir otro DRM.
- No duplicar identity policy, governance ni capability registry.
- No filtrar tools en P6.3 sin fase explícita.
- No guardar razonamiento/CoT, customer text o PII en telemetry.
- No bloquear `create_quote` por shipping ausente.
- No reemplazar wiring válido por un rebuild conceptual completo.
