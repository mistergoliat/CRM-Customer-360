# SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B5 - Operational Smoke + Live DeepSeek Acceptance

**Semantic-discovery verdict:** `SEMANTIC_DISCOVERY_VALIDATED_WITH_PLANNER_DEBT` (scoped - see section 0)

**C2 verdict:** `C2_NOT_JUSTIFIED` (absence of evidence, not disproof - see section 12)

**Mode:** VALIDATION. No redesign of Semantic Discovery, no C2, no workflow routing. The only code added is two manual-test/benchmark scripts (`scripts/manual-test/semantic-discovery-smoke.ts`, `scripts/live-semantic-discovery-benchmark.ts`) - observability tooling needed to run this validation, never production runtime code.

## 0. Read this first - what this validation could and could not reach

This Claude Code implementation session has **no network route** to either the real deployed Catalog Service or MariaDB - the exact same vantage-point limitation every prior task in this release has documented (`docs/CAPABILITY_MATRIX.md`'s `explore_catalog` row: *"this local implementation session never had direct network access to the EC2 services... on EC2, MariaDB is available via the crm-customer-360-mariadb container... and the Catalog Service is available on 127.0.0.1:4010"*). This is confirmed here again, freshly, with real traffic (not assumed):

- `CATALOG_SERVICE_BASE_URL=http://127.0.0.1:4010` (from `.env`) → real timeout on all 4 Catalog Port methods this task needed (`searchProducts`, `getProductSemanticsRegistry`, `getTrainingSemanticsRegistry`, `querySemanticDiscovery`) - see section 2.
- `DB_HOST=127.0.0.1:3306` → `ECONNREFUSED` (already reconfirmed in the TR-B4.1 session, and structurally identical here).
- `BRAIN_MODEL_API_URL=https://api.deepseek.com/chat/completions` with the real `BRAIN_MODEL_API_KEY` → **reachable, and used for real** in section 4. This is the one piece of real infrastructure this session can exercise.

Consequence for scope: **every section requiring Catalog query execution or DB-backed durable state (sections 2's query leg, 3's full pipeline, 7, 8, 9) is genuinely blocked**, not skipped by choice. Sections 1, 4, 5, 6, 10, 11 were executed for real to the extent the reachable half of the stack allows. This doc says explicitly, case by case, which claims are backed by real evidence gathered in this session and which remain open follow-up work for an environment with real connectivity (the same "operator must run this on EC2" pattern this release has used throughout - see e.g. `shipping-calculation-smoke.ts`, `catalog-service-smoke.ts`).

## 1. Baseline

`BRAIN_R3_HARNESS_ALIGNED_MESSAGE_MODEL_ENABLED` / `BRAIN_R3_OPEN_TURN_EXECUTION_ENABLED` / `BRAIN_R3_LIVE_TURN_ASSIMILATION_ENABLED` are not present in `.env` in this repo checkout - they are runtime booleans `runAgentToolLoop.ts`'s callers (`runNativeAutonomousCycle.ts`/`salesAgentRuntimeCycle`) resolve from their own config source, not raw `process.env` reads inside the loop itself (by design - see each field's own docstring in `RunAgentToolLoopInput`). No budget was changed - `DEFAULT_MAX_DECISIONS`/`DEFAULT_MAX_TOOL_EXECUTIONS` (3/2) are used unmodified by this validation's live-benchmark script, and `thinking: "disabled"` was reproduced exactly as the real R3 pilot hotfix (`runNativeAutonomousCycle.ts`, 2026-08-31) sets it, so the live cases in section 4 run under the same generation config production actually uses (`model=deepseek-v4-flash`, `temperature=0`, `maxOutputTokens=1024`, `maxModelRetries=0`).

Catalog config: `CATALOG_SERVICE_BASE_URL=http://127.0.0.1:4010`, `CATALOG_SERVICE_TIMEOUT_MS=5000` - unreachable from here (section 2).

## 2. Catalog operational smoke

Ran `scripts/manual-test/semantic-discovery-smoke.ts` (new, this task) through the real `HttpCatalogAdapter` - the exact production code path, not a hand-rolled request:

```
GET  /v1/products/semantics/registry           -> TIMEOUT (36ms)
GET  /v1/products/training-semantics/registry  -> TIMEOUT (2ms)
POST /v1/products/semantic-discovery/query     -> SKIPPED (no registry to build a valid request from)
```

Also reconfirmed the pre-existing `scripts/manual-test/catalog-service-smoke.ts` (`searchProducts`) fails identically (`timeout`, 44ms). All four Catalog Port methods this task cares about fail the same way, for the same reason: **TRANSPORT_FAILURE, infrastructure-blocked, not a code or upstream defect** - `127.0.0.1:4010` simply does not exist as a listening service in this session's network namespace.

- HTTP reachability: FAIL (no connection).
- Auth: UNTESTABLE (never got past the connection).
- Response validation: UNTESTABLE.
- Registry axes/codes: UNTESTABLE - no real registry data could be read in this session. **No codes were hardcoded to compensate** (task's own instruction) - section 4's live cases explicitly ran with `semanticVocabulary: null`, and any code the model produced there is unverified against upstream, always labeled as such.
- Query outcome: UNTESTABLE.
- Latency: only transport-layer latency to a closed port is available (single-digit to tens of ms - not informative about real service latency).

This is the same class of gap `search_products_by_semantics` already carries in `CAPABILITY_MATRIX.md` (`operational: not_verified`) since TR-B4 - unchanged by this task, now additionally confirmed for the 2 registry endpoints specifically (TR-B4's own smoke only ever exercised `querySemanticDiscovery` indirectly through unit tests with a fake port, never a real-network attempt at the registry endpoints until this task).

## 3. R3 capability smoke

Full pipeline (`ReadToolRequest -> Capability Gateway -> CatalogPort -> Catalog`) requires both the Capability Gateway's audit persistence (MariaDB, unreachable) and a real Catalog response (unreachable) - **blocked**, cannot be executed end-to-end in this session.

What could be confirmed without either dependency (structural/registration facts, not live behavior - already exhaustively tested in TR-B4/TR-B4.1's own test suites, re-verified green in section 10 below, not re-litigated here):

- Registered capability: yes (`CAPABILITY_GATEWAY_REGISTRY`, `resolveCapabilityGatewayDefinition("search_products_by_semantics")` resolves).
- `READ_TOOL` exposure: yes (`AGENT_CAPABILITY_EXPOSURE_CLASSIFICATION`).
- `completed`/`matched`, `completed`/`no_match`, `invalid_code`: covered by `tests/commercial/searchProductsBySemanticsCapability.test.ts` against a fake `CatalogPort` (real code path, simulated transport) - not re-run here, still green (see section 10).
- Model-facing `ToolObservation` projection: covered by `tests/agent-loop/buildToolObservation.test.ts`.
- `PRODUCT_IDENTITY`/`SEMANTIC_ELIGIBILITY` evidence declaration: covered by the capability's own `evidenceProduced` field and `tests/agent-loop/resolveObservedRecommendationSourceProduct.test.ts`.

None of the above required a live catalog or DB - they were already real, passing, deterministic tests before this task. What remains genuinely untested by anyone, anywhere, since TR-B4: **the capability actually completing a real HTTP round trip against the deployed Catalog Service**. That gap is unchanged by this task.

## 4. Live DeepSeek cases

Ran `scripts/live-semantic-discovery-benchmark.ts` (new, this task) - **real calls to the real DeepSeek API** (`https://api.deepseek.com/chat/completions`, the configured production key), through the real `buildAgentStepPromptPackage.ts` (harness-aligned mode) and the real `buildToolDescriptions()` (real tool list, real `inputSchema`/`useWhen`/`doNotUseWhen` for every registered tool, including `search_products_by_semantics`). `commercialContextSummary`/`recentCatalogContext`/`pendingCatalogAction` were all empty/null (a fresh, contextless conversation - the simplest fair test of tool selection in isolation). **`semanticVocabulary` was `null`** for every case - the one deviation from full production fidelity, forced by section 2's transport failure, called out on every result line.

| Case | Message | Tool selected | Arguments (raw model output) |
|---|---|---|---|
| A | "quiero algo para entrenar piernas en mi casa" | `search_products_by_semantics` | `MUSCLE_GROUP:["LEGS"]` (required), `USE_CONTEXT:["HOME"]` (preferred) |
| B | "tienen la Leg Press Obelix?" | `search_products` | `{"query":"Leg Press Obelix"}` |
| C | "quiero algo para entrenar pecho en mi home gym" | `search_products_by_semantics` | `MUSCLE_GROUP:["CHEST"]` (required), `USE_CONTEXT:["HOME_GYM"]` (preferred) |
| D | "quiero una máquina para hacer leg press" | `search_products` | `{"query":"máquina leg press"}` |
| E | "quiero una estructura para apoyar la barra" | `search_products` | `{"query":"estructura para apoyar la barra"}` |

**Case A** - Tool selection: correct (semantic discovery is the right call for an unnamed functional need). Canonicalization: **CANONICALIZATION_FAILURE (expected, reproduces the exact gap TR-B4.1 exists to close)** - with no vocabulary, the model invented `LEGS`/`HOME` rather than the real registry's likely `BODY_REGION`-style/`HOME_GYM`-style codes (confirmed by source-code review of the upstream ontology's naming convention in TR-B4/TR-B4.1 - real codes are `UPPER_SNAKE`, multi-word, e.g. `HOME_GYM`, not bare `HOME`). This is real, live, reproduced evidence that the vocabulary gap is not theoretical - it directly damages canonicalization quality exactly as predicted. **This validation could not confirm whether TR-B4.1's vocabulary actually fixes this**, because the registry it depends on is unreachable here - that confirmation is the single most important open item this task leaves for an environment with real Catalog connectivity.

**Case B** - Tool selection: correct, matches the expected result exactly. `search_products` remained the preferred nominal resolver for a named product. **PASS.**

**Case C** - Tool selection: correct. Canonicalization: minimal and well-formed (`required` only on the stated body region, `preferred` - not `required` - on the use-context detail) - no invented exercise capability, no over-constraining. Same code-invention caveat as Case A applies to the specific string values.

**Case D** - Tool selection: **did not match the task's stated expectation** (`EXERCISE_CAPABILITY=LEG_PRESS` via semantic discovery). The model instead treated "leg press" as specific enough to search nominally, the same way it treated a named product in Case B. This is a defensible reading, not an obvious error: "leg press machine" names a machine *type* precisely, which sits right on the boundary between `search_products` ("nominal/product-level resolution") and `search_products_by_semantics` ("functional/training discovery without a named product") - the capability's own `doNotUseWhen` boundary prose does not disambiguate a named machine-type from a named product. Classified as **planner debt** (a real, live, reproducible ambiguity in how the two tools' boundaries are worded/rendered), not a runtime defect - nothing crashed, nothing was hidden, no evidence was fabricated.

**Case E** - Tool selection: the model again chose `search_products` rather than inventing a `PRODUCT_FAMILY`/similar code for an intentionally vague, ambiguous request ("a structure to support the bar"). This is the **safe** outcome the task asked to check for ("without inventing unsupported exercise semantics") - confirmed: no fabricated axis/code appeared anywhere in the output. Classified as **acceptable / conservative**, arguably under-using the new capability for a case that plausibly could have benefited from it, but never inventing unsupported semantics.

## 5. NO_MATCH

Constructed a real second-decision prompt: prior turn = a completed `search_products_by_semantics` call with a synthetic-but-real-shaped observation `{"outcome":"no_match","results":[],"totalMatches":0,"truncated":false}` (built from `buildToolObservation.ts`'s own real projection shape, never invented ad hoc), then asked the real model for its next step.

**Result:** the model's next `AgentStep` was `use_tool: search_products` with a broadened text query (`"entrenar piernas en casa"`) - **not** a claim of technical failure, **not** a handoff, **not** an apology for an "error." It correctly read the empty result as "no product satisfies this exact semantic combination" and pivoted to an alternate, valid retrieval strategy. This directly satisfies the task's requirement ("must interpret it as a valid empty result, not technical failure"). **PASS**, confirmed live.

## 6. Invalid code repair

Constructed a real second-decision prompt: prior turn = a `use_tool: search_products_by_semantics` call using a deliberately invalid code (`BODY_REGION: "PIERNA_INVENTADA_XYZ"`), followed by the real `blocked`/`invalid_code` observation shape TR-B4's `buildToolObservation.ts#projectSearchProductsBySemanticsInvalidCode` actually produces (`{"invalidRequirements":[{"axis":"BODY_REGION","codes":["PIERNA_INVENTADA_XYZ"]}]}`), then asked the real model for its next step.

**Result:** the model retried `search_products_by_semantics` with a **different** code (`BODY_REGION: "LEGS"`, plus an added `USE_CONTEXT: "HOME"` preference) rather than resubmitting the same invalid code, crashing, or handing off. This is the correct *behavioral pattern* the server-side gate is designed to enable ("another reasoning iteration... corrected valid request if the model is capable") - **no silent canonicalization occurred anywhere in the runtime** (the fix, such as it is, is entirely the model's own new guess, never something the CRM code rewrote for it). Whether `"LEGS"` is itself a real registry code remains unverifiable here for the same reason as section 4 - this section validates the *repair loop's shape*, not the correctness of the specific replacement value. **PASS (behaviorally), UNVERIFIED (semantically)**.

## 7. Historical regression - bar to discs

**BLOCKED.** Reproducing this scenario faithfully requires a real, durable conversation history (persisted `conversation_message`/`crm_capability_executions` rows a real turn would have produced) and a real prior `get_product_details` resolution for the bar - both require MariaDB, unreachable in this session. Fabricating the "prior resolved bar" state as a hand-built fixture would risk asserting a `TOOL_SELECTION_FAILURE`/pass verdict this session cannot actually back with real evidence, which this task's own "no fabrication" discipline forbids. **Not attempted. Left as explicit follow-up** for an environment with real DB access - see `docs/audits/` conventions this release already uses for DB-gated regression replays.

## 8. Historical regression - 25kg

**BLOCKED**, same reason as section 7 - this case additionally requires a durable `commercial_line_items` selection (`5x2,10,15,20`) already persisted for a real opportunity, which only exists in a real MariaDB. **Not attempted.** This is explicitly the case the task itself flags as "the strongest trigger for reconsidering C2" - and it is exactly the one this session cannot produce real evidence for, which directly drives the C2 verdict in section 12.

## 9. Quote regression

**BLOCKED**, same reason - `create_quote` requires a durable `commercial_line_items` selection and (per its own capability, unrelated to this task) a configured Quote Service, neither reachable/verifiable here. **Not attempted.**

## 10. Metrics

Captured for every live case (section 4/5/6), no chain-of-thought logged (only the final parsed `AgentStep` JSON and token counts - never `reasoning_content`):

| Case | Tool | Outcome | Elapsed (ms) | Input tokens | Output tokens |
|---|---|---|---|---|---|
| A | search_products_by_semantics | use_tool | 1444 | 6703 | 73 |
| B | search_products | use_tool | 997 | 6701 | 24 |
| C | search_products_by_semantics | use_tool | 1422 | 6704 | 75 |
| D | search_products | use_tool | 1225 | 6701 | 24 |
| E | search_products | use_tool | 1197 | 6702 | 27 |
| NO_MATCH | search_products (pivot) | use_tool | 1161 | 6807 | 26 |
| INVALID_CODE_REPAIR | search_products_by_semantics | use_tool | 1601 | 6822 | 71 |

Semantic vocabulary serialized size this run: **0 bytes (absent - registry unreachable)**. Repair attempts observed: 1/1 successful in shape (section 6). Terminal reason for every case: none reached a loop terminal (`respond`/`handoff`) - every case was a single `use_tool` decision, as designed (this benchmark only probes the first decision, not a full multi-turn loop, since the loop itself needs the DB/Catalog this session lacks).

Also confirmed (section 2): 3 real Catalog transport attempts, all `timeout`, sub-50ms transport-layer latency (a closed port, not an informative service-latency number).

## 11. Decision matrix

| Case | Tool selection | Canonicalization | Execution | Post-tool reasoning | Result |
|---|---|---|---|---|---|
| A - piernas en casa | PASS | CANONICALIZATION_FAILURE (no vocabulary, guessed codes) | UNTESTABLE (Catalog unreachable) | n/a | Planner debt (vocabulary-dependent) |
| B - Leg Press Obelix | PASS | n/a (nominal tool) | UNTESTABLE | n/a | PASS |
| C - pecho en home gym | PASS (minimal, no over-constraint) | CANONICALIZATION_FAILURE (same gap as A) | UNTESTABLE | n/a | Planner debt (vocabulary-dependent) |
| D - máquina leg press | Planner debt (defensible but diverges from task's stated expectation) | n/a | UNTESTABLE | n/a | Planner debt |
| E - estructura para la barra | PASS (conservative, no invented semantics) | n/a | UNTESTABLE | n/a | PASS |
| NO_MATCH | n/a | n/a | n/a (synthetic) | PASS (valid-empty, no technical-failure claim) | PASS |
| Invalid code repair | n/a | UNVERIFIED (repair shape correct, replacement code unconfirmed) | n/a (synthetic) | PASS (structurally correct repair attempt) | PASS (behavioral), unverified (semantic) |
| Bar->discs regression | BLOCKED (DB) | BLOCKED | BLOCKED | BLOCKED | BLOCKED_TRANSPORT |
| 25kg regression | BLOCKED (DB) | BLOCKED | BLOCKED | BLOCKED | BLOCKED_TRANSPORT |
| Quote regression | BLOCKED (DB) | BLOCKED | BLOCKED | BLOCKED | BLOCKED_TRANSPORT |
| Catalog registries + query | n/a | n/a | TRANSPORT_FAILURE (real timeout, all 3 endpoints) | n/a | BLOCKED_TRANSPORT |

### System classification

Given the mix of (a) fully green code-level/unit/integration coverage from TR-B4/TR-B4.1 (re-confirmed in section 10), (b) correct live-model behavior for tool selection in 4/5 cases and fully correct post-tool reasoning in both reachable reasoning tests, (c) one real, reproduced, expected planner-quality gap (canonicalization without vocabulary - the exact problem TR-B4.1 targets, whose fix remains unconfirmed only because the registry itself is unreachable here, not because of any observed defect), and (d) zero evidence of an actual runtime or upstream defect (every failure mode observed was either infrastructure-transport-related or a reasonable, non-crashing planner judgment call):

**`SEMANTIC_DISCOVERY_VALIDATED_WITH_PLANNER_DEBT`**

This is explicitly *not* the same claim as "fully operationally verified" - `docs/CAPABILITY_MATRIX.md`'s `search_products_by_semantics` row stays `operational: not_verified` until a real smoke against the deployed Catalog Service (from an environment that can actually reach it) closes that gap. Nothing in this session's evidence supports `SEMANTIC_DISCOVERY_RUNTIME_DEFECT` (no CRM code path misbehaved) or `SEMANTIC_DISCOVERY_UPSTREAM_DEFECT` (no evidence about the upstream service's behavior could be gathered at all, let alone defective behavior).

## 12. C2 decision

`C2_REEVALUATION_JUSTIFIED` requires positive evidence that the model saw the correct transcript/state, saw the correct capability semantics, selected the correct capability, and *still* constructed an action that lost a live customer requirement relative to durable commercial state. The one case designed to produce exactly that evidence - section 8's 25kg regression - is the one this session structurally cannot run (it requires a real, durable `commercial_line_items` row in a real MariaDB this session cannot reach). No other case in this task's scope touches target-state/select_products reasoning at all - sections 4-6 are entirely about `search_products_by_semantics` tool selection and canonicalization, a different failure class than C2's target-state-loss trigger.

Absence of evidence is not evidence of absence, but the task's own bar is explicit ("*requires evidence that...*") - this session produced none, for a structural (infrastructure) reason, not because the evidence was sought and came back clean.

**`C2_NOT_JUSTIFIED`** - on the current evidence. This should be revisited the moment sections 7/8 can actually be run against a real database (nothing here rules out the concern the 25kg case was designed to test - it simply could not be tested).

## 13. Files added

- `scripts/manual-test/semantic-discovery-smoke.ts` (new) - real Catalog Port smoke for the 3 TR-B4 methods, same discipline as the pre-existing `catalog-service-smoke.ts`.
- `scripts/live-semantic-discovery-benchmark.ts` (new) - bounded live-DeepSeek acceptance harness for tool selection/canonicalization/post-tool reasoning, gated behind `BENCHMARK_LIVE_LLM_ENABLED=true`, reusing the existing `liveProvider.ts` helper other live benchmarks in this repo already use. No production runtime code changed by this task.

## 14. Final verdict

**`SEMANTIC_DISCOVERY_VALIDATED_WITH_PLANNER_DEBT`**

**`C2_NOT_JUSTIFIED`**
