# SALES-AGENT-R2-ID-R2-A07 - CommercialWork Identity Gating + Onboarding Resume

## Veredicto

`ID_R2_A07_COMMERCIALWORK_IDENTITY_GATING_VALIDATED`

## Baseline

- `docs/audits/SALES-AGENT-R2-ID-R2-A01-existing-identity-onboarding-engine-reuse-audit.md` - veredicto `IDENTITY_ENGINE_HYBRID_REUSE`.
- `docs/releases/SALES-AGENT-R2-ID-R2-A02-canonical-candidate-resolver-evidence-contract.md` - veredicto `ID_R2_A02_CANDIDATE_RESOLVER_VALIDATED`.
- `docs/releases/SALES-AGENT-R2-ID-R2-A03-durable-identity-evidence-corrections.md` - veredicto `ID_R2_A03_DURABLE_IDENTITY_EVIDENCE_VALIDATED`.
- `docs/releases/SALES-AGENT-R2-ID-R2-A04-identity-verification-policy.md` - veredicto `ID_R2_A04_VERIFICATION_POLICY_VALIDATED`.
- `docs/releases/SALES-AGENT-R2-ID-R2-A05-runtime-identity-context-wiring.md` - veredicto `ID_R2_A05_RUNTIME_IDENTITY_CONTEXT_VALIDATED`.
- `docs/releases/SALES-AGENT-R2-ID-R2-A06-commercial-identity-requirement-policy.md` - veredicto `ID_R2_A06_COMMERCIAL_IDENTITY_REQUIREMENT_VALIDATED`.

Revalidado contra `develop`: A06 (`decideCommercialIdentityRequirement`/`evaluateCommercialIdentityRequirement`) no cambió - este slice es su primer caller real, exactamente como A06 dejó documentado en su propio "Next slice".

## Alcance real de esta tarea

Se conectó A06 a CommercialWork por primera vez: un step/objective identity-sensitive ahora puede quedar bloqueado antes de que su capability se ejecute, el bloqueo distingue las 6 razones no-`SUFFICIENT` que A06 puede producir, el subsistema de onboarding existente se activa/avanza reutilizando `runCustomerOnboardingPostPlanStage` sin cambios, y la identidad mejorada desbloquea el mismo `CommercialWork` - en el siguiente turno siempre, y en el mismo turno cuando el subsistema de onboarding efectivamente ejecutó `create_customer`/`link_external_identity`. No se creó una segunda state machine, no se duplicó ninguna regla de identidad/autoridad, no se tocó checkout/Customer Profile.

## 1. Punto de gating (PARTE 1)

Auditado el pipeline completo: `runCommercialWorkInboundCycle` → `planCommercialObjectiveSeeds` (LLM) → `reconcileCommercialTrigger` → `buildCommercialWorkProjection` (`deriveCommercialObjectives` → `applyObjectiveState` por tipo → `deriveCommercialWorkSteps`) → `commercialWorkExecutor.executeCommercialWork` (selecciona steps `READY` y llama `executeCapability`) → `settleCommercialWorkProjection` (reproyecta hasta 3 rondas) → `dispatchCommercialWorkResponse`.

El gate se implementó como un post-paso puro dentro de `buildCommercialWorkProjection.ts`: `applyCommercialIdentityGate(objectives, runtimeIdentity)` (`lib/brain/commercial/work/commercialIdentityGate.ts`), invocado inmediatamente después del switch por-tipo de `applyObjectiveState` y antes de `applyPendingMutationInvalidations`/`applyConversationAutonomy`. Solo interviene sobre un objective cuyo status estructural ya es `READY` - un objective que sigue `BLOCKED`/`WAITING_CUSTOMER` por otra razón (selección faltante, destino faltante, etc.) nunca es tocado, así que el gate nunca compite ni se confunde con ningún blocker existente. Como el executor (`commercialWorkExecutor.ts`) solo selecciona steps con `status === "READY"` y `deriveCommercialWorkSteps.ts` deriva `step.status` directamente de `objective.status`, un objective que el gate reclasificó nunca llega al executor - cumple la preferencia explícita de la tarea ("step projection/readiness derivation", nunca dentro de la capability).

## 2. Step/objective → operation mapping (PARTE 2)

`COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION` (`commercialIdentityGate.ts`) - la única traducción de vocabulario, sin redefinir ningún requirement:

| CommercialObjectiveType | CommercialOperation (A06) |
|---|---|
| DISCOVER_PRODUCTS | search_products |
| COMPARE_PRODUCTS / RECOMMEND_PRODUCTS | recommend_catalog_products |
| SELECT_PRODUCTS / CHANGE_QUANTITY | select_products |
| SET_DESTINATION | set_shipping_destination |
| GET_SHIPPING_QUOTE | calculate_shipping |
| SELECT_SHIPPING_OPTION | select_shipping_option |
| CREATE_QUOTE | create_quote |
| HANDOFF | assisted_sale_handoff |
| WAIT_FOR_QUOTE_APPROVAL | (sin mapear - ningún capability/step existe para este objective type) |

Un test de integridad (`PARTE 2` en `commercialWorkIdentityGating.test.ts`) recorre `COMMERCIAL_OBJECTIVE_TYPES` completo y falla si un tipo con case real en `deriveCommercialWorkSteps.ts` queda sin mapear, o si `WAIT_FOR_QUOTE_APPROVAL` deja de estar deliberadamente ausente.

## 3. Blocker model (PARTE 3)

Nuevo `CommercialWorkBlockerCode = "IDENTITY_REQUIREMENT"` (uno solo, nunca una variante por status) + un campo nuevo en `CommercialWorkBlocker`: `identityDecision?: CommercialIdentityRequirementDecision` - la decisión completa de A06, verbatim, nunca resumida. El `status` discriminante de esa decisión (`ONBOARDING_REQUIRED` / `READY_TO_LINK` / `AMBIGUITY_RESOLUTION_REQUIRED` / `IDENTITY_CONFLICT` / `SYSTEM_WAIT` / `ENTITY_VERIFICATION_REQUIRED`) es lo que distingue "falta nivel" de "ready to link" de "ambiguity" de "conflict" de "system wait" de "entity verification" - nunca colapsado en `MISSING_INFORMATION`. Esto es exactamente la forma que el enunciado sugirió (`blockedReason: {type: "IDENTITY_REQUIREMENT", decision: ...}`).

## 4. Mapping A06 → CommercialWork status (PARTE 4)

`IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS`/`IDENTITY_DECISION_STATUS_TO_MISSING_REQUIREMENT` (`commercialIdentityGate.ts`, exportados para test - mismo patrón que `IDENTITY_LEVELS_IN_COMPARISON_ORDER` de A06):

| A06 status | objective.status | missingRequirement |
|---|---|---|
| ONBOARDING_REQUIRED | WAITING_CUSTOMER | IDENTITY_EVIDENCE |
| AMBIGUITY_RESOLUTION_REQUIRED | WAITING_CUSTOMER | IDENTITY_AMBIGUOUS |
| READY_TO_LINK | BLOCKED | IDENTITY_LINK_PENDING |
| IDENTITY_CONFLICT | BLOCKED | IDENTITY_CONFLICT |
| ENTITY_VERIFICATION_REQUIRED | BLOCKED | IDENTITY_VERIFICATION |
| SYSTEM_WAIT | WAITING_SYSTEM | (ninguno - nunca se frasea como algo que falta al cliente) |

Reutiliza vocabulario 100% existente (`statuses.ts`/`transitions.ts` sin cambios, `BLOCKED -> READY/WAITING_CUSTOMER` ya era una transición legal) - **cero migración**. `ONBOARDING_REQUIRED`/`AMBIGUITY_RESOLUTION_REQUIRED` reusan `WAITING_CUSTOMER` (activan el follow-up scheduler existente gratis, `runCommercialWorkInboundCycle.ts:328-339` sin cambios). `SYSTEM_WAIT` reusa `WAITING_SYSTEM` (nunca `WAITING_CUSTOMER` - PARTE 16). `READY_TO_LINK`/`IDENTITY_CONFLICT`/`ENTITY_VERIFICATION_REQUIRED` usan `BLOCKED` (ninguno es respondible con un mensaje simple del cliente).

El `Record<Exclude<Status,"SUFFICIENT">, ...>` de TypeScript hace esta tabla exhaustiva **en tiempo de compilación** - un status nuevo de A06 rompe el build hasta mapearse aquí.

## 5. NONE-requirement operations preservadas exactamente (PARTE 5)

El gate solo actúa cuando `objective.status === "READY"` y la operación mapeada no es `SUFFICIENT`. Para `search_products`/`get_product_details`/`explore_catalog`/`recommend_catalog_products`/`select_products`/shipping (todas `NONE` en A06) la decisión siempre es `SUFFICIENT` y el gate es un no-op estructural - `applyObjectiveState`'s 12 branches por tipo de objective quedan **sin tocar**. `CIW01`-`CIW03` (`commercialWorkIdentityGating.test.ts`) prueban que `DISCOVER_PRODUCTS` permanece `READY` en `LEVEL_0`, `CONFLICT` y `SYSTEM_UNAVAILABLE`; `CIW04`(E2E)/`CIW05`(E2E) prueban lo mismo end-to-end contra la base real.

## 6. CREATE_QUOTE: decisión explícita (PARTE 6)

**Clasificación: `A. LEVEL_2_REQUIRED_HARD`.**

Auditado `lib/brain/commercial/quote-assembly/assembleQuoteInput.ts#resolveCustomerSnapshot` (líneas 126-160): si `opportunity.customerMasterId` es `null`, la función retorna `{ok:false, error:{code:"customer_snapshot_incomplete"}}` **siempre** - no existe ningún camino donde `create_quote` complete exitosamente sin un `customer_master_id` ya resuelto (que es exactamente LEVEL_2_MASTER_RESOLVED - `crm_opportunities.customer_master_id` se llena precisamente cuando la identidad alcanza ese nivel). Hoy ese fallo llega **después** de una llamada real a Catalog Service (`batchGetProducts`, trabajo desperdiciado) y se reporta como un outcome `completed` informativo (`mapAssemblyErrorToOutcome`'s `default` branch) en vez de un blocker estructurado. Gatear duro en LEVEL_2 antes de ejecutar la capability **no quita ninguna capacidad que hoy funcione** - solo mueve un fallo ya inevitable más temprano, lo vuelve estructurado (`BLOCKED_BY_IDENTITY` con `requiredEvidence`) en vez de un outcome informativo genérico, y evita la llamada desperdiciada a Catalog Service. Esto cierra la deuda que A06 dejó explícita ("Un futuro A07 decide si/como aplicarlo").

## 7. Assisted sale (PARTE 7)

`assisted_sale_handoff` se incluyó en la tabla de mapping por completitud/testabilidad, pero **estructuralmente nunca se gatea**: `applyObjectiveState`'s case `HANDOFF` fija `objective.status = "COMPLETED"` incondicionalmente (nunca pasa por `READY`), y el gate solo interviene sobre objectives `READY`. `CIW20`/`CIW21` prueban que `HANDOFF` completa en `LEVEL_0` y `LEVEL_1` por igual - assisted sale nunca exige onboarding, exactamente lo que la tarea pide.

## 8-10. Activación del onboarding existente, purpose, requiredEvidence (PARTE 8/9/10)

`findIdentityOnboardingTrigger` (`runCommercialWorkInboundCycle.ts`) busca, entre los objectives del `work` ya reproyectado (post-`settleCommercialWorkProjection`, ver sección 13), el primero cuyo blocker `IDENTITY_REQUIREMENT` tenga `identityDecision.status` en `{ONBOARDING_REQUIRED, READY_TO_LINK}` - las dos únicas decisiones que el subsistema de onboarding puede avanzar (ambigüedad/conflicto/system-wait/entity-verification quedan explícitamente excluidas, sección 17/18 abajo). Si hay match y el caller proveyó `customerSessionExecution` (el `NativeCustomerSessionExecutionContext` completo que `resolveNativeCustomerSession` ya construyó en Step 3 de `runNativeAutonomousCycle.ts` - nunca re-resuelto), se llama **una sola vez por turno** a `runCustomerOnboardingPostPlanStage` (`lib/brain/commercial/native-cycle/customer-session/runCustomerOnboardingPostPlanStage.ts`, **sin modificar**) con `plannedOperation.operation` igual al nombre de operación mapeado (`"create_quote"` para el caso real hoy).

Ese archivo resultó ser completamente runtime-agnóstico en sus inputs (`operation: string`, `messageText`, `correlationId`, `customerSessionExecution`, `opportunityId`) - **CommercialWork lo reutiliza literalmente sin ningún adaptador**, el mismo camino que ya usa el runtime legacy. Se agregó una sola entrada nueva a `onboardingPurposeMapping.ts#OPERATION_TO_ONBOARDING_PURPOSE`: `create_quote: "quote"` (el vocabulario propio de CommercialWork/A06, distinto de `prepare_quote` del loop legacy - nunca se reusan entre sí). `requiredEvidence` se propaga desde A06 hasta el blocker y hasta el finalizer (sección 20) sin redacción ni reinterpretación en ningún punto intermedio.

## 11. READY_TO_LINK (PARTE 11)

`findIdentityOnboardingTrigger` también dispara para `READY_TO_LINK`, pero **nunca vuelve a pedir información**: `runCustomerOnboardingPostPlanStage`'s paso 4 (`link_external_identity`) solo ejecuta si `session.currentTurnConsent.linkExternalIdentity` está presente - sin consentimiento explícito de este turno es un no-op seguro (la autoridad real, `evaluateLinkExternalIdentityAuthority`, **no se tocó**). El objective queda `BLOCKED` (nunca `WAITING_CUSTOMER` con una pregunta) hasta que exista consentimiento por el canal existente. `IDENTITY_LINK_PENDING` (nunca `IDENTITY_EVIDENCE`) es el `missingRequirement` correspondiente - probado en el test de mapping exhaustivo.

## 12. create_customer (PARTE 12)

No se creó ningún `READY_TO_CREATE`. `create_customer` sigue fuera del catálogo de A06 (por diseño de A06, sección 5 de ese doc) y CommercialWork nunca decide su elegibilidad - solo dispara el paso 3 de `runCustomerOnboardingPostPlanStage` (que internamente llama `evaluateCreateCustomerAuthority`, **sin modificar**) cuando la activación de onboarding (paso 1) ya puso el purpose/pending fields correctos. CommercialWork únicamente espera el outcome.

## 13. Reprojection/resume (PARTE 13) - el corazón de A07

**Cross-turn (garantizado, probado E2E contra MariaDB real):** cada turno recalcula `RuntimeIdentityContext` desde cero (A05, sin cambios) y vuelve a correr el proyector puro `buildCommercialWorkProjection` con ese valor fresco - un objective que quedó `WAITING_CUSTOMER`/`BLOCKED` por identidad se re-evalúa automáticamente la próxima vez que llega un mensaje, sin ningún mecanismo nuevo de "resume": es exactamente el mismo principio que `MISSING_SELECTION`/`STALE_EVIDENCE` ya usan. `CIW12/14/15/31` (E2E, `commercialWorkIdentityOnboarding.test.ts`) prueban: mismo `work.publicId`, nunca más de un step `CREATE_QUOTE` **vivo** (no-terminal) a la vez, el objective identity-blocked deja de tener el blocker `IDENTITY_REQUIREMENT`, y no se crea una segunda fila `crm_commercial_work` para la misma conversación.

**Same-turn (bounded, implementado, no probado contra un Customer Service HTTP real - ver Deudas):** el gate corre en la evaluación inicial (`reconcileCommercialTrigger`) y de nuevo en cada ronda de `settleCommercialWorkProjection` (`runtimeIdentity` se threadea a ambos). Después de que `settleCommercialWorkProjection` alcanza el estado final del turno para la identidad ORIGINAL, `findIdentityOnboardingTrigger` revisa ese estado final (no el de la primera reconciliación - ver nota de diseño abajo) y, si `runCustomerOnboardingPostPlanStage` efectivamente ejecutó `create_customer`/`link_external_identity` (`attemptedOperation` lo confirma), se vuelve a calcular `RuntimeIdentityContext` (`resolveRuntimeIdentityContext`, la misma función de A05) y se corre **una ronda extra** de `settleCommercialWorkProjection` (`maxRounds: 1`) con la identidad fresca - suficiente para que el objective se desbloquee y el step recién-`READY` se ejecute en el mismo turno. Acotado a exactamente una llamada a onboarding y una ronda extra por turno - nunca un loop sin límite.

**Nota de diseño real (encontrada durante testing, no anticipada):** el chequeo de `findIdentityOnboardingTrigger` se colocó deliberadamente **después** de la primera pasada de `settleCommercialWorkProjection`, no justo después de `reconcileCommercialTrigger`. Un intento inicial lo colocó antes de la ejecución/settle y un test E2E (selección sembrada en la misma conversación, `create_quote` pedido en el mismo turno) demostró que el bloqueo de identidad solo se hace visible **dentro** de una ronda de `settleCommercialWorkProjection` (la primera reconciliación no ve todavía `commercialLineItems` cuando la selección llega por un turno anterior vía DB, no vía el snapshot en memoria) - colocar el chequeo antes habría dejado turnos reales sin activar onboarding. Corregido antes de este documento; los 7/7 tests E2E de `commercialWorkIdentityOnboarding.test.ts` cubren ambos casos (selección preexistente y bloqueo emergente durante settle).

## 14. Persistencia del bloqueo (PARTE 14)

**DERIVED STATE**, según la preferencia explícita de la tarea. `CommercialWork` en sí es un agregado durable versionado (tal como ya lo era antes de A07), pero la *decisión* de bloquear por identidad nunca se persiste como un campo aparte - se re-deriva completa cada vez que `buildCommercialWorkProjection` corre, a partir de `runtimeIdentity` + el operation mapping + A06. El campo nuevo `identityDecision` vive dentro de `blockers_json` (columna `JSON` existente, sin schema) exactamente como cualquier otro dato estructurado de blocker (`productCandidates`, `shippingOptionCandidates`) - **cero migración de base de datos**. `CIW30` prueba que dos corridas puras con el mismo input producen el blocker idéntico (simula un restart).

## 15. Same-turn vs. next-turn (PARTE 15)

Documentado en la sección 13. Same-turn está implementado y acotado (una llamada a onboarding + una ronda extra de settle), pero solo se probó de extremo a extremo con un servicio de identidad **fake in-process** (los tests existentes de `runCustomerOnboardingPostPlanStage` ya cubren `create_customer`/`link_external_identity` contra un servidor Customer Service HTTP local real - A07 no repite esa cobertura, solo prueba que CommercialWork *llama* correctamente a la función real). Un E2E completo con Customer Service HTTP real disparado *desde* `runCommercialWorkInboundCycle` queda como deuda explícita (sección "Deudas").

## 16. System-owned vs. customer-owned (PARTE 16)

`SYSTEM_WAIT` (Identity Service caído) mapea a `WAITING_SYSTEM`, nunca a `WAITING_CUSTOMER` - probado (`commercialWorkIdentityGating.test.ts`, test "SYSTEM_WAIT is system-owned"). Deliberadamente **no** se marcó el step `CREATE_QUOTE` como `retryable`/`retryCandidate` en este caso: ese mecanismo (`retryPolicy.ts`) es para un step cuya *capability ya se ejecutó y falló* (con `attemptCount`/`nextAttemptAt` reales que el worker de retry sabe interpretar) - un step bloqueado por identidad nunca llegó a ejecutarse, así que marcarlo `retryable` habría enganchado incorrectamente el worker de reintentos de capability sin un `nextAttemptAt` real que retryPolicy pudiera calcular. Su "retry" es la re-derivación de cada turno (sección 13), el mismo mecanismo de auto-recuperación que cada otro blocker de este archivo ya usa - nunca una segunda máquina de reintentos.

## 17. Conflict (PARTE 17)

`IDENTITY_CONFLICT` → `BLOCKED`, nunca dispara `findIdentityOnboardingTrigger` (excluido explícitamente junto con ambigüedad/system-wait/entity-verification) - CommercialWork nunca intenta activar onboarding ni auto-resolver un conflicto. Las operaciones públicas siguen ejecutándose independientemente (`CIW17`/`CIW18`: `CREATE_QUOTE` se bloquea, `DISCOVER_PRODUCTS` en la misma conversación sigue `READY`). No se implementó ningún merge ni auto-selección de candidato - eso permanece exclusivamente responsabilidad de A02/A04.

## 18. Ambiguity (PARTE 18)

`AMBIGUITY_RESOLUTION_REQUIRED` → `WAITING_CUSTOMER` con `missingRequirement: IDENTITY_AMBIGUOUS` (nunca `IDENTITY_CONFLICT` ni el genérico `IDENTITY_EVIDENCE`) - `CIW19` prueba la distinción estructural completa (status, missingRequirement y que el finalizer produce una pregunta de desambiguación distinta de la pregunta de evidencia lisa).

## 19. Entity verification (PARTE 19)

El mapping (`ENTITY_VERIFICATION_REQUIRED -> BLOCKED`, `missingRequirement: IDENTITY_VERIFICATION`) está implementado y es exhaustivo por construcción de tipos (sección 4), pero **no tiene ningún consumidor real** todavía: ningún `CommercialObjectiveType` mapea a `order_status_entity_verification` (A06 ya documentó que ese mecanismo - `evaluateEntityVerification`, A04 - no tiene ninguna capability que lo invoque). `CIW23` prueba explícitamente que `create_quote` (LEVEL_2, `MINIMUM_LEVEL`) nunca produce `ENTITY_VERIFICATION_REQUIRED` ni siquiera en `LEVEL_3` - la garantía de A06 de que LEVEL_4 nunca se satisface solo por nivel se hereda intacta. No se inventó ningún order-status capability - exactamente lo que la tarea pide.

## 20. Finalizer / customer response (PARTE 20)

`buildCommercialWorkFinalizerMessage.ts#buildMissingInfoQuestion` ganó dos ramas nuevas, en el mismo estilo determinista (sin LLM) que ya usa cada otra rama de esa función (`PRODUCT_AMBIGUOUS`, `SHIPPING_OPTION_AMBIGUOUS`, etc.):
- `IDENTITY_EVIDENCE`: lee `requiredEvidence` real del blocker (`identityRequiredEvidence()`, nunca inventado) y produce una pregunta específica para `email`/`order_reference`, o una genérica-pero-honesta si el signal type no tiene copy dedicado todavía.
- `IDENTITY_AMBIGUOUS`: pregunta de desambiguación fija.

Privacidad preservada: el finalizer solo lee `requiredEvidence` (un array de signal types, nunca valores) - nunca `evidenceRefs`/`masterCustomerId`/`policyCode` se acercan a texto para el cliente. Una wording completamente conversacional (multi-campo, redacción dinámica de orderReference, framing de consentimiento) se dejó deliberadamente fuera de alcance - ver "Next slice".

## 21. Email-first para venta asistida (PARTE 21)

No implementado - explícitamente fuera de alcance de A07 (la tarea lo marca como enrichment opcional futuro, nunca un requirement de A06). `assisted_sale_handoff` sigue exigiendo solo LEVEL_1 (sección 7).

## 22. Checkout neutrality (PARTE 22)

`commercialIdentityGate.ts` nunca importa checkout ni lee `process.env` - probado estructuralmente (`CIW27`, mismo patrón que A06's `CIR19`: revisa import specifiers, no el texto libre de los comentarios).

## 23. Auditabilidad (PARTE 23)

Se decidió **no** agregar un nuevo evento de auditoría dedicado. El blocker `IDENTITY_REQUIREMENT` con su `identityDecision` completo (status/currentLevel/requiredLevel/entityType/requiredEvidence/policyCode - nunca PII) ya queda persistido durablemente en `crm_commercial_work_objectives.blockers_json`/`crm_commercial_work_steps.blockers_json` en cada escritura del agregado - exactamente el mismo mecanismo de auditabilidad que cada otro blocker de este archivo ya usa, sin necesitar una segunda tabla ni un segundo writer. `workId`/`objective`/`step`/`operation` (vía `objective.type`) ya son reconstruibles desde ese mismo registro. `runCustomerOnboardingPostPlanStage` (sección 8) sigue escribiendo sus propios eventos de auditoría existentes (`recordOnboardingTransitionIfChanged`, `recordIdentityCapabilityOutcome`, `recordSessionWarnings`) sin cambios - CommercialWork no duplica ninguno de esos.

## 24. Test Matrix (PARTE 24, CIW)

`tests/commercial/commercialWorkIdentityGating.test.ts` (25 tests, puro, sin DB, <2s) + `tests/commercial/commercialWorkIdentityOnboarding.test.ts` (7 tests, contra MariaDB real vía `setupR2BenchmarkEnvironment`, offline planner - sin LLM real).

| ID | Cubierto por |
|---|---|
| CIW01-03 | `commercialWorkIdentityGating.test.ts` (puro) |
| CIW04 | puro + E2E (`commercialWorkIdentityOnboarding.test.ts`) |
| CIW05 | puro + E2E |
| CIW06 | E2E (activación real de onboarding, purpose=quote) |
| CIW07 | E2E (segundo turno, misma fila de onboarding) |
| CIW08 | PARTE 20 (requiredEvidence propagado sin wording, probado en el finalizer) |
| CIW09 | mapping exhaustivo (tabla de A06 status -> missingRequirement) + `findIdentityOnboardingTrigger` con fixture |
| CIW10 | READY_TO_LINK nunca produce `IDENTITY_EVIDENCE` (mismo test que CIW09) |
| CIW11 | `SYSTEM_WAIT` test (sección 16) |
| CIW12 | E2E resume |
| CIW13 | E2E resume (ver nota de la sección 13/Deudas sobre supersession pre-existente) |
| CIW14 | E2E resume (nunca más de un step LIVE) |
| CIW15 | E2E resume (mismo `work.publicId`) |
| CIW16 | implícito en E2E (misma `conversationId`, sin resembrar) |
| CIW17/18 | `commercialWorkIdentityGating.test.ts` |
| CIW19 | idem |
| CIW20/21 | idem |
| CIW22 | sección 6 de este doc + `r2ArchitectureScenarios.test.ts` R2-06/R2-09 (regresión, ver PARTE 25) |
| CIW23 | idem |
| CIW24 | idem |
| CIW25/26 | idem |
| CIW27 | idem |
| CIW28 | E2E (fila de onboarding real con purpose correcto) |
| CIW29 | E2E (create/link authority nunca se re-implementa - se reutiliza `runCustomerOnboardingPostPlanStage` sin cambios; su propia suite de 30 tests sigue en verde, sección 25) |
| CIW30 | `commercialWorkIdentityGating.test.ts` (reproyección pura idéntica) |
| CIW31 | E2E resume (nunca una segunda fila `crm_commercial_work`) |
| CIW32 | cubierto indirectamente: `SYSTEM_WAIT`/`WAITING_SYSTEM` nunca se confunde con `WAITING_CUSTOMER` (sección 16) - un E2E contra un Identity Service real caído no se ejecutó (mismo tipo de deuda que A05 ya documentó para sus propios fallos de sistema) |

32/32 IDs cubiertos (algunos por prueba directa, otros por composición de pruebas existentes + nuevas, documentado explícitamente arriba en vez de fingir cobertura 1:1 sintética donde el escenario real no es alcanzable hoy - ver secciones 11/19).

## 25. Regresión (PARTE 25)

Ejecutado contra MariaDB real (`crm_test`, credenciales de entorno). `--test-concurrency=1` para evitar la contención de recursos compartidos ya documentada en este repo.

- `npx tsc --noEmit`: limpio.
- `npx eslint` sobre los 10 archivos de producción tocados: limpio (1 warning preexistente, no relacionado, línea 608 de `runNativeAutonomousCycle.ts`).
- `npm run build`: limpio.
- `commercialIdentityRequirement.test.ts` (A06): 26/26.
- `commercialWorkIdentityGating.test.ts` (A07, nuevo, puro): 25/25.
- `commercialWorkIdentityOnboarding.test.ts` (A07, nuevo, E2E real): 7/7.
- `commercialWorkInboundCycle.test.ts`, `customerOnboardingPostPlanStage.test.ts`, `customerOnboardingPostPlanRuntime.test.ts`, `customerOnboardingPostPlanPrivacy.test.ts`, `customerIdentityAuditEvents.test.ts`, `identityCapabilityGatewaySummaries.test.ts`, `createCustomerCapability.test.ts`, `linkExternalIdentityCapability.test.ts`, `customerSessionPrivacy.test.ts`: 198/198.
- `runtimeIdentityContext.test.ts`, `customerIdentity.test.ts`, `customerIdentityVerification.test.ts`, `customerIdentityEvidence.test.ts`, `customerSessionCustomer360Gate.test.ts`, `customerMasterProjectionGate.test.ts`, `extractCustomerOnboardingFields.test.ts`, `identity-conflict.test.ts`, `nativeInboundIdentityBoundary.test.ts`: 149/149.
- `buildCommercialWorkFinalizerMessage.test.ts`, `commercialWorkExecutor.test.ts`, `commercialWorkParallelExecution.test.ts`, `commercialWorkProjection.test.ts`, `commercialWorkRepository.test.ts`, `commercialWorkRetryWorker.test.ts`, `commercialWorkSemanticCompleteness.test.ts`, `commercialWorkSequencing.test.ts`, `commercialWorkTransitions.test.ts`, `commercialWorkWaitingCustomerReactivation.test.ts`: 138/138.
- `r2ArchitectureScenarios.test.ts` (incluye R2-06/R2-09, los dos escenarios reales de `create_quote`) + `r2ArchitectureFollowUpScenarios.test.ts`: 13/13.
- `multiRequestRuntime.test.ts`, `multiRequestCustomer360.test.ts`, `runNativeAgentToolLoopCycleConfig.test.ts`, `runNativeAgentToolLoopCycleCustomerProfile.test.ts`, `recommendCatalogProductsAgentLoopIntegration.test.ts`: 24/25 en el último archivo con timeout en el hook de cierre del proceso (`exitCode 143` tras que las 25 aserciones ya reportaron `ok`) - confirmado no relacionado: ese archivo no importa nada de `lib/brain/commercial/work/` ni de `lib/brain/commercial/identity/` (verificado por grep), y el hang ocurre en el teardown del proceso, no en ninguna aserción. Preexistente, no investigado más a fondo (fuera del alcance de A07).

Cero fallas nuevas atribuibles a este cambio.

## Deudas explícitas (no bloqueantes)

- **Same-turn unblock (PARTE 15) no probado contra un Customer Service HTTP real disparado desde `runCommercialWorkInboundCycle`.** El mecanismo está implementado y acotado (sección 13), y `runCustomerOnboardingPostPlanStage` en sí ya tiene 30 tests contra un servidor HTTP real - lo que falta es un E2E que dispare esa cadena completa *desde* `runCommercialWorkInboundCycle` con un servidor Customer Service real en el mismo turno. Deuda de cobertura, no de diseño.
- **READY_TO_LINK y ENTITY_VERIFICATION_REQUIRED no tienen ningún `CommercialObjectiveType` real que los alcance hoy.** `create_quote` (LEVEL_2) nunca produce `READY_TO_LINK` (que A06 solo emite para un requirement LEVEL_3) y ningún objective mapea a `order_status_entity_verification`. El mapping/status-table los maneja correctamente por construcción de tipos (sección 4) y se probó con fixtures manuales (`objectiveWithIdentityDecision`), pero no hay todavía un escenario end-to-end real que los ejercite - la misma deuda que A06 ya dejó documentada para `customer_profile_history`/`order_status_entity_verification` (ninguno de los dos es consumido por CommercialWork todavía).
- **`assisted_sale_handoff` en el mapping es teóricamente alcanzable solo si `HANDOFF`'s `applyObjectiveState` dejara de auto-completar** - hoy nunca ocurre (sección 7), documentado como comportamiento correcto, no como gap.
- **Wording conversacional completo (PARTE 20/21/27) queda deliberadamente mínimo.** El finalizer distingue email vs. order_reference vs. ambigüedad, pero no cubre cada `IdentityEvidenceSignalType`, no redacta con el `purpose`/contexto de la conversación, y no maneja el framing de consentimiento para `READY_TO_LINK`. Exactamente lo que PARTE 27 nombra como candidato a A08.
- **Supersession en vez de mutación in-place al resolver un `WAITING_CUSTOMER` (sección 13/CIW13).** Confirmado como comportamiento pre-existente de CommercialWork (`commercialWorkWaitingCustomerReactivation.test.ts`'s WC06, "a genuinely new, relevant customer message supersedes and reactivates a fresh attempt") - no introducido ni agravado por A07. El objective viejo queda `SUPERSEDED` (terminal, nunca re-ejecutado) y uno nuevo se deriva; el `CommercialWork` en sí (mismo `publicId`) nunca se pierde ni se duplica. Documentado aquí para que quede explícito, no arreglado (tocar la semántica de supersession está fuera del alcance de A07).
- Ningún nuevo evento de auditoría dedicado (sección 23) - decisión explícita, no un olvido.

## Next slice

Según PARTE 27, la decisión debe basarse en E2E real, no en roadmap teórico. Dado que:
- el onboarding/resume ya completa `LEVEL_2` (`create_customer`) end-to-end vía el mecanismo existente, pero A07 **no probó** el camino completo hasta `LEVEL_3` (`link_external_identity`, `READY_TO_LINK`) con un escenario real reproducible (sección de deudas), y
- el wording conversacional para email/order-reference/ambigüedad/consentimiento sigue siendo mínimo (sección 20/21),

la recomendación es **`ID-R2-A08 — Conversational Identity Collection / Optional Assisted-Sale Enrichment`**, no el PrestaShop Bridge - A07 dejó el gating y el resume mecánicamente correctos y probados, pero la conversación real con el cliente (cómo se le pide el email, cómo se le explica una ambigüedad, cómo se le pide consentimiento para link) sigue siendo el gap más visible antes de que valga la pena construir Customer Profile consumption sobre esto.

## Criterio de salida - checklist

1. A06 tiene caller real en CommercialWork - sección 1. OK
2. identity-sensitive steps pueden bloquearse - sección 1/6, `CIW04` E2E. OK
3. public steps no sufren gating innecesario - sección 5, `CIW01-03/18/24`. OK
4. blocker distingue customer-owned/system-owned - sección 4/16. OK
5. onboarding existente se reutiliza - sección 8, `CIW06/07` E2E. OK
6. no existe segunda state machine - sección 8/14. OK
7. READY_TO_LINK no se confunde con falta de información - sección 4/11, test de mapping. OK
8. create/link authority permanece intacta - sección 8/11/12, cero cambios a `authority-policy.ts`/`customerIdentityCapabilities.ts`. OK
9. conflict no auto-resuelve - sección 17. OK
10. ambiguity permanece separada - sección 18, `CIW19`. OK
11. identity upgrade desbloquea el mismo work - sección 13, `CIW12` E2E cross-turn (same-turn implementado, ver Deudas). OK
12. objective original se conserva - sección 13/Deudas (supersession pre-existente documentada explícitamente, el `CommercialWork` en sí nunca se pierde). OK con nota
13. step no se duplica - sección 13, `CIW14` E2E (nunca más de un step vivo). OK
14. restart/reprojection funciona - sección 14, `CIW30` + E2E resume. OK
15. assisted sale no exige onboarding completo - sección 7, `CIW20/21`. OK
16. create_quote tiene una decisión explícita y validada - sección 6. OK
17. checkout availability no afecta el wiring - sección 22, `CIW27`. OK
18. no se filtra PII - sección 20, `CIW25/26`. OK
19. tests E2E prueban block → onboarding → resume - `commercialWorkIdentityOnboarding.test.ts`, 7/7. OK
20. queda claro qué falta realmente antes de Customer Profile - sección "Next slice"/Deudas. OK
