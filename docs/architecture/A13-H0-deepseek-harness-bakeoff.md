# SALES-AGENT-R2-A13-H0 -- DeepSeek Harness Architecture Bake-off

Status: spike, not a migration. No production code, WhatsApp routing, or
CommercialWork entry point was modified for this task. Everything executable
lives under `experiments/deepseek-harness/` and is isolated from the
production runtime.

## Phase 1 -- Audit and architecture map

### 1.1 Current R2 pipeline (inbound -> outbox)

One line per stage, in call order, for the CommercialWork (R2) path
(`shouldRouteToCommercialWork(waId)` true):

| # | Stage | File | What it does |
|---|---|---|---|
| 0 | Access/killswitch/opt-out gates | `native-cycle/runNativeAutonomousCycle.ts` | WhatsApp access gate -> autonomy killswitch -> pilot allowlist -> opt-out. Fail closed. |
| 1 | Runtime selection | `config/commercialCycleConfig.ts` | `shouldRouteToCommercialWork` (allowlist + flag) picked before legacy/Agent Tool Loop; mutually exclusive. |
| 2 | Identity/session resolution | `customer-session/resolveNativeCustomerSession.ts` | Local identity resolution, onboarding load, at most one `resolve_customer` call, produces `RuntimeIdentityContext` (server-only) + `CustomerSessionDecisionContext` (LLM-safe, no PII). |
| 3 | Context snapshot | `buildNativeCommercialContext` | `CommercialContextSnapshot`: conversation, opportunity, need profile, durable facts. |
| 4 | Sales-agent config resolve | `resolveSalesAgentConfiguration()` | Model/loop config; failure -> neutral fallback, never a default personality. |
| 5 | Entry | `work/runCommercialWorkInboundCycle.ts` | Orchestrates 6-11. |
| 6 | Semantic planning (the one LLM call) | `work/semanticIntentAdapter.ts` | Prompt -> one `AgentLoopProvider.invoke` -> `CommercialIntentPlan` -> deterministic requirement resolver (non-LLM) -> `CommercialObjectiveSeed[]`. |
| 7 | Reconciliation | `reconciliation.ts` | Opens/merges the target `CommercialWork` row for this conversation. |
| 8 | Projection (pure) | `buildCommercialWorkProjection.ts` | Objective seeds + durable facts + identity gate -> objectives/steps/blockers. No I/O. |
| 9 | Execution | `work/commercialWorkExecutor.ts` | Picks READY step(s) -> dispatches to Capability Gateway -> reprojects -> persists (optimistic concurrency). |
| 10 | Settle | `work/settleCommercialWorkProjection.ts` | Re-runs the pure projector up to 3 rounds to catch same-turn cascades. |
| 11 | Finalize/dispatch | `work/dispatchCommercialWorkResponse.ts` | Builds customer-visible message from the persisted aggregate only -> outbox insert. |

**Central invariant**: the LLM only ever decides *intent* (step 6). Steps
8-9 deterministically decide which capability runs, with what input, purely
from objective/step type + durable facts. The LLM never picks a tool per
turn the way an agent-loop architecture does -- that is the crux of what
this bake-off is testing.

### 1.2 Capability Gateway -- tools/capabilities and governance

Every capability declares `governance: { sideEffect, authority, riskClass }`,
read by policy/executor, never by the LLM's self-report.

| Capability | sideEffect | Real implementation |
|---|---|---|
| `search_products` / `get_product_details` / `explore_catalog` | read_only | `lib/catalog` (`createCatalogPort` -> `httpCatalogAdapter.ts`) |
| `recommend_catalog_products` | read_only | `lib/catalog/search-products-v2` (separate HTTP client) |
| `get_customer_purchase_history` / `get_customer_recommendation_signal` | read_only | `commercial-customer-context/loadCommercialCustomerContext.ts` -> Customer Profile HTTP, gated at identity LEVEL_3 |
| `calculate_shipping` | read_only (external call) | `lib/domains/carrier-service` + `lib/domains/shipping-calculation` |
| `set_shipping_destination` / `select_shipping_option` / `select_products` | mutating (low risk) | `lib/domains/shipping-destination`, `selected-shipping-option`, `commercial-line-items` |
| `create_customer` / `link_external_identity` / `link_prestashop_identity` | mutating (medium risk) | `lib/domains/customer-onboarding`, `lib/integrations/customer-external-identity` |
| `create_quote` | mutating (medium risk) | `lib/integrations/quote-service` (external, no live instance in dev/test) |
| `resolve_customer` | read_only | `lib/integrations/customer-service` (never an LLM-facing tool; called only by session resolution) |

### 1.3 Reusable read-only domain boundaries (bake-off tool candidates)

| Boundary | File | Purpose |
|---|---|---|
| Catalog search | `lib/catalog/index.ts` (`createCatalogPort`) | `CatalogPort.resolveProductIntent` / `exploreCatalog` / `getProductDetails` over the real Catalog microservice. Returns `null` when unconfigured -- never a fallback. |
| Customer Profile / purchase history | `lib/brain/commercial/commercial-customer-context/loadCommercialCustomerContext.ts` | The one safe boundary R2 uses for Customer Profile reads. Requires a `RuntimeIdentityContext` at `LEVEL_3_PRESTASHOP_LINKED`; every other identity state maps to `IDENTITY_INSUFFICIENT` without calling out. |
| Shipping lookup | `lib/domains/carrier-service` (`createCarrierService`) + `lib/domains/shipping-calculation` | Real carrier rates, hydrated via `CatalogPort` for weight. |
| Identity/session context | `lib/brain/commercial/native-cycle/customer-session/` | `RuntimeIdentityContext` (server-only, PII-bearing) vs. `CustomerSessionDecisionContext` (LLM-safe, no PII) -- two representations, never mixed. |

**Dev-environment reality check** (from `.env`, values not read, only presence
checked): `CATALOG_SERVICE_BASE_URL`/`_API_KEY` are configured (catalog reads
are real and live). `CUSTOMER_PROFILE_BASE_URL` and `CUSTOMER_SERVICE_BASE_URL`
are empty (matches the documented `PAUSED_EXTERNAL` blocker in
`docs/ACTIVE_RELEASE.md`) -- customer-context and purchase-history reads are
honestly `unavailable` in this environment for both architectures, not
simulated. `CARRIER_SERVICE_API_KEY` is unset -- shipping lookups may fail
auth. The bake-off reports this as a real signal rather than papering over it
with fixture data (`AGENTS.md`: no datos ficticios presentados como reales).

### 1.4 Existing benchmark infrastructure (reused, not rebuilt)

- `lib/brain/commercial/agent-loop/benchmark/instrumentedProvider.ts` --
  wraps any `AgentLoopProvider` (including R2's own semantic planner) and
  records `elapsedMs`, `inputTokens`, `outputTokens`, `reasoningTokens`,
  `finishReason`, `model` per LLM call. Reused as-is for R2's efficiency
  metrics.
- `lib/brain/commercial/work/benchmark/runR2Scenario.ts` -- drives the real
  R2 pipeline turn-by-turn and returns `capabilityCalls`, `llmCallCount`,
  `turnLatencyMs`. Reused as the R2 side of the bake-off runner.
- `tests/commercial/fixtures/a13-conversational-reliability-scenarios.ts` --
  21 scenarios already cover 18 of the 20 requested categories (missing:
  head-to-head product comparison, explicit budget-constrained
  recommendation). Its Spanish/Chilean customer message text is reused
  verbatim as the shared bake-off corpus seed; its `CommercialIntentPlan`
  scripts are R2-internal and not reused (the bake-off needs a real LLM call
  on both sides, not an offline-scripted planner).

### 1.5 DeepSeek Harness -- what actually exists

There is no product called "DeepSeek Harness" already installed or wired
into this repo. It is a real, separate open-source project
(`@deepseek-ai/dsh`, `github.com/deepseek-ai/deepseek-harness`), published to
npm 2026-08-13, MIT-licensed, maintained by a `deepseek.com` address,
currently at `0.1.1-rc.2` and explicitly labelled **developer preview** ("there
will be compatibility-breaking changes"). Verified via `npm view` against the
real registry, not assumed from search results.

Architecture: "everything is a plugin," built on `@deepseek-ai/cordis` (a
dependency-injection/effect framework). A deployment is a stack of YAML
patch layers (`cordis.patch.yml`) composed over an empty root; `dsh-base`
supplies the shared core (LLM adapter, session log, agent loop, tool
registry), and a *profile* (`web`, `headless`, or a custom one) layers a
patch on top. Two profiles ship out of the box:

- `dsh web` -- a chat UI server, out of scope (interactive, human-in-the-loop).
- `dsh --profile headless "task"` -- **one-shot only**: creates one fresh
  Agent, submits one message, waits for quiescence, prints the final
  assistant text, exits. No interactive follow-up surface. Not usable
  directly for a multi-turn conversation.

It is a **general-purpose coding-agent harness**, not a customer-service
one: the default `dsh-base` bundle mounts `tool-bash`, `tool-fs`,
`tool-fs-search`, `subagent` (spawn/fork/codex/claude-code delegation),
`plan-mode`, `tool-ralph`, `tool-workflow`, `tool-web` (search/fetch), and a
sandboxed filesystem/shell policy -- none of it relevant to a WhatsApp sales
conversation, and several of those (bash, fs, subagent spawn) are exactly
the kind of tool this bake-off must never expose to the model.

Multi-turn driving is possible, but not through the shipped `headless`
profile: `@deepseek-ai/dsh-agent`'s public `Agent` handle exposes
`agent.followup(message)` (queue an ordinary next turn on the *same* session)
and `agent.whenIdle()` (await quiescence), with the full durable transcript
readable off `agent.session.events` afterwards. `@deepseek-ai/dsh-app-boot`
exports the same `boot()` function the `dsh` CLI itself uses to assemble a
Cordis context from patch layers. Tool registration follows the same
pattern `@deepseek-ai/dsh-tool-web` uses: `ctx.tools.register({ name,
parameters, execute, output })` -- a plain, documented plugin extension
point, not an internal.

**Bake-off Harness runner design** (satisfies the user's explicit
constraint: use the official engine, do not build a custom loop or reuse
the existing Agent Tool Loop): write one small Cordis plugin -- structurally
identical to `dsh-headless`'s own `headless-runner`, using only its public
`ctx.agents`/`agent.followup`/`agent.whenIdle` API -- that submits the
bake-off's scenario turns sequentially against ONE persisted Agent instead
of `dsh-headless`'s single message, and a second plugin that registers the
four read-only tools. Both plug into an unmodified `dsh-base` +
`dsh-llm-deepseek` engine; nothing about the model loop, session log, retry
policy, or tool-execution pipeline is reimplemented. Everything unrelated to
a sales conversation (bash/fs/subagent/plan-mode/skill/web-search/telemetry)
is disabled in the patch, not deleted from the package.

Operational notes carried into Phase 5: `dsh-base` mounts OTLP session
telemetry to `https://harness-telemetry.deepseeksvc.com` **by default**
(disabled only via `DSH_TELEMETRY_DISABLED`) -- a real consideration for a
harness that would ever see live customer conversations. The default model
route (`agent-default-model`) is `deepseek-official` / `deepseek-v4-flash`,
credentialed via `DEEPSEEK_API_KEY` -- the same DeepSeek family this repo
already calls through `BRAIN_MODEL_API_URL`/`BRAIN_MODEL_NAME`, so both
architectures can run the identical model.

## Phase 2 -- Isolated harness runner: what it took to get working

Everything below lives under `experiments/deepseek-harness/`; see that
directory's `README.md` for exact reproduction steps. Nothing here touched
`app/`, `lib/brain/commercial/native-cycle`, or any WhatsApp entry point.

Built: a local deterministic catalog fixture (`fixtures/catalogFixtureServer.mjs`,
matching the real `/api/v2/catalog/resolve-product-intent` contract), four
read-only tool bodies shared verbatim by both runners
(`tools/bakeoffCrmTools.ts`, calling the real `lib/catalog`,
`lib/integrations/carrier-service`, and
`lib/brain/commercial/commercial-customer-context` boundaries), a Cordis
patch disabling every coding-agent capability `dsh-base` ships by default
(bash/pwsh/fs tools, subagent delegation, plan mode, skills, web search,
telemetry -- `harness/bakeoff.cordis.patch.yml`), a tool-registration plugin
(`harness/bakeoffToolsPlugin.ts`), and a multi-turn runner plugin
(`harness/bakeoffRunnerPlugin.ts`) built from the exact same public surface
`@deepseek-ai/dsh-headless`'s own one-shot runner uses (`ctx.agents.create`,
`agent.followup`, `agent.whenIdle`) -- extended to drive N sequential turns
on one persisted Agent instead of headless's single message, since the
shipped `headless` profile has no interactive/multi-turn surface at all.

Getting this running surfaced five real, disclosable operational problems
with the harness as it exists today (2026-08-30, `dsh@0.1.1-rc.2`, ~2.5
weeks post-release, explicitly "developer preview"):

1. **`dsh-base`'s own "latest" npm dist-tag is broken.** It resolves to a
   stale `0.0.1-rc.1` whose declared dependency `@deepseek-ai/dsh-bash-env`
   was renamed to `dsh-shell-env` in later versions and was never
   itself published under the old name -- `npm install @deepseek-ai/dsh-base`
   with no version pin 404s and cannot be fixed by the installer; every
   package in this bake-off had to be pinned to the exact `0.1.1-rc.2` the
   main `dsh` CLI actually depends on.
2. **Requires Node >=22.** `@deepseek-ai/dsh-agent-loop` uses
   `Promise.withResolvers` (V8/Node 22+) and `dsh-session-persistence-jsonl`
   imports `node:zlib`'s native Zstd functions (also 22+). This repo's
   ambient Node is 20.19.0; the Harness half of this bake-off runs on Node
   24.14.0 fetched via the machine's already-installed nvm, invoked directly
   (not as the shell default) to avoid disturbing the rest of the
   environment.
3. **No multi-turn entry point ships today.** `dsh --profile headless` is
   one submitted message, then exit -- "no interactive follow-up surface"
   by its own README. A real conversation needed a custom ~60-line plugin
   built from the same public `ctx.agents` API `dsh-headless` itself uses;
   this is the documented extension pattern, not a workaround, but it is
   work an integrator has to do that the package does not provide.
4. **`@deepseek-ai/cordis-plugin-loader`'s dynamic `import()` of a plugin's
   TypeScript dependency graph does not reliably route through tsx's
   alias/transform hook** -- confirmed by direct A/B (the identical file
   imports cleanly under a plain `tsx` entry point, and fails with a
   confusing "does not provide an export" under the loader on Node >=22
   regardless of `@/`-alias vs. relative-path imports). Worked around by
   pre-bundling the tool-wrapper module with esbuild into a single
   dependency-free `.mjs`; the two Cordis plugins themselves stay plain
   `.ts` and load fine directly.
5. **Session telemetry phones home by default.** `dsh-base` mounts OTLP
   log export to `https://harness-telemetry.deepseeksvc.com` unless
   `DSH_TELEMETRY_DISABLED` is set -- a real, non-obvious consideration for
   a harness that would ever see live customer conversation content, and
   this bake-off's patch disables that row explicitly.

None of these are permanent architectural objections -- (1)-(4) are exactly
the kind of rough edges a fast-iterating 2.5-week-old release sheds quickly,
and (5) is one config flag. They are, however, real evidence about
production-readiness *today*, weighed in Phase 5 below.

## Phase 3 -- Shared scenario corpus

`experiments/deepseek-harness/scenarios/bakeoff-scenarios.json`: 20 scenarios
(37 total customer turns), one per requested category, in Chilean Spanish,
grounded in the fixture catalog's product set (never a live/observed
PesasChile catalog, since neither a live Catalog Service instance nor a
reachable dev MariaDB exists in this sandbox -- see below). Includes the
exact example conversations from the task brief (the home-gym thread, the
barra-olimpica correction thread) as `H0-10`/`H0-06`/`H0-12`/`H0-13`.

**Environment constraints that shaped what could run live** (checked, not
assumed): `CATALOG_SERVICE_BASE_URL` in `.env` points at `127.0.0.1:4010`,
unreachable in this sandbox (`ECONNREFUSED`) -- likely a service another
local process/session owns, never started here. `DB_HOST:DB_PORT`
(MariaDB) is equally unreachable. `CUSTOMER_PROFILE_BASE_URL` and
`CUSTOMER_SERVICE_BASE_URL` are empty (the documented `PAUSED_EXTERNAL`
blocker already on record in `docs/ACTIVE_RELEASE.md`). The real DeepSeek
API (`BRAIN_MODEL_API_URL`/`_API_KEY` in `.env`) **is** reachable and was
used for every model call in both runners -- this bake-off's independent
variable is genuinely orchestration architecture, not model quality, both
sides run `deepseek-v4-flash` through the same account.

Given no live catalog microservice and no reachable dev database, both
runners are pointed at one shared local fixture server that mirrors the
real Catalog Service HTTP contract field-for-field (verified by running the
real `httpCatalogAdapter.ts` parser against the fixture's raw response, not
assumed). R2's DB-backed execution/dispatch stage could not run live in
this sandbox at all (see next section) -- Customer Profile / Customer
Service calls report `identity_insufficient` / `unavailable` on both sides,
exactly as real production would when those services are paused, which is
itself one of the 20 requested scenarios (`H0-16`), not a gap.

## Phase 4 -- Evaluation (real run, both sides, 20/20 scenarios, 37 turns each)

**R2 side**: `runCommercialWorkInboundCycle`'s durable projection/execution/
dispatch stage needs a real MariaDB, confirmed unreachable here. That stage
is deterministic, non-LLM code already covered by Phase 1's code audit and
by the existing `tests/commercial/fixtures/a13-conversational-reliability-scenarios.ts`
suite elsewhere in this repo (which exercises it end-to-end against a real
DB, just via an offline-scripted planner, never a live model). What a live
run *could* newly test here -- and does -- is R2's one real cognitive
boundary: `buildIntentPlannerPromptPackage` -> the real DeepSeek HTTP
provider -> `parseCommercialIntentPlan`, run turn-by-turn with in-memory
(never MariaDB) durable-selection/destination tracking standing in for
`reconcileCommercialTrigger`'s real persistence. Disclosed simplification:
`pendingIntents` (the cross-turn clarification-carry-forward state R2
normally persists) is always empty here, so R2's multi-turn clarification
handling is probably UNDER-stated below, never over-stated.

### Efficiency (measured, not estimated)

| Metric (per customer turn, averaged over 37 turns) | R2 (planner call only) | Harness (full turn) |
|---|---:|---:|
| LLM calls | 1.00 | 2.19 (model steps) |
| Tool calls | 0 (planner never calls a tool; execution is separate, deterministic, and did not run live here) | 2.62 |
| Input tokens | 2381 | 479 |
| Output tokens | 608 | 626 |
| Reasoning tokens (share of output) | 587 (96.5%) | 311 (49.6%) |
| Wall time | 9006 ms | 7079 ms |
| Non-`valid`/error outcomes | 7 / 37 (19%, all `timeout`) | 0 / 37 |

The input-token gap (2381 vs. 479, ~5x) is the single most consequential
efficiency finding: R2's planner prompt re-sends the full intent-plan JSON
schema, catalog context, and durable-state summary on every call with no
cross-turn reuse, while the Harness's persistent session lets DeepSeek's
prompt cache absorb the repeated system prompt/tool schemas/prior turns
(136,704 cached tokens read across the 37-turn run, essentially free).
R2 making exactly one call per turn does not translate into being faster
overall -- the larger, less-cacheable prompt and comparable reasoning
overhead erase that advantage (9.0s vs. 7.1s average).

The 19% timeout rate is real, not a probe artifact: `runCommercialWorkInboundCycle.ts`
defaults to the identical 20-second budget
(`resolvedSalesAgentConfiguration.effectiveModelConfiguration.timeoutMs ?? 20_000`)
for this exact call in production. Putting R2's entire per-turn latency
budget into one large, reasoning-heavy call is fragile in a way the
Harness's multi-step loop was not in this run (zero timeouts across the
same 37 turns, despite making more total model round-trips) -- a slow
individual tool-selection step there did not blow the whole turn's budget
the way R2's single all-or-nothing call did.

### Correctness and commercial quality (spot-checked against real output)

Both architectures degrade honestly under the two injected-fault scenarios:
`H0-15` (catalog unavailable) and `H0-16` (Customer Profile unavailable)
produced Harness responses that explicitly told the customer the tool
failed rather than fabricating products/history, then offered a next step
-- the exact behavior `AGENTS.md`/`NO_FALSE_PRODUCT` demand. R2's
equivalent (read from the code, not re-run live) is the controlled
`model_unavailable`/capability-failure fallback dispatch already audited in
Phase 1 -- same honesty guarantee, enforced structurally rather than by
model instruction.

The clearest, most decisive gap is the two categories Phase 1's audit
already predicted R2's fixed intent vocabulary cannot express
(`LLM-R1-T09A`'s planner only emits `select_products | get_shipping_quote |
select_shipping_option | create_quote | cancel | repeat_purchase |
customer_aware_recommendation | unsupported` -- no "compare" or
"budget-constrained assembly" intent exists), confirmed live:

- **`H0-03`, product comparison** ("la de 15kg y la de 20kg... cual me
  conviene si entreno fuerza cuatro veces por semana"): the Harness gave a
  specific, product-grounded recommendation (competition-grade tolerances,
  standard powerlifting weight, progressive-overload reasoning) and a
  natural follow-up. R2's planner mapped the same message to
  `customer_aware_recommendation` -- the closest available intent, but the
  wrong one: it asks for a NEW recommendation from purchase history, not a
  comparison of two products already on the table. Production R2 would
  route this to the Customer Profile capability (which reports
  `identity_insufficient` at LEVEL_0, exactly the anonymous customer this
  scenario simulates) and produce a generic degraded reply, never actually
  comparing the two barbells.
- **`H0-11`, budget-constrained home-gym recommendation** ("armar un home
  gym con 700 lucas"): the Harness made 13 real tool calls, assembled TWO
  complete, price-accurate multi-item combos (rack + barbell + bench +
  plates) each correctly summing to just under 700,000 CLP, and asked a
  natural qualifying follow-up. R2's planner again produced
  `customer_aware_recommendation` with a free-text `queryHint` -- a single
  generic recommendation call, structurally incapable of the multi-item
  budget composition the Harness performed zero-shot.

This is the bake-off's central finding: the Harness's open-ended
tool-calling loop handled two genuinely new commercial capabilities the
moment they were asked, using only the four read-only tools already
defined. R2 handling the same requests well would require new engineering
-- a new intent type in the planner's enum, a new deterministic projection
rule, a new step-executor branch -- for each one.

### Architectural complexity (from Phase 1's code reading + this build)

R2's complexity is almost entirely in the deterministic middle
(projection/reconciliation/execution -- real, audited, already tested
against a real DB elsewhere) with a thin, narrow-vocabulary cognitive layer
on top. The Harness's complexity is the inverse: a thin deterministic layer
(this bake-off's four tool wrappers, a few hundred lines) with all
adaptability pushed into the model's own reasoning inside a general-purpose
plugin runtime carrying ~85 packages (most disabled for this bake-off, but
still a real dependency-tree/upgrade-surface commitment) and zero durable
business-state persistence of its own -- by design, per the task's own
target separation, that stays MariaDB's job.

## Phase 5 -- Architecture decision

**Verdict: `HYBRIDIZE_WITH_HARNESS`**

**What becomes the conversational authority.** A persistent, iterative
tool-calling loop -- proven here to handle open-ended advisory asks
(comparison, budget-constrained multi-item assembly, broad consultative
questions) that R2's fixed intent vocabulary structurally cannot express
without new engineering per capability -- becomes the layer that talks to
the customer for CONSULTATIVE/ADVISORY turns: search, compare, recommend,
clarify, answer general questions. Concretely, this repo does not need to
adopt the external `@deepseek-ai/dsh` package to get this: it already has
its own sibling runtime built on the identical pattern
(`lib/brain/commercial/agent-loop/runAgentToolLoop.ts`, currently a
separate, mutually-exclusive, flag-gated path from R2 per
`commercialCycleConfig.ts`). This bake-off validates the PATTERN (iterative
tool loop + persistent session + prompt caching beats one fixed-vocabulary
planner call for advisory work); the vehicle for adopting it should be that
already-integrated, already-tested internal runtime, not a 2.5-week-old
external dependency that cannot currently be installed without pinning
around a broken npm publish, requires a Node major version this repo does
not run, ships no multi-turn entry point out of the box, and phones
telemetry home by default.

**What remains deterministic.** Every mutating action --
`select_products`, `set_shipping_destination`, `select_shipping_option`,
`create_quote`, `create_customer`, `link_external_identity`, cancellation
-- continues to execute exclusively through the existing Capability Gateway
(`lib/brain/commercial/capability-gateway/`), governed by its
`{sideEffect, authority, riskClass}` contract, exactly as today. No model of
any architecture is ever handed direct authority to invoke a mutating
capability; this bake-off's own tool surface for the Harness enforced
exactly this (four read-only tools, nothing else) and that boundary does
not move. This is not a preference -- `AGENTS.md`'s non-negotiable rule 7
("No decisiones de permisos delegadas al LLM") already forbids the
alternative.

**What happens to CommercialWork.** It is not replaced. Its planner
(`semanticIntentAdapter.ts`) keeps owning the intents it already resolves
well and cheaply where R2's structure is a genuine strength: single-item
selection, quantity/product corrections, shipping quotes, cancellation --
turns with one clear, boundable transactional outcome the deterministic
projection/execution/dispatch pipeline already handles with full
durability, retry, and audit trail (real properties, verified in Phase 1,
that a tool-calling loop does not get for free). CommercialWork becomes
narrower in conversational scope, not smaller in transactional
responsibility: the governed kernel every advisory turn still has to route
through the moment a customer says "yes, that one."

**What is reused.** The Capability Gateway and every domain boundary behind
it, unchanged. `buildCommercialWorkProjection`/`executeCommercialWork`/
`settleCommercialWorkProjection` for every turn that resolves to a bounded
transactional intent, unchanged. The existing Agent Tool Loop
(`runAgentToolLoop.ts`) as the concrete vehicle for the expanded
conversational scope -- it already shares the same Capability Gateway,
already has production wiring, already has its own benchmark
infrastructure (`agent-loop/benchmark/`).

**What becomes obsolete.** Nothing outright. `semanticIntentAdapter.ts`'s
enum stops needing to grow to cover every new advisory capability a
product owner dreams up (comparison, budget planning, style/use-case
questions) -- those move to the tool-calling loop instead of demanding a
new intent type each time, which is a real reduction in R2-side
maintenance surface even though no R2 code is deleted today.

**Migration cost.** Low relative to adopting the external Harness: the
target runtime already exists and is already integrated with the same
Capability Gateway, same identity gating, same audit trail. The real work
is widening `commercialCycleConfig.ts`'s routing so more conversation
shapes reach the Agent Tool Loop instead of (or before falling back from)
CommercialWork's planner, and closing the gaps Phase 1's audit already
found in that path (no `crm_opportunities` row creation on this path today,
per `LLM-R1-T09B`'s documented limitation) -- real, bounded, already-scoped
engineering, not a rewrite.

**Operational cost.** Two runtimes to reason about conversationally
(already true today, per Phase 1's audit -- this changes their relative
weight, not their existence) instead of one plus a brand-new external
dependency. No new npm dependency tree, no new Node-version requirement, no
new default-on external telemetry to audit.

**Major risks.** (1) Widening the Agent Tool Loop's conversational
footprint without first closing its documented gaps (no
`crm_opportunities` creation, no explicit venue/postventa separation
demonstrated on the native path per `ACS-R1-05.1-T02` in
`docs/ACTIVE_RELEASE.md`) risks moving those gaps into more customer
conversations rather than fixing them -- sequence the gap closure before
the routing expansion, not after. (2) A customer conversation that starts
advisory and ends transactional (e.g. `H0-13`: compare -> ask shipping ->
change product) needs a clean, tested handoff between the two runtimes
sharing one `conversation_case`/`opportunity` identity -- this bake-off did
not test that handoff under load (each scenario ran as one isolated agent
process); it is the single largest piece of real engineering this
recommendation implies. (3) If the external DeepSeek Harness is later
reconsidered as the vehicle instead of the internal Agent Tool Loop (e.g.
once its packaging stabilizes), everything in Phase 2's five findings
should be re-verified against whatever version is current then -- none of
them looked structural, but none were spot-fixed here either.

