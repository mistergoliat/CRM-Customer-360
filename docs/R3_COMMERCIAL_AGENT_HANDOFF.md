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
P7.1 -> trusted execution context (workId/objectiveId llegan al Gateway)
P7.2 -> correlacionar eligibility pre-cognición <-> request <-> outcome real
P7.3 -> distinguir bloqueador resuelto en el turno vs pedido repetido
P7.7 -> intento de fix mínimo de prompt para grounding -> commit (RED, ver 23.7)
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
| P7.2 eligibility/request/outcome correlation | CLOSED | evento `commercial_capability_invocation_observed` por invocation, PII-safe, fail-open, sin autoridad de ejecución |
| P7.3 in-turn relevant evidence correlation | CLOSED | `inTurnEvidence` en `commercial_capability_invocation_observed`; distingue evidencia relevante producida en el turno de un pedido repetido sin evidencia nueva, sin afirmar blocker resuelto |
| P7.4 E2E benchmark harness integration | CLOSED | `lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/`; instrumento de medición construido y validado (trace/metrics/failure taxonomy/15×3 runner/artifacts); la corrida real de 45 es P7.5 |
| P7.5 E2E commercial benchmark run | CLOSED | run `2026-09-18T03-56-41-903Z-live`, 45/45 ejecutadas, HYBRID; ver sección 23.5. Cuello de botella medido: grounding→commit (`select_products`) y timeout de 20s; P8 no respaldado por la evidencia |
| P7.6 runtime configuration parity & commercial decision completion | CLOSED | `docs/audits/r3-p7-6-runtime-config-parity-audit.md`; grounding → commit reproduce bajo configuración cognitiva/temporal equivalente a EC2 sobre `develop`; causa primaria PROMPT_POLICY / decisión del modelo; P8 sin evidencia a favor; ver sección 23.6 |
| P7.7 grounding-to-commit behavior fix | CLOSED | `docs/audits/r3-p7-7-grounding-to-commit-behavior-fix.md`; fix mínimo aplicado y medido con la configuración EC2-equivalente de 23.6; `commitAfterGroundingRate` no mejoró (2/18=11.1% vs baseline 2/20=10%); architecture signal RED sobre la métrica declarada, con efecto lateral real (no atribuible a ruido) en turnos de seguimiento; ver 23.7 |
| P7.8 autonomous harness A/B | CLOSED | `docs/audits/r3-p7-8-autonomous-harness-ab.md`; hibrido (A) vs harness autonomo minimo (B), mismo modelo/corpus/estado/Gateway; `commitAfterGroundingRate` A 3/20=15.0% vs B 3/21=14.3%, sin sobre-mutacion ni degradacion de seguridad en B; architecture signal `NO_CLEAR_WINNER`; ver 23.8 |
| P7.8-R true harness & capability tax | CLOSED | `docs/audits/r3-p7-8r-true-harness-capability-tax.md`; R3 vs harness autonomo real (loop propio, function calling nativo) con contrato de tools actual (B) y adelgazado (C1); 90 runs; **Preregistered architecture signal: `NO_CLEAR_WINNER`**; **Post-hoc corrected exploratory finding: `CAPABILITY_CONTRACT_IS_BOTTLENECK` candidate, requires confirmatory replication** (efecto en pedir la cantidad, no en el commit durable); sin costo atribuible a la orquestacion R3; ver 23.9 |
| P8 reproject + continue cognition | PENDING | sin evidencia a favor en P7.5 ni P7.6; no se promueve a NEXT |
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

P6.3-A/B/C/D está cerrado en código y pruebas locales. La activación de `BRAIN_R3_CAPABILITY_ELIGIBILITY_INPUT_ENABLED` queda apagada por defecto y requiere rollout controlado separado. P7.0 (auditoría comparativa, `docs/audits/r3-p7-0-comparative-harness-capability-runtime-audit.md`), P7.1 (trusted execution context), P7.2 (invocation coherence telemetry), P7.3 (in-turn relevant evidence correlation) P7.4 (E2E benchmark harness integration), P7.5 (E2E commercial benchmark run, sección 23.5), P7.6 (runtime configuration parity, sección 23.6) y P7.7 (grounding-to-commit behavior fix, sección 23.7) están cerrados. P7.7 midió architecture signal RED sobre la métrica declarada (`commitAfterGroundingRate` no mejoró bajo la configuración EC2-equivalente) - P7.8 (prompt mínimo sobre el mismo loop R3, sección 23.8) y P7.8-R (harness autónomo real y costo del contrato de capabilities, sección 23.9) también están cerrados; el siguiente paso recomendado (un corpus derivado de tráfico real de EC2 y/o el contrato compartido de `select_products`/cantidad) queda fuera del alcance de este documento hasta que se autorice explícitamente. P8 reprojection + continuation y P9 durable recovery siguen sin promoción automática a NEXT: la evidencia de P7.5, P7.6 y P7.7 no respalda P8 como siguiente paso (ver 23.5, 23.6, 23.7). No crear fases alternativas sin reconciliarlas con la documentación activa.

## 23.1. P7.1 — Trusted Execution Context

P7.1 threads trusted CommercialWork/objective context through capability invocation without granting it execution authority.

`CapabilityGatewayContext` (`capability-gateway/types.ts`) gana cuatro campos opcionales: `workId`, `workVersion`, `objectiveId`, `objectiveType`. Se derivan en `resolveTrustedCommercialExecutionContext` (`sales-agent-runtime/salesAgentRuntime.ts`) a partir del mismo work que el kernel P3.5 ya resolvió este turno (`capabilityEligibilityInput.work`) - sin segunda lectura de DB, sin build de DRM, sin segundo llamado al provider - y se transportan por `RunAgentToolLoopInput` hasta `buildAgentLoopGatewayContext` (`agent-loop/runAgentToolLoop.ts`), que construye el `gatewayContext` compartido de todo el turno.

Invariantes de P7.1:

- Nunca provienen de `AgentStepUseTool.arguments` - no hay canal para que el modelo los suministre o sobreescriba.
- Ninguna capability, `checkAvailability`, `execute`, identity gate ni policy de Gateway los lee para decidir nada; Gateway sigue siendo la autoridad final, sin cambios.
- No se persisten (`crm_capability_executions` no gana columnas), no aparecen en `ToolObservation` ni en el prompt/tool schema.
- `workId`/`workVersion` null significa que no existe work durable este turno; `objectiveId`/`objectiveType` null (con work presente) significa que el work no tiene objective activo - nunca un string sentinel.

El seam para P7.2 (correlacionar la invocación con `preCognitionCapabilityEligibility`, ya calculada en el mismo punto) queda identificado pero no implementado.

## 23.2. P7.2 — Invocation Coherence Telemetry

P7.2 correlaciona, por cada invocation de capability dentro de un turno, cuatro cosas que ya existen por separado: la eligibility pre-cognición que vio el modelo (P6.3), el capability que efectivamente pidió, el trusted commercial context de P7.1 (`workId`/`workVersion`/`objectiveId`/`objectiveType`, leído del mismo `gatewayContext` que P7.1 ya construye) y el outcome real (Gateway + `ToolObservation`). No recalcula eligibility, no reconstruye DRM, no agrega autoridad de rechazo y no cambia `ToolObservation` ni la política del Gateway.

Componentes:

- `lib/brain/commercial/capability-eligibility/lookupCapabilityEligibility.ts#lookupCapabilityEligibility`: función pura, dado un `CapabilityEligibilitySnapshot | null` y un nombre de capability, retorna `{status, reasonCodes, metadataVersion} | null`. `null` cuando no hay snapshot o la capability no está cubierta por las definitions P6 - nunca un `ELIGIBLE`/`BLOCKED` inventado.
- `RunAgentToolLoopInput.preCognitionCapabilityEligibility` (`agent-loop/runAgentToolLoop.ts`): el mismo snapshot que `salesAgentRuntime.ts` ya computó antes del provider (`preCognitionCapabilityEligibility` local), threadeado sin cambios - no es el `capabilityEligibility` compacto que ve el prompt (ese sigue gateado por `BRAIN_R3_CAPABILITY_ELIGIBILITY_INPUT_ENABLED`); este campo es telemetry-only y se llena siempre, incluso con el flag P6.3 apagado (queda `null` en ese caso, exactamente el caso "eligibility ausente").
- `processUseToolStep`'s return interno ahora incluye `gatewayResult: CapabilityGatewayResult | null` - `null` en cada rechazo pre-Gateway (unregistered/duplicate/evidence/not-exposed/opportunity-unavailable), el resultado real en cualquier llamada que sí alcanzó `executeGovernedCapability`. Cambio interno de una función no exportada; no altera ningún contrato público.
- `recordCapabilityInvocationCoherenceObservation` (mismo archivo): construye el payload PII-safe y llama `recordCommercialCapabilityInvocationObservedEvent` (`events/service.ts`) envuelto en el mismo try/catch fail-open que `recordPreGatewayToolRejection` ya usa - una falla de escritura se pliega a `warnings`, nunca se propaga, nunca cambia el `ToolObservation` ya construido.
- Evento `commercial_capability_invocation_observed` (`events/types.ts`/`normalize.ts`/`dedupe.ts`): una fila por `(inboundMessageId, stepIndex, capability)` - `stepIndex` es el mismo ordinal determinista que `runAgentToolLoop` ya asigna a cada decisión de la fase de gathering (`steps[].stepIndex`), así que una llamada repetida a la misma capability con distinto `stepIndex` nunca colisiona y un retry de grabación sí colapsa. Payload: `capability`, `stepIndex`, `workId`/`workVersion`/`objectiveId`/`objectiveType`, `eligibilityAtTurnStart` (status/reasonCodes/metadataVersion o `null`), `gateway` (status/errorCode/retryable o `null` si nunca se llamó al Gateway) y `toolObservation` (status/errorCode/retryable). Nunca argumentos crudos, texto del cliente, IDs de producto/quote/customer, CoT ni prompt.

Placement: se registra para toda invocation que `processUseToolStep` acepta como decisión de uso de herramienta - incluye los rechazos pre-Gateway (evidencia, duplicado, no registrado, no expuesto, opportunity-unavailable), marcados con `gateway: null` porque el Gateway nunca corrió, nunca con un outcome de Gateway inventado. No se emite por exposición de prompt, construcción de eligibility ni un JSON inválido antes de llegar a `processUseToolStep`.

Sin feature flag dedicado: a diferencia de los shadows P6.2/P6.3 (que informan al modelo o cambian el prompt), P7.2 solo agrega una fila de auditoría descriptiva sobre un tool call que ya está dentro de un turno pilotado/allowlisted - mismo criterio que `recordPreGatewayToolRejection`/`insertCapabilityExecution`, que tampoco tienen flag propio en este archivo.

## 23.3. P7.3 — In-turn Relevant Evidence Correlation

P7.3 agrega una señal determinista, puramente observacional, a `commercial_capability_invocation_observed`: distingue "una tool previa del mismo turno produjo evidencia relevante para el blocker que P6.3 vio al inicio del turno" (Case 3) de "el modelo pide la misma capability BLOCKED sin que nada relevante haya cambiado" (Case 4). No recalcula eligibility, no reproyecta el DRM y nunca afirma que el blocker quedó resuelto - eso exige verdad fresca, que sólo P8 puede dar.

Principio central: **"P7.3 correlates eligibility blockers with evidence produced by prior successful tool calls in the same turn. It indicates that a blocker may have changed, not that it is resolved."**

Componentes:

- `lib/brain/commercial/capability-eligibility/blockerEvidenceMapping.ts#CAPABILITY_ELIGIBILITY_REASON_CODE_TO_EVIDENCE`: mapping puro y pequeño, `CapabilityEligibilityReasonCode -> readonly CapabilityEvidenceType[]`, curado a mano. Cubre `MISSING_SELECTION`/`SELECTION_NOT_CURRENT -> COMMERCIAL_SELECTION_STATE`, `MISSING_DESTINATION`/`DESTINATION_NOT_CURRENT -> COMMERCIAL_DESTINATION_STATE`, `MISSING_QUOTE`/`QUOTE_NOT_CURRENT -> QUOTE_CREATED`. Deliberadamente sin entrada para `OBJECTIVE_REQUIRED`, `OBJECTIVE_INCOMPATIBLE` e `IDENTITY_LEVEL_INSUFFICIENT`: ninguna capability del registry declara `evidenceProduced` para objective o identity, y no se inventó una relación para forzar el mapping completo.
- `lib/brain/commercial/capability-gateway/types.ts#CAPABILITY_EVIDENCE_TYPES` gana `COMMERCIAL_DESTINATION_STATE`, y `set_shipping_destination` (`shippingDestinationCapability.ts`) ahora declara `evidenceProduced: ["COMMERCIAL_DESTINATION_STATE"]` - mismo patrón ya usado por `select_products` (`COMMERCIAL_SELECTION_STATE`) y `create_quote` (`QUOTE_CREATED`). Antes de P7.3 el registry no tenía ningún evidence code para destino a pesar de que `MISSING_DESTINATION`/`DESTINATION_NOT_CURRENT` ya existían como reason codes P6 - un gap real, cerrado extendiendo el modelo existente en vez de crear uno paralelo. Es un campo declarativo aditivo: no cambia `checkAvailability`/`execute`, tool pool, prompt ni ningún consumidor existente de `evidenceProduced` (que hoy sólo lee `PRODUCT_IDENTITY`).
- `lib/brain/commercial/capability-eligibility/deriveInTurnEvidence.ts#deriveInTurnEvidenceForInvocation`: función pura (sin IO/DB/HTTP/DRM/Gateway/LLM). Entrada: `currentStepIndex`, `eligibilityAtTurnStart` (`CapabilityEligibilityAtTurnStart | null`, el mismo tipo que P7.2 ya usa) y `priorToolSteps` (una proyección mínima de pasos previos - `stepIndex`/`capability`/`observationStatus` - deliberadamente desacoplada de `AgentLoopStepRecord` para no acoplar este sidecar de P6 a los tipos internos del loop). Salida: `{relevantEvidenceProducedThisTurn, blockerPotentiallyChangedThisTurn, potentiallyAffectedReasonCodes}`. `ELIGIBLE`/`null` en `eligibilityAtTurnStart` siempre retorna la señal vacía sin tocar el status. Sólo cuenta un paso previo con `stepIndex < currentStepIndex` y `observationStatus === "completed"` - nunca el paso actual, nunca uno futuro, nunca `blocked`/`failed`/`skipped`/un rechazo pre-Gateway.
- `runAgentToolLoop.ts#recordCapabilityInvocationCoherenceObservation` (P7.2) ahora también recibe `steps` (el historial de gathering del turno hasta ese punto), construye la proyección mínima y llama `deriveInTurnEvidenceForInvocation` antes de armar el payload - sin alterar `eligibilityAtTurnStart`/`gateway`/`toolObservation` ya existentes.
- `commercial_capability_invocation_observed` (`events/types.ts`) gana `inTurnEvidence: {relevantEvidenceProduced: string[], blockerPotentiallyChanged: boolean, potentiallyAffectedReasonCodes: string[]}`. Mismos códigos ya usados en otras partes del payload (evidence types del Gateway, reason codes de P6) - ningún ID de producto/quote/customer, ningún argumento crudo, mismo `schemaVersion: "1"` (cambio aditivo).

Case 3 (`calculate_shipping` BLOCKED `MISSING_DESTINATION`, `set_shipping_destination` completado antes en el mismo turno) produce `blockerPotentiallyChanged: true` con `COMMERCIAL_DESTINATION_STATE`; Case 4 (mismo blocker, `select_products` - evidencia no relacionada - completado antes) produce `blockerPotentiallyChanged: false`. Ambos casos dejan que el Gateway decida su propio outcome sin condicionarlo.

## 23.4. P7.4 — E2E Benchmark Harness Integration

P7.4 construye el instrumento de medición E2E, no mide todavía al agente. Los dos benchmarks R3 previos (`benchmark/` C01-C12 y `r3StableAgentV1/` TS-0xx) llaman `runAgentToolLoop` directamente - nunca pasan por el kernel P3.5, DRM/eligibility P2/P6, `CommercialProposal` P4, reconciliación P5 ni dispatch/outbox. P7.4 agrega un harness nuevo, separado, que entra por `runSalesAgentRuntimeCycle` (el mismo ciclo R3 que `runNativeAutonomousCycle` usa en producción, sin los gates de canal - access gate, opt-out, pilot allowlist, resolución real de Customer Service - que son concerns de webhook, no del ciclo comercial) y reconstruye causalmente inbound → `AgentTurnInput` → eligibility pre-cognición → tool request(s) → Gateway/`ToolObservation` → in-turn evidence (P7.3) → `CommercialProposal` → P5 → estado durable → respuesta final → outbox.

Componentes (`lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/`):

- `types.ts`: `BenchmarkE2ERunTrace`/`BenchmarkE2ETurnTrace`/`BenchmarkE2EToolInvocationTrace`/taxonomía de fallas/métricas - proyecciones tipadas de contratos ya existentes (P4/P5/P6/P7, `CommercialDomainReadModel`), nunca un segundo modelo semántico.
- `eventRows.ts`: lector delgado de `commercial_event` por `source_event_id = inboundMessageId` (nunca "el evento más reciente") y de `brain_message_outbox` por `id` (la PK, nunca una reconstrucción de `dedupe_key`).
- `buildTurnTrace.ts`: ensamblador puro (sin IO) que arma un `BenchmarkE2ETurnTrace` a partir de las filas ya leídas. `commercial_capability_invocation_observed` (P7.2/P7.3) es la fuente primaria de coherencia por-tool, tal como pide la sección "DATA SOURCE PRIORITY" de la tarea.
- `durableStateSnapshot.ts`: snapshot antes/después de cada turno via el mismo `buildR3AgentTurnInputShadowDomainReadModel` que P2 ya usa (una lectura externa, nunca una segunda reconstrucción dentro del turno real).
- `conversationalSignals.ts`: detectores estructurales - re-pregunta de un hecho ya `CURRENT` (gateado por `forbidden.repeatKnownDestination`/`repeatKnownSelection` por-caso, para no confundir "reafirmar sin necesidad" con "el cliente cambió de opinión"), claim de cotización sin `quote` durable, reuso del warning real `agent_loop_mutation_claim_blocked:` (nunca un regex reimplementado), repetición de saludo.
- `scoreCase.ts` / `failureClassification.ts`: outcome + invariantes (nunca una secuencia de tools rígida salvo que el caso sea de tool-selection), y una taxonomía de 12 categorías donde dependencia/identidad-de-fixture/eligibilidad-ignorada se descartan antes de nunca culpar a "razonamiento del modelo".
- `environmentHealthPrecheck.ts`: MariaDB (ping real), Quote Service (sólo si el corpus lo requiere), provider endpoint (sólo en modo live) son las únicas dependencias reales; Catalog/Carrier siempre están stubbeados localmente y Customer Service nunca se llama (identidad inyectada) - marcados `NOT_REQUIRED`, nunca un `READY` engañoso.
- `metrics.ts`: métricas deterministas (progresión comercial, comportamiento de tools, coherencia de eligibility, conversacionales) - todo rate es `null`, nunca `0` fabricado, cuando el denominador es 0.
- `corpus.ts`: 15 casos nuevos (`E01`-`E15`), orientados a resultado comercial, reusando el mismo catálogo/comunas fixture de `benchmark/environment.ts`. Ninguno impone una secuencia rígida de tools salvo donde el caso es explícitamente sobre eso.
- `runCommercialE2ECase.ts` / `runCommercialE2ECorpus.ts`: corre N turnos reales por caso, aislados por `setupR3BenchmarkEnvironment` (opportunityId/conversationId frescos por run - nunca compartidos), con los flags P2/P3.5/P4/P5/P6-shadow/P6-input siempre `true` y open-turn/harness-aligned/persistent-session leídos de la config real (`commercialCycleConfig.ts`), nunca asumidos.
- `artifacts.ts` + `scripts/r3-commercial-e2e-benchmark.ts`: `manifest.json`/`runs.jsonl`/`summary.json`/`failures.json` en `benchmark-results/<run-id>/`. El script requiere `NODE_ENV=test` y `crm_test` (mismo gate de seguridad que `r3StableAgentV1`), nunca `main_management` ni producción.

**Hallazgo/fix colateral**: `setupR3BenchmarkEnvironment` (`r3StableAgentV1/environment.ts`) dejaba el servidor HTTP local de Catalog huérfano (nunca cerrado) si el seeding de DB fallaba después de abrirlo - eso colgaba el proceso de test entero (confirmado también en el archivo preexistente `environment.test.ts`, no es una regresión de P7.4). Corregido con un `try/finally` mínimo alrededor del seeding; el path de éxito queda byte-idéntico.

**Ejecutar el instrumento** (requiere `NODE_ENV=test` + `crm_test`, nunca producción):

```powershell
NODE_ENV=test npx tsx scripts/r3-commercial-e2e-benchmark.ts                 # offline, 1 run/case (15 runs), humo
NODE_ENV=test npx tsx scripts/r3-commercial-e2e-benchmark.ts --runs=3        # offline, 15x3 = 45 runs (la corrida P7.5)
NODE_ENV=test npx tsx scripts/r3-commercial-e2e-benchmark.ts --case=E09      # un solo caso
```

`ENVIRONMENT_BLOCKED` significa que MariaDB no respondió en el precheck - ningún caso corrió, ninguno cuenta como falla del modelo. Un `DEPENDENCY_FAILURE` por-run (ej. `create_quote` sin `QUOTE_SERVICE_BASE_URL`) es distinto: el batch sí corrió, sólo ese caso no pudo completarse por una dependencia real ausente.

P7.4 no mejora el comportamiento del agente ni corre las 45 runs reales - eso es P7.5.

## 23.5. P7.5 — E2E Commercial Benchmark Run

P7.5 no agrega arquitectura: mide al agente actual con el instrumento P7.4. Ningún prompt, Gateway, eligibility, tool pool ni CommercialWork fue modificado.

**Corrida**

| Campo | Valor |
|---|---|
| Run ID / artifacts | `benchmark-results/2026-09-18T03-56-41-903Z-live/` (`manifest.json`, `runs.jsonl`, `summary.json`, `failures.json`; untracked) |
| SHA medido | `db23a29f74de997fb06310515b0ade71ad8588b4` (el `gitSha` del manifest) |
| Código efectivamente ejecutado | `db23a29` + el parche instrumental de 2 archivos descrito abajo, aún sin commitear durante la corrida. El commit posterior que contiene ese parche y este documento **no** es el SHA benchmarkeado |
| Execution mode | `HYBRID`: runtime/Gateway/MariaDB/P4/P5/P6/P7/outbox reales; Catalog/Carrier/commune stubbeados; provider DeepSeek real |
| Modelo | `deepseek-v4-flash`, temperature 0, maxDecisions 3, maxToolExecutions 2, timeout 20000 ms (defaults seguros de `sales-agent-configuration`, no afinados) |
| Flags | P2/P3.5/P4/P5/P6-shadow/P6-input forzados `true` por el harness; open-turn, harness-aligned, live-assimilation, compaction `false`; persistent-session `true` (default de código) |
| Runs | 45 planificadas, 45 ejecutadas, 0 abortadas, 0 traces incompletos |
| Entorno | MariaDB `READY` (`crm_test` local, Docker), provider `READY`, Quote Service `BLOCKED` (sin `QUOTE_SERVICE_BASE_URL`/`API_KEY`), Catalog/Carrier/Customer Service `NOT_REQUIRED` |
| Overrides de sesión | `NODE_ENV=test`, `DATABASE_NAME=DB_NAME=crm_test`, `DB_WRITE_ENABLED=true`, `BENCHMARK_LIVE_LLM_ENABLED=true`, `BRAIN_AUTONOMOUS_RESPONSES_ENABLED=true` (solo permite el INSERT en `brain_message_outbox`; ningún worker de envío corre) |

**Correcciones instrumentales previas al batch** (HARNESS_FAILURE, no comportamiento del modelo; commit `fix(r3-benchmark): harden commercial E2E baseline harness`):

1. `runCommercialE2ECase.ts`: `buildBaseSnapshot()` dejaba `commercialLineItems`/`shippingDestination` en `null`, a diferencia de `buildNativeCommercialContext.ts`, que los lee en vivo por turno. Estado sembrado por `setup()` o mutado en un turno previo era invisible para P2/P6.3. Ahora se leen en vivo al inicio de cada turno con las mismas funciones que usa producción.
2. `scripts/r3-commercial-e2e-benchmark.ts`: nunca cerraba el pool de `lib/db.ts`, por lo que el proceso no terminaba tras escribir los artifacts. Ahora `resetPoolForTests()` en `finally`.

**Hallazgos**

1. **Grounding → commit (`select_products`)**. En 19 de 21 turnos no confundidos por timeout con intención de selección explícita, el agente llama `get_product_details` y responde sin llamar `select_products` (E02, E04, E05, E07, E14, E15). Es la causa raíz dominante de las fallas de progresión; no es Gateway, argumentos ni estado durable.
2. **Timeout de 20 s**. 19/63 turnos terminaron en `timeout` (100% en E03, 50-100% en E09-E13, 0% en E01/E02/E06/E08/E15), correlacionado con el número de decisiones secuenciales por turno y sin deriva temporal. Es la configuración segura vigente, no una afinada para el benchmark.
3. **Quote Service local unavailable**. Sin Quote Service configurado, el funnel de cotización (E09-E14, 18 runs) no es medible; además muchos turnos expiran antes de llegar a `create_quote`. `quoteConversionRate=0%` no es evidencia sobre el agente.
4. **P8 no respaldado por evidencia**. El patrón "tool ejecuta → estado cambia → el agente razona sobre snapshot viejo en el mismo turno" no domina: los hallazgos 1 y 2 ocurren antes de cualquier reproyección.
5. **Local ≠ EC2**. Esta corrida usa el `.env` y la base Docker locales; no se pudo verificar la configuración productiva (EC2 inalcanzable por SSH desde este entorno). Se requiere un parity audit local vs EC2 (flags, timeout, config publicada del agente, Catalog/Quote Service) antes de extrapolar cualquier número a producción.

**Métricas principales (sobre 45 runs)**: commercialOutcomeCompletionRate 40%; correctObjectiveBehaviorRate 71.1%; gatewayCompletionRate 89.9% (62/69); validArgumentsRate 100%; duplicateToolCallRate 0%; unnecessaryRequestionRate 0%; outboxCompletionRate 100%; terminalReasonDistribution `responded` 42 / `timeout` 19 / `handoff` 2 (63 turnos). `blockedThenCompleted=10` corresponde íntegramente a `OBJECTIVE_REQUIRED`/`OBJECTIVE_INCOMPATIBLE`, evaluados antes de que P5 fije el objective del turno y excluidos a propósito del mapping P7.3; `blockedRequestCoherenceRate=0%` es estructural para este corpus.

**Defectos históricos**: re-saludo 0; re-preguntar destino conocido 0; tool-budget ceiling 0 (el timeout interviene antes); identity fixture descartado (E12 run2 muestra `master_identity_required` correcto); "todo junto" reproduce 3/3 (E15 nunca fija el destino dicho en el mismo mensaje); reemplazo de selección inconcluso (E04/E05 no llegan a mutar).

**Deuda del harness detectada (no corregida, fuera de la ventana de smoke)**: (a) `QUOTE_CONFIRMATION_CLAIM_PATTERN` en `conversationalSignals.ts` es ciega a negación y produjo un falso positivo en E11 run0; (b) `failureClassification.ts` no tiene rama para `terminalReason=timeout`, así que esos casos caen en `UNKNOWN`/`DURABLE_STATE_FAILURE`/`MODEL_REASONING`; (c) casos sin `requiredToolsAnyTurn` que nunca intentan la mutación caen en `UNKNOWN`.

**Comparación histórica**: las cifras del benchmark previo (tool selection ≈86.7%, boundary ≈0%) no constan en artifacts ni docs del repo; `validArgumentsRate` y duplicados son LEGACY COMPARABLE, el resto NEW E2E METRIC. No se declara mejora porcentual.

**Siguiente fase recomendada por evidencia**: no P8. Primero (i) investigación acotada de por qué el agente no completa `select_products` tras `get_product_details`, (ii) revisión del timeout de 20 s frente a latencia real en turnos multi-decisión, (iii) parity audit local vs EC2, (iv) repetir E09-E14 con Quote Service configurado. P8 sigue `PENDING`.

**Nota P7.6 (matiza este baseline)**: P7.5 midió un runtime materialmente distinto al de EC2 (sin open-turn, harness-aligned ni compaction; timeout 20 s en vez de 60 s; `thinking` activo en vez de deshabilitado; vista P6.3 que EC2 no tiene). Por eso: el hallazgo 2 (timeout de 20 s) era solo local y con la configuración productiva desaparece (0 de 30 turnos); el estado durable post-turno del harness era obsoleto (3 de las 35 fallas eran falsos negativos, 10 → 13 PASS de 45); el techo de 2 tools explicaba el "todo junto" pero no el hallazgo 1, que sí se sostiene (ver 23.6). Ítems (i) a (iii) quedaron resueltos en P7.6; (iv) sigue abierto y `quote-service` está detenido en EC2.

## 23.6. P7.6 — Runtime Configuration Parity & Commercial Decision Completion

**P7.6 CLOSED.** Detalle completo, matriz LOCAL vs EC2 y trazas: `docs/audits/r3-p7-6-runtime-config-parity-audit.md`. Sin cambios de prompt, Gateway, eligibility, CommercialWork ni arquitectura de tools; sin P8, sin MCP.

**Conclusión causal.** El defecto *grounding → commit* reproduce bajo configuración cognitiva/temporal equivalente a EC2 sobre el código actual de `develop`.

- **Causa primaria: PROMPT_POLICY / decisión del modelo.** El modelo declara `requestedOutcome` `PRODUCT_SELECTION` o `QUOTE_CREATION` en los turnos sin commit (entiende la intención) y decide responder, mayormente ofreciendo el link.
- **Descartados como causa primaria:** timeout, presupuesto de tools, vista P6.3 de eligibility, `thinking` y el catálogo del harness.
- **P8: sin evidencia a favor.** No apareció ningún caso de decisión tomada sobre un snapshot obsoleto; el único snapshot viejo real fue el del propio harness y está corregido.

**Configuración EC2 verificada (2026-09-21, solo lectura).** EC2 corre `develop` @ `b2fd0c5` (10 commits detrás: sin P6/P6.3/P7.x), R3 habilitado con allowlist de piloto, open-turn, harness-aligned, live assimilation y compaction en `true`, delay de settle 5000 ms (máx. 20000), envío real a Meta habilitado, `thinking: "disabled"` en la rama R3 y config publicada (id 2) con `timeoutMs` 60000, `maxOutputTokens` 4000, `maxModelRetries` 5 y `customInstructions` vacío. `quote-service`, `crm-commercial-work` y `crm-followup` están detenidos. Tasa de timeout observada en producción: 5 de 143 loops (3.5%), todos el 2026-09-14.

**Qué reproduce (y qué no) el harness.** "EC2-equivalent" no es paridad total:

| Categoría | Elementos |
|---|---|
| EC2-equivalent reproducido | open-turn; harness-aligned message model; timeout 60 s; `maxOutputTokens` 4000; `maxModelRetries` 5; `thinking` deshabilitado; compaction habilitada pero **no disparada** (solo actúa sobre 40 mensajes crudos) |
| `NOT_REPRODUCIBLE_IN_HARNESS` | **live assimilation**: el flag se pasa pero **no fue realmente ejercitado**; su ancla es `Number(inboundMessageId)` como id de `conversation_message` y el harness usa ids de texto y no crea mensajes entrantes posteriores |
| `EC2_ONLY_CHANNEL_BEHAVIOR` | Meta webhook; HTTPS; verificación de firma; settle de 5 s; eventos delivery/read; worker real de outbox (no se simuló con `sleep`) |

Tipo de benchmark: **develop-target parity** (código actual con P5/P6/P7 encendidos + configuración cognitiva/temporal de EC2), no EC2-current parity (`b2fd0c5`, no ejecutado). Diferencias residuales: identidad de empresa del prompt, catálogo/carrier/identidad stubbeados.

**Palancas del harness** (`BENCHMARK_E2E_*`, apagadas por defecto, `.env` intacto; el manifest registra `benchmarkOverrides` y `notReproducibleInHarness`): `OPEN_TURN_ENABLED`, `HARNESS_ALIGNED_MESSAGE_MODEL_ENABLED`, `LIVE_TURN_ASSIMILATION_ENABLED`, `SESSION_COMPACTION_ENABLED`, `MODEL_TIMEOUT_MS`, `MAX_OUTPUT_TOKENS`, `MAX_MODEL_RETRIES`, `THINKING`, más `MAX_TOOL_CALLS`, `ELIGIBILITY_INPUT_ENABLED` y `CATALOG_QUERY_AWARE` (diagnóstico).

**Resultado R2** (configuración EC2-equivalente + catálogo que resuelve el producto nombrado; 6 casos x 3 runs; run `2026-09-21T04-10-06-911Z-live`, archivado en `~/benchmark-archive/r3-p7-6/`):

| Medición | R2 |
|---|---|
| Turnos con intención de compra explícita | **27** |
| Llegaron a `get_product_details` | **20** |
| Intentaron `select_products` | **2** (ambos E15) |
| Grounded → respuesta final sin `select_products` | **18 de 20** |
| Finalización forzada | **0** |
| Timeouts | **0** |
| Tool executions aún disponibles tras el grounding | **18-19** |
| Tiempo transcurrido tras el grounding | **3.0-4.6 s de 60 s** |

R1 (misma configuración con el catálogo del harness sin cambios, `2026-09-21T04-08-10-961Z-live`) no responde la pregunta: el stub siempre devuelve `clarification_required` con 2 candidatos y solo 2 de 27 turnos llegan al grounding.

Otras lecturas: cuando el mensaje trae cantidad y destino el modelo avanza (E15 completa `select_products`, `set_shipping_destination` y `calculate_shipping` en un turno en 2 de 3 runs; con el techo de 2 tools de P7.5 eran 0 de 3). Con `thinking` deshabilitado la latencia por llamada es p50 1.4 s / p90 2.0 s. E04 turno 1 ("mejor dos unidades") baja de 3/3 (config local) a 0/3 con la configuración EC2, sin atribuir a una palanca.

**Fixes del instrumento** (no cambian al agente): estado durable post-turno releído antes de cada captura (con test de regresión); categoría `TIMEOUT` propia; `QUOTE_CONFIRMATION_CLAIM_PATTERN` entiende negaciones; precheck de Quote Service con `QUOTE_SERVICE_AUTH_TOKEN`; regex del stub de catálogo corregida (afectaba solo a las consultas por la "Pro" en C4/C5, E05 turno 1).

**Cautelas y deuda abierta.** n=3 por celda; catálogo, carrier e identidad son stubs. El tráfico real de EC2 (5 conversaciones) mostró solicitudes de `select_products` tras el grounding en 4 de 5, así que el corpus (primer mensaje "quiero X") puede ser más exigente. Clasificador: un caso que nunca intenta la herramienta cae en `UNKNOWN` y `DURABLE_STATE_FAILURE` se dispara si *cualquier* tool relevante completó (13 de 16 fallas de R2 son `UNKNOWN`). Fuera del agente: restaurar `quote-service` en EC2 y revisar por qué `crm-commercial-work` y `crm-followup` están detenidos con el worker habilitado.

**Siguiente (P7.7, no iniciado):** cambio mínimo, medido con la configuración EC2-equivalente de esta sección: primero una variante acotada de la política de commit vía `configuration.customInstructions` (vacío en EC2, prueba reversible); solo si funciona, evaluar `SELECT_PRODUCTS_RULE_LINES` y la regla de cierre obligatoria del link, y alinear `Steps remaining` con el contrato real. Guardas: E04 turno 1 no debe empeorar y E15 debe conservar 2 de 3.

## 23.7. P7.7 — Grounding-to-Commit Behavior Fix

**P7.7 CLOSED - RED.** Detalle completo, auditoría de la política de prompt y trazas: `docs/audits/r3-p7-7-grounding-to-commit-behavior-fix.md`. Sin backend guard, sin forced tool call, sin cambio de Gateway/P4/P5/P6, sin P8, sin MCP.

**Causa confirmada (auditoría, antes de editar).** La regla de cierre obligatoria (`COMMERCIAL_CLOSING_RULE_LINES`: cerrar con exactamente `"¿Quieres que te envíe el link para revisarlo?"` cuando la respuesta identifica un único producto) es más específica e imperativa que `SELECT_PRODUCTS_RULE_LINES` y nunca menciona `select_products` como alternativa - compite directamente con `COMMERCIAL_BEHAVIOR_POLICY_RULE_LINES[0]` ("prefer executing over asking permission"). No existía ninguna regla que conectara explícitamente "grounding vía `get_product_details`" con "por lo tanto persistir con `select_products`". Cantidad: `SELECT_PRODUCTS_INPUT_SCHEMA` no tiene default de `quantity` - correcto no inventar uno; la regla preexistente que pide aclarar cantidad ambigua ya cubría eso y no se tocó.

**Fix aplicado (dos ediciones, un archivo, `buildAgentStepPromptPackage.ts`).** (A) una línea nueva al final de `SELECT_PRODUCTS_RULE_LINES` ("explicit purchase or selection intent... is a request to act, not merely an informational one... get_product_details only grounds evidence... execute select_products in this same turn before writing a response that only presents or offers to link the product"), que fluye automáticamente a `SELECT_PRODUCTS_FINALIZATION_RULE_LINES` sin renumerar el `slice(3)` existente. (B) una cláusula nueva en la lista de exclusiones ya existente de `COMMERCIAL_CLOSING_RULE_LINES` (nunca ofrecer el link cuando el cliente expresó intención de compra explícita y `select_products` todavía puede ejecutarse ese turno). Nada más se tocó - ni P4/P5/P6, ni tool metadata, ni `Steps remaining`.

**Medición (misma configuración EC2-equivalente de 23.6, mismo cohorte de 27 turnos que R2).** `commitAfterGroundingRate` = 2/18 = 11.1% (baseline 2/20 = 10%) - **sin mejora material**, la diferencia está dentro del ruido de `n=3`. El patrón "grounding -> `respond` con oferta de link, sin intentar `select_products`" persiste idéntico en 15 de 16 turnos t0 no-E15 (E02, E04 t0, E05 t0, E07, E14 t0: 3/3 cada uno), **con el texto del fix confirmado presente, vía `providerCalls[].requestMessages`, en el prompt real que produjo esas respuestas** - no fue un fix inerte ni un flag no alcanzado.

**Efecto lateral real (no la métrica objetivo).** En turnos de seguimiento donde el cliente aporta el hecho que faltaba en el mismo turno: E04 t1 ("mejor dos unidades") pasó de 0/3 (P7.6-B, EC2-config) a 1/3 con `select_products` ejecutado de inmediato y 2/3 pidiendo la comuna (un hecho real pendiente) en vez de ofrecer el link; E14 t1 ("mejor cotizamela") pasó a 3/3 pidiendo exactamente cantidad+comuna en vez de un link o una cotización fabricada (`ungroundedMutationClaimRate=0`). E15 (multi-hecho en un turno) se mantuvo en 2/3 sin regresión (guarda cumplida).

**Controles negativos y de cantidad.** E01 (consulta puramente informativa): 0/3 llamó `select_products` - sin sobre-mutación. E06/E08 (prerequisitos de shipping): sin sobre-mutación, piden el hecho faltante. Cantidad explícita en el mensaje inicial (E04 t0, "una barra"=1): el fix no logró comprometer en el mismo turno. Reemplazo (E05 t1, "en realidad prefiero la pro"): inconcluso, artefacto del stub de catálogo (mismo gap ya documentado en 23.6 para "la Pro"), sin corrupción de estado.

**Architecture signal: RED sobre la métrica declarada.** No se cumple el criterio de "mejora clara y consistente" sobre el baseline 10%. Por diseño del experimento no se agregaron reglas adicionales más específicas para forzar el número - eso habría sido el patrón de "lógica determinista creciente fuera del modelo" que la fase pedía detectar, no ocultar. El resultado es evidencia directa (no falta de intentos) de que la política textual, aun nombrando explícitamente el conflicto exacto y con el texto confirmado en el prompt real, no desplaza esta decisión concreta del modelo bajo `deepseek-v4-flash` con esta configuración.

**Siguiente por evidencia (no iniciado, fuera de esta fase):** A/B contra el harness autónomo de DeepSeek para aislar si el patrón es específico del modelo/política o estructural al enfoque híbrido; por separado, evaluar un corpus derivado de tráfico real de EC2 (donde `select_products` sí se solicitó tras el grounding en 4 de 5 conversaciones, 23.6 sección 2.8) en vez de seguir iterando sobre el mismo corpus sintético "quiero X sin cantidad" que ya demostró resistencia a este tipo de cambio. No autorizado en este documento; requiere decisión explícita antes de iniciarse.

## 23.8. P7.8 — Autonomous Harness A/B

**P7.8 CLOSED - `NO_CLEAR_WINNER`** (prompt mínimo sobre el MISMO loop R3 y protocolo AgentStep; no es una comparación R3 vs harness autónomo puro, eso es 23.9). Detalle, definiciones de métricas, reglas de señal (fijadas antes de medir) y limitaciones: `docs/audits/r3-p7-8-autonomous-harness-ab.md`. Sin P8, sin MCP, sin cambios de Gateway/CommercialWork/DB/capabilities/tool schemas y sin tocar el prompt híbrido A.

**Diseño.** A = R3 híbrido actual (P7.7). B = harness autónomo mínimo (`benchmark/r3AutonomousAB/autonomousPrompt.ts`, `p7.8-autonomous-v1`, 14 líneas de política vs 150 de A). Mismo loop, tools, Gateway, estado durable, modelo y configuración EC2-equivalente; solo difieren el prompt builder (seam opcional `RunAgentToolLoopInput.promptBuilder`, ausente en producción) y tres flags cognitivos: vista P6.3, contrato P4 y reconciliación P5 (apagados en B; P6 sigue como shadow con `eligibilityInfluencedCognition=false`).

**Medición.** 60 runs live (E02/E04/E05/E07/E14/E15 + controles negativos N01-N04, x3, intercalado determinista), 0 harness failures. `commitAfterGroundingRate` A 3/20 = 15.0% vs B 3/21 = 14.3%; durable idéntico; cohorte fija (27 turnos) `select_products` completado 4 vs 5. Sobre-mutación 0/12 en ambos; validArguments/Gateway/wrongQuantity/corrupción sin diferencias; B usa 62% menos caracteres de system prompt, 58% menos tokens de entrada por turno y menor latencia; B tuvo 2/112 llamadas con JSON inválido (el modelo omite la `}` de cierre), ambas recuperadas.

**Lectura.** Quitar toda la política híbrida no cambia el patrón: en ambas variantes "quiero X" sin cantidad/confirmación se trata como informativo (los turnos grounded sin cantidad declarada no commitean en ninguna variante, 0/13 en A y 0/15 en B; la afirmación original de que "piden la cantidad" usaba un detector defectuoso, ver la fe de erratas en P7.8-R) y cuando el mensaje trae todo (E15) se compromete 3/3. La causa está en lo compartido (modelo y/o contrato de tools), no en la política híbrida. No se adopta B ni se retira P4/P5/P6; P8 sigue sin evidencia.

**Siguiente por evidencia (no iniciado):** corpus derivado de tráfico real de EC2; contrato compartido de `select_products`/cantidad; opcionalmente el mismo A/B con otro modelo.

## 23.9. P7.8-R — True Harness & Capability Tax

**P7.8-R CLOSED.** Detalle, clasificación de lo que P7.8 compartía, pruebas de aceptación, corrección de medición y limitaciones: `docs/audits/r3-p7-8r-true-harness-capability-tax.md`. Sin cambios de producción, Gateway, CommercialWork, DB ni del prompt A; sin P8, sin MCP.

**Diseño.** Tres brazos con el mismo modelo/config/casos/estado/Gateway: **A** = R3 actual; **B** = harness autónomo real (`benchmark/r3TrueAB/trueHarnessLoop.ts`: function calling nativo, sin `runAgentToolLoop`, sin AgentStep, ejecución por `executeGovernedCapability`, estado durable reconstruido tras cada tool; prompt de 1,158 chars) con el contrato de tools actual; **C1** = mismo harness con contrato de tools fino en las 7 capabilities del corpus (`quantity` sigue requerida). C2 (semántica experimental de cantidad) no se implementó: requiere regla de negocio y no ataca el fallo medido.

**Resultado (90 runs, 0 fallos de harness).** Sobre-mutación 0/12, argumentos inválidos 0, rechazos de Gateway 0 y corrupción 0 en los tres. Commit tras grounding 4/19, 4/19, 5/22; commit con cantidad conocida (Q+) 4/9, 4/9, 5/9; commit sin cantidad (Q-) 0/18 en todos. Progreso conversacional (cohorte fija, detector estricto): A 7/27, B 9/27, C1 16/27. Señales, con la distinción metodológica que no debe perderse:

- **Preregistered architecture signal:** `NO_CLEAR_WINNER` (regla y umbrales fijados antes de medir, detector heredado de P7.8, que resultó defectuoso).
- **Post-hoc corrected exploratory finding:** `CAPABILITY_CONTRACT_IS_BOTTLENECK` candidate, requires confirmatory replication. Sale de recalcular los mismos 90 runs con un detector estricto de "pide cantidad" definido después de ver resultados (validado a mano sobre los 54 mensajes Q-, aplicado igual a los tres brazos, sin re-ejecutar). Es un hallazgo exploratorio, no la señal de arquitectura de la fase.

**Lectura.** Harness tax A→B pequeño (+7 pp, bajo el margen de 20 pp): la orquestación R3 no explica el patrón. Capability tax B→C1 de +26 pp en pedir explícitamente la cantidad cuando falta, con menos tokens y menor latencia, pero sin efecto en el commit durable. El residuo (con cantidad dicha, ~45-55% de los turnos termina preguntando en vez de persistir) es común a los tres brazos: comportamiento del modelo. Cautela: n=3, cuatro casos concentran el efecto y el detector corregido es post-hoc. No se adopta ninguna arquitectura.

**Siguiente por evidencia (no iniciado):** confirmar el capability tax con más turnos y un juez independiente del regex; aislar qué parte del contrato (descripción, useWhen/doNotUseWhen, schema) lo produce; probar otro modelo para el residuo con cantidad conocida; corpus de tráfico real de EC2; decidir la regla de cantidad con negocio antes de cualquier C2.

## 23.10. P7.9 - Capability Contract Isolation

**P7.9 CLOSED - `CAPABILITY_TAX_NOT_REPLICATED` (senal preregistrada).** Detalle, matriz de contrato, preregistro, resultados, analisis exploratorio y limitaciones: `docs/audits/r3-p7-9-capability-contract-isolation.md`. Sin P8, sin MCP, sin cambios de Gateway/CommercialWork/DB/capabilities de produccion, sin tocar R3 ni la semantica de `quantity`.

**Diseno.** Siete contratos model-facing (B0 actual verbatim; B1 solo description thin; B2 sin useWhen; B3 sin doNotUseWhen; B4 toda la prosa thin; B5 schema sin `minimum`/`minItems`; B6 = C1 de P7.8-R) sobre el MISMO harness autonomo de P7.8-R (prompt, loop, Gateway, estado, modelo, fixtures); solo cambia la representacion de las 7 tools en alcance. Hallazgo previo: el schema actual no tiene field descriptions, asi que B5 solo puede quitar anotaciones. Detector de "pide cantidad" corregido de P7.8-R preregistrado como clasificador con golden de 77 entradas (54 mensajes reales de P7.8-R etiquetados a mano); corpus separado en 12 Q-, 12 Q+ y 8 negativos; regla de promocion (+20 pp en Q- pide cantidad o Q+ commit, sin degradar seguridad) y mapeo de senal fijados antes de medir; freeze por hash verificado por el script.

**Resultado (672 corridas, 3 por celda, 0 fallos de harness).** Sobre-mutacion 0/24, argumentos invalidos 0, corrupcion 0 y wrongQuantity/wrongProduct 0 en las 7 variantes. Q- pide cantidad: B0 44.4%, B1 25.0%, B2 52.8%, B3 52.8%, B4 41.7%, B5 41.7%, **B6 44.4%**; Q+ commit: 44.4, 36.1, 36.1, 44.4, 41.7, 41.7, **52.8**. **P7.8-R no se replica**: B6 = B0 en Q- (IC pareado aproximado +-11 pp: un efecto de +20 pp queda excluido) y +8.3 pp en Q+ (IC [-6, +22], inconcluso). Ningun componente aislado supera la regla; el contrato solo cambio el costo (-19% tokens de entrada con B6, -22% con B4).

**Lectura.** El residuo no es del contrato: el modelo trata un enunciado de deseo ("quiero dos ...", "necesito 3 ...", "me llevo una ...") como aun no confirmado y pregunta "¿confirmas?" (5 escenarios Q+ con 0 commits en las 7 variantes); con verbo de accion o cotizacion commitea (K06 21/21, K12 19/21). Con verbo de accion sin cantidad ("agregame la Classic") asume cantidad 1 (19-36% de los Q-). Sensibilidad del ruido: temperature 0 no es determinista (2-7 de 24 celdas mixtas por variante). Hipotesis exploratoria (no preregistrada, sin multiplicidad): B1 baja Q- (McNemar p = 0.039).

**Siguiente por evidencia (no iniciado):** no adelgazar contratos como remedio; aislar el acto de habla / confirmacion previa a persistir variando el prompt autonomo y/o el modelo con el contrato B0 fijo y un corpus estratificado por acto de habla; decidir con negocio si "¿confirmas?" antes de persistir es defecto y la regla de cantidad por defecto con verbo de accion; corregir la limitacion del stub ("Pro").

## 24. Do Not Accidentally Reintroduce

- No usar `CommercialProposal` como estado persistente ni dejar que el LLM decida directamente el objective durable.
- No crear otro planner ni volver al workflow R2.
- No usar P6 como autorización, llamar services desde P6 ni construir otro DRM.
- No duplicar identity policy, governance ni capability registry.
- No filtrar tools en P6.3 sin fase explícita.
- No guardar razonamiento/CoT, customer text o PII en telemetry.
- No bloquear `create_quote` por shipping ausente.
- No usar `blockerPotentiallyChangedThisTurn`/`inTurnEvidence` como `blockerResolvedThisTurn`, ni recalcular eligibility a partir de esa señal - sólo P8 (reproyección de DRM) puede afirmar que un prerequisite volvió a `CURRENT`.
- No agregar una señal genérica `mutationOccurredThisTurn`/"cualquier mutación cuenta" - toda relevancia P7.3 pasa por `CAPABILITY_ELIGIBILITY_REASON_CODE_TO_EVIDENCE` y el `evidenceProduced` real del registry.
- No reemplazar wiring válido por un rebuild conceptual completo.
- No hacer que el benchmark E2E (`r3CommercialE2E/`) llame `runAgentToolLoop` directamente ni construya su propio ciclo simplificado - debe entrar por `runSalesAgentRuntimeCycle`, el ciclo R3 real.
- No usar un LLM-as-judge en P7.4/P7.5 sin necesidad demostrada, y nunca el mismo modelo evaluado como su propio judge.
- No clasificar automáticamente un rejection de Gateway o una dependencia ausente como falla del modelo (`MODEL_REASONING`) - usar la taxonomía completa (`failureClassification.ts`).
- No correr `r3-commercial-e2e-benchmark.ts` ni `setupR3BenchmarkEnvironment` fuera de `NODE_ENV=test` + `crm_test`.
- No leer "EC2-equivalent" como paridad total: live assimilation no se ejercita en el harness y el canal (webhook, HTTPS, firma, settle, delivery/read, outbox real) es `EC2_ONLY_CHANNEL_BEHAVIOR`; no simularlo con `sleep`.
- No extrapolar a producción una medición del harness sin declarar la configuración efectiva (`manifest.modelConfig`, `flags`, `benchmarkOverrides`, `notReproducibleInHarness`); P7.5 midió un runtime distinto al de EC2.
- No seguir agregando reglas de prompt cada vez más específicas al patrón grounding -> commit sin nueva evidencia: P7.7 (23.7) ya probó el cambio mínimo/general con el texto confirmado presente en el prompt real y midió RED; iterar con más texto sin un hallazgo nuevo reproduciría exactamente el patrón de lógica determinista creciente que la fase pedía evitar.
- No usar `RunAgentToolLoopInput.promptBuilder` en producción ni tratar el resultado P7.8 (`NO_CLEAR_WINNER`) como aprobación de retirar P4/P5/P6 o adoptar el harness autónomo: es un seam de benchmark, y B no mostró ventaja sobre A en corpus sintético (ver 23.8).
- No leer P7.8 (`NO_CLEAR_WINNER`) como una comparación R3 vs harness autónomo: compartía el loop R3 y el contrato de tools. Y no citar `CAPABILITY_CONTRACT_IS_BOTTLENECK` de P7.8-R sin su calificación ("post-hoc corrected exploratory finding, candidate, requires confirmatory replication"; la señal preregistrada fue `NO_CLEAR_WINNER`) ni tratarla como autorización para adelgazar contratos de capabilities o cambiar la semántica de `quantity`: es evidencia de un efecto conversacional en un corpus sintético, con un detector corregido post-hoc (ver 23.9).
- No citar `CAPABILITY_CONTRACT_IS_BOTTLENECK` de P7.8-R como hallazgo vigente ni adelgazar contratos de capabilities para mejorar "pide cantidad"/commit: P7.9 (23.10) lo probo con 7 contratos y 672 corridas y **no se replica**; el residuo con cantidad conocida es comportamiento del modelo/prompt ante enunciados de deseo, independiente del contrato.
