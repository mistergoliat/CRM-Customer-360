# SALES-AGENT-R3-V1.8-C0 -- DeepSeek Harness Production Adoption Re-evaluation

Status: decision gate, no production code changed. Documentation-only
artifact (this file), plus `docs/ACTIVE_RELEASE.md` updated in the same
change. This task re-evaluates whether R3 should adopt `@deepseek-ai/dsh`
(the "DeepSeek Harness") as a production runtime, given that V1.8-A and
V1.8-B already characterized R3's own context-continuity gap and the
Harness's native session capability, and A13-H0 already ran a live
head-to-head bake-off. This document does not re-derive what those three
documents already proved from source; it cites them and adds only new
evidence: a same-day check of the package's actual current state on the
public npm registry and GitHub, and a reading of the exact production
boundary code (`AgentLoopProvider`, `CommercialActionRequest`) an adapter
would have to sit behind.

## 1. Executive verdict

**Primary: `CONTINUE_NATIVE_R3_HARNESS_PATTERN`**
**Secondary: `DEFER_HARNESS_ADOPTION_UNTIL_STABLE`** (re-open only once the
package ships a tagged stable/1.0-track release with a working `latest`
dist-tag and a documented API-stability policy for `Agent`/`Session`)

Both A13-H0 (`HYBRIDIZE_WITH_HARNESS`: adopt the pattern, not the package)
and V1.8-B (Axis 1: "do not adopt the external package into production in
V1.8-C") already reached this conclusion. This document does not overturn
either. What is new is dated, first-party proof that the specific risk
Section B of this task's brief asked to investigate ("API churn between
versions") is not hypothetical: the exact API V1.8-B built its entire live
characterization on -- `agent.session.events`, read directly in
`bakeoffRunnerPlugin.ts` and quoted verbatim in V1.8-B section 4/6 -- was
already replaced by an on-demand API (`seq`, `eventAt()`,
`snapshotEvents()`) in `@deepseek-ai/dsh-agent@0.1.2-alpha.4`, published
2026-09-01 (the same day this re-evaluation was written), roughly ten days
after the version this repo has installed and evaluated
(`0.1.1-rc.2`, 2026-08-21). A package whose own most-active release channel
breaks the one API a production integration would depend on most, within
ten days of that API being evaluated, has not yet earned production trust
regardless of how the architectural coupling question (Section 6) is
answered. Combined with the unresolved production-topology mismatch
(Section 9 -- a long-lived in-process `Agent` object against PesasChile's
stateless Meta-webhook-per-request deployment) and the still-broken `latest`
npm dist-tag (Section 2, first found in A13-H0, re-confirmed here, still
broken), the Decision Rule (Section S of the task brief) fails on multiple
independent, load-bearing criteria (Section 20). Retain R3-native; design
R3's own cross-turn session object next (Section 21), as V1.8-B already
scoped.

## 2. Current Harness maturity/version

Checked live against the public npm registry and GitHub
(`registry.npmjs.org/@deepseek-ai/dsh-base`,
`registry.npmjs.org/@deepseek-ai/dsh-agent`,
`github.com/deepseek-ai/deepseek-harness`), not re-derived from the
`node_modules` snapshot A13-H0/V1.8-B already read from source.

| Fact | Value | Source |
|---|---|---|
| Version installed in `experiments/deepseek-harness/` | `0.1.1-rc.2` (all ~140 `@deepseek-ai/dsh-*` packages + `cordis@4.0.2`) | `package.json`/`package-lock.json`, re-confirmed this task |
| `dsh-base`/`dsh-agent` `latest` dist-tag | `0.0.1-rc.1` -- the same stale, broken tag A13-H0 found (`dsh-shell-env`/`dsh-bash-env` rename 404) | npm registry, checked 2026-09-01 |
| `next` dist-tag | `0.1.1-rc.2` -- matches what this repo has installed | npm registry |
| `alpha` dist-tag | `0.1.2-alpha.4`, published 2026-09-01 | npm registry |
| Versions published since this repo's snapshot | `0.1.2-alpha.1` (Aug 27), `alpha.2` (Aug 30), `alpha.3` (Aug 31), `alpha.4` (Sep 1) -- four releases in five days | GitHub releases page |
| Repository scale | 208,000 stars, 14,874 commits on `master`, MIT license, owner `deepseek-ai` (official) | GitHub, checked 2026-09-01 |
| Vendor's own stability claim | "DeepSeek Harness is in developer preview and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**" (repository's own front page, verbatim) | GitHub |
| Stated roadmap to 1.0/stable | None found | GitHub, checked 2026-09-01 |

**Classification: `DEVELOPER_PREVIEW`** -- this is the vendor's own explicit
label, not this audit's inference. Distinguishing vendor claim from
independent inference, as the task asks: the vendor claims "developer
preview, breaking changes will happen"; this audit's own independent
observation (Section 4) is that the claim is not boilerplate -- a
production-relevant API broke inside the observation window of this very
task. Separately, the star/commit count is real, independently-checked
evidence of strong vendor backing and active investment (mitigates
abandonment risk, Section K) that is orthogonal to, and does not offset,
the API-stability finding.

One caveat on evidentiary rigor, kept consistent with V1.8-A/B's own
PROVEN/LIKELY/NOT PROVEN discipline: the version/dist-tag/star/commit-count
facts above come from direct registry/repository metadata (`PROVEN`, same
standard as reading `node_modules` from disk). The release-note bullets in
Section 4 come from an AI-summarized fetch of the GitHub releases page, not
a byte-level diff of the package source the way V1.8-B read `cordis.patch.yml`
-- treat those specific bullets as `LIKELY` (high-confidence, first-party
source, but mediated through a summarization step), not `PROVEN` with the
same rigor as this repo's own source-level audits.

## 3. Architecture options (restated for this repo's actual state)

**Option A -- R3 Native.** Keep `runAgentToolLoop`, `httpAgentLoopProvider`,
`AgentSessionStore`. Not "keep building a bespoke framework from zero": R3
already has the boundary an adapter would need (Section 6) and V1.8-B
already scoped the one missing piece (a cross-turn, append-only,
derive-on-read session object). "Native" here means finishing that one
piece, not starting a new one.

**Option B -- Harness Adoption.** Replace `runAgentToolLoop`'s cognition/session
layer with `@deepseek-ai/dsh`'s `Agent`/`Session`. PesasChile keeps
identity, Capability Gateway, catalog, shipping, quote, CRM, outbox, Meta --
unchanged from A13-H0's own framing.

**Option C -- Portable Runtime Adapter.** `SalesAgentRuntime -> AgentRuntimeAdapter
-> {DeepSeekHarnessRuntime | NativeRuntime}`. Evaluated on its own merits
below (Sections 6, 16, 19), not assumed superior by default, per this
task's own instruction.

## 4. API stability / breaking-change risk (load-bearing)

| API | Classification | Evidence |
|---|---|---|
| `AgentRegistry.create` | `PUBLIC_STABLE` (so far) | Documented type surface, used unchanged across A13-H0 and V1.8-B (11+ days apart) |
| `AgentRegistry.resume` | `PUBLIC_DOCUMENTED, UNEXERCISED` | Documented in `dsh-agent/lib/types/index.d.ts` (V1.8-B section 4); never called by any audit in this repo -- its real-world stability under our own use is `UNKNOWN` |
| `agent.followup` / `agent.whenIdle` | `PUBLIC_STABLE` (so far) | Same evidence as `create` |
| `agent.session.events` | **`PUBLIC_UNSTABLE -- CONFIRMED BROKEN`** | Replaced by `seq`/`eventAt()`/`snapshotEvents()` in `0.1.2-alpha.4` (2026-09-01), ten days after this repo's own audit built its central live-evidence section (V1.8-B section 6) directly on this property |
| `agent.session.deriveMessages` | `PUBLIC_STABLE` (so far), but now sits on top of a session-log representation that just changed shape -- its own internal stability is not independently confirmed post-`alpha.4` | GitHub release notes (`LIKELY`, see Section 2 caveat) |
| Session persistence backend (`dsh-session-persistence-jsonl`) | `PUBLIC_UNSTABLE` | `0.1.2-alpha.1` release notes state the SQLite persistence format is incompatible with previous versions -- a sibling persistence mechanism in the same package family breaking format compatibility one release earlier is direct evidence against assuming JSONL is exempt |
| `dsh-session-checkpoint-policy` | `INTERNAL/UNDOCUMENTED` beyond "checkpoints before each model request" | No public configuration contract found beyond the Cordis patch row itself |
| Compaction hooks (`dsh-compaction-basic`, `dsh-compaction-tool-result-pruner`) | `INTERNAL` | Configured via Cordis patch YAML (`thresholdChars`/`headChars`/`tailChars`), not a documented public tuning API |
| Tool registration (`ctx.tools.register`) | `PUBLIC_STABLE` | Same pattern used unchanged in A13-H0's own `bakeoffToolsPlugin.ts`, documented extension point |
| Provider configuration (`dsh-llm-deepseek`, model route) | `PUBLIC_DOCUMENTED`, DeepSeek-specific | See Section 12 |
| System prompt configuration (`dsh-system-prompt`) | `PUBLIC_DOCUMENTED` | Used as-is by both bake-off runners |

**Can semantic-version compatibility be trusted?** No, not yet, on direct
evidence rather than inference. The package's own `0.x` status already
warns against it (semver makes no promise below `1.0.0`); this audit adds a
concrete instance rather than relying on that warning alone. Also notable
as a maturity signal in its own right (Section K): the package's dist-tag
ordering is inverted from the usual alpha->beta->rc->stable progression --
`alpha.4` is *ahead* of, and has already broken compatibility with, the
`rc.2` this repo evaluated. That is not how a stabilizing release train
normally behaves.

**Migration blast radius estimate:** `0.1.x -> 0.2`: **HIGH** if it touches
`Session`/`Agent` (already demonstrated inside `0.1.x` itself, before any
`0.2` line exists). `0.x -> 1.0`: **UNKNOWN**, no roadmap or stability
commitment found (Section 2) to estimate against.

## 5. Dependency / runtime surface

| Metric | Harness (`@deepseek-ai/dsh` family) | R3 native |
|---|---|---|
| Package count | ~85 packages in the full `dsh-base` bundle (A13-H0 Phase 4), ~140 `@deepseek-ai/*` resolved in this repo's sandbox lockfile (V1.8-B section 2) | 0 new packages |
| Node requirement | `>=22` (`Promise.withResolvers` in `dsh-agent-loop`, native Zstd in `dsh-session-persistence-jsonl`) | Runs on this repo's ambient `20.19.0` (`.nvmrc`, re-confirmed this task) |
| Native modules | None found | N/A |
| Install footprint | `latest` dist-tag broken (404 on a renamed transitive dep); every package must be pinned to an exact prerelease version to install at all | N/A |
| Build tooling workaround needed | Yes -- `cordis-plugin-loader`'s dynamic `import()` does not reliably resolve a plugin's TypeScript dependency graph through `tsx`'s hook on Node >=22; A13-H0 worked around it by pre-bundling with `esbuild` | N/A |
| Startup implications | A dedicated Cordis context boot (`boot()`/patch-layer composition) per process, on top of the model call itself | N/A -- provider call is a plain HTTP fetch |

Package count alone is not evaluated as a negative per this task's own
instruction; the operational surface it implies (a second Node major
version pinned in the deployment matrix, a build-tool workaround already
needed once, an install path that 404s without exact pins) is the real
signal, and none of it has resolved since A13-H0 raised it two-plus weeks
ago.

## 6. Framework coupling

Desired boundary (per this task's brief):

```
PesasChile domain
       |
internal runtime contracts   <-- AgentLoopProvider / CommercialActionRequest (already exist)
       |
Harness adapter               <-- would be new
```

This is closer to already-real than a green-field design effort. Two
concrete, source-verified facts support it:

1. **`AgentLoopProvider`** (`lib/brain/commercial/agent-loop/agentLoopProviderTypes.ts`)
   is already a narrow, provider-neutral contract: `{messages: {role:
   "system"|"user", content: string}[]} -> {rawOutput, model?, inputTokens?,
   outputTokens?, reasoningTokens?, finishReason?}`. No DeepSeek-specific
   concept, no Cordis type, no `SessionEvent` leaks into it. Its own doc
   comment explicitly records that it was deliberately kept lighter than an
   older, heavier contract for exactly this kind of substitutability.
2. **`CommercialActionRequestSource`** (`lib/brain/commercial/commercial-action-request/types.ts:16`)
   already includes `"sales_agent_harness"` as a literal value, alongside
   `"agent_tool_loop"`/`"multi_intent"`/`"commercial_work"` -- and its own
   design doc (`docs/releases/SALES-AGENT-R3-A03-commercial-action-request.md:73`)
   carries the identical union. Grepped exhaustively: this literal has
   **zero runtime emitters** anywhere in `lib/`/`app/` today. It is a
   reserved, never-wired placeholder, not dead code from a removed feature
   -- direct, source-level evidence that R3's own boundary was designed
   with a future Harness-sourced action path in mind, without ever
   committing to build it.

**Where coupling would actually leak, if adopted:** not through
`AgentLoopProvider`/`CommercialActionRequest` (both already reasoning-loop-
source-agnostic), but through whatever durably stores the Harness's own
`Session`. If a persisted Harness session (JSONL or otherwise) becomes the
system of record for conversational continuity, PesasChile becomes coupled
to that format regardless of how clean the import-side boundary looks --
and Section 4 already shows that format is not stable even within the
package's own `0.1.x` line (SQLite persistence format break, one release
before the event-log API break). **Verdict: clean coupling behind the
existing boundary is realistic for the call/response path; it is not yet
demonstrated for the persisted-session path**, which is precisely the part
Option B/C would most want to keep.

## 7. Tool / capability integration mapping

| Path | Status | Evidence |
|---|---|---|
| Harness tool call -> `ReadToolGateway`-equivalent read | **Proven, live** | A13-H0's `bakeoffCrmTools.ts` wraps the real `lib/catalog`, `lib/integrations/carrier-service`, and `lib/brain/commercial/commercial-customer-context` boundaries verbatim; V18B-01 (V1.8-B) exercised these for real against the live DeepSeek API |
| Harness tool call -> `CommercialActionRequest` -> Capability Gateway -> **denied** mutation | **Never built or tested** | Neither A13-H0 nor V1.8-B ever exposed a mutating tool to the Harness; every bake-off tool is explicitly read-only by design (A13-H0 Phase 1.5: "several of those [bash, fs, subagent spawn] are exactly the kind of tool this bake-off must never expose to the model" -- the same caution was never extended into *testing* a safe mutating boundary, only into avoiding one) |
| Typed schemas / tool result transport | Compatible in principle | `ctx.tools.register({name, parameters, execute, output})` is a plain, documented Cordis extension point (A13-H0 section 1.5); `CommercialActionResult`'s existing shape (`status`, `data`, `errorCode`, `retryable`, `gatewayResult`) could serialize into a tool result without new plumbing -- not independently verified by executing it |
| Errors / retries / cancellation / timeout / idempotency / correlation | `UNKNOWN` | Not exercised by either prior audit against the Capability Gateway's own governance codes (`DENIED`/`BLOCKED`/`RETRYABLE`/`REQUIRES_REVIEW`, `commercial-action-request/types.ts:63-71`); whether a Harness tool call surfaces these distinctly to the model, or collapses them, is untested |

**This is the single largest unverified integration risk if Option B/C is
ever pursued**, larger than anything about the reasoning loop itself: R3's
non-negotiable rule ("No decisiones de permisos delegadas al LLM",
`AGENTS.md` rule 7) depends on a mutation request that the Gateway denies
actually reaching the model as a legible, non-bypassable denial -- and that
path has never been built, let alone tested, against this package.

## 8. Session persistence / resume

V1.8-B's own finding stands: **LEVEL 4 durability by source** (default-mounted
`dsh-session-persistence-jsonl` + `dsh-session-checkpoint-policy`,
documented `AgentRegistry.resume()`), **never independently executed** in
this repo (`resume()` has not been called once, in any audit to date).

**New finding, this task:** "Level 4 by source" describes a capability that
existed in the *version this repo evaluated*. It is not evidence the
capability survives an upgrade unchanged -- the package's own history
already contains one persistence-format break (SQLite, `0.1.2-alpha.1`) one
release before the event-log API break (Section 4). A production system
cannot treat "the persistence layer is native and default-on" as
equivalent to "the persistence layer is safe to depend on across upgrades"
for this package, today.

## 9. Multi-instance / production topology (critical)

PesasChile production is a Meta webhook hitting a Next.js API route,
potentially across multiple Node process instances, backed by MariaDB and
an outbox worker -- not a long-lived local CLI process. The Harness's
proven multi-turn mechanism (`agent.followup()`/`agent.whenIdle()`, Section
5 of V1.8-B) requires the *same in-process `Agent` object* to be alive for
the next turn. That object does not survive an HTTP request boundary.

| Question | Answer | Confidence |
|---|---|---|
| Can an Agent live across HTTP requests safely? | Not as designed -- it is an in-memory object bound to one process's lifetime | `PROVEN` by the package's own lifecycle model (V1.8-B section 3) |
| Does every turn require `resume()`? | Yes, for any topology where the same process is not guaranteed to handle turn N and turn N+1 (true for PesasChile today) | Inferred from the documented `create` vs. `resume` split; not independently executed |
| Can sessions move between processes? | Only via `resume()` against the persisted store | Same as above |
| Locking model / concurrent followups | `UNKNOWN` -- no documentation or test found addressing two near-simultaneous `followup()`/`resume()` calls against the same `sessionId` | Neither audit exercised this |
| Duplicate inbound behavior | `UNKNOWN` -- WhatsApp/Meta's own retry semantics can redeliver a webhook; whether a second `resume()` + `followup()` against the same session is idempotent is untested | -- |
| Graceful shutdown / rolling deploys | `UNKNOWN` -- no evidence either audit examined what happens to an in-flight `Agent` during a deploy | -- |

The practical implication: even setting API churn aside, adopting the
Harness as designed would mean **every single production turn pays a cold
`resume()` against a monotonically-growing, per-conversation JSONL event
log** (V1.8-A's own incident data shows a real conversation reaching 180+
turns) with no confirmed pagination, eviction, or bounded-read mechanism --
because the "keep the same object warm across turns" model this package is
built around does not fit a stateless webhook handler. This is a
structural impedance mismatch this task's own brief anticipated ("was
Harness primarily designed for long-lived local agents/CLI use") and it is
confirmed, not merely suspected: A13-H0 itself already classified the
default `dsh-base` bundle as a *coding-agent* harness (bash/fs/subagent
tools mounted by default), and both shipped profiles (`web`, `headless`)
are single-user/single-session-at-a-time shapes, not a multi-tenant
request-router shape.

## 10. Context caching / cost

Real, measured numbers from V1.8-B's own live 4-turn run (`V18B-01`,
against the real DeepSeek API):

| Metric | Value |
|---|---:|
| Cached-prefix tokens reused (`cacheReadTokens`) | 15,232, growing monotonically call-over-call (640 -> 3,328 across 8 calls) |
| Fresh input tokens | 2,065 total |
| `request/header`/`request/context` established | once per 4-turn run (never rebuilt) |

Against R3-native's own measured behavior (V1.8-A section 4 /
A13-H0 Phase 4: a fresh two-message JSON payload rebuilt from scratch every
call, 2,381 average input tokens per call with no cross-call cache reuse in
the semantic-intent-adapter comparison), the cache-economics case for a
persistent session is real and already measured, not projected. **The
caveat this document adds:** that benefit is entirely contingent on Section
9's gap being closed. If every production turn requires a fresh `resume()`
because no process holds the `Agent` warm, the growing-prefix cache
advantage this measurement shows may not materialize the same way in
PesasChile's actual deployment shape -- this was measured inside one
uninterrupted process, never across a simulated process boundary.

## 11. Compaction / memory quality

`dsh-compaction-basic` and `dsh-compaction-tool-result-pruner` are
default-mounted and active (V1.8-B section 7), but **never observed firing**
across 41 real turns spanning two independent audits (37 turns in A13-H0,
4 in V1.8-B) -- every real conversation run against this package in this
repo has stayed well under whatever its real compaction threshold is. Its
behavior on PesasChile-scale conversations (180+ turns, per the V1.8-A
incident) remains **completely unverified by direct observation**, in
either audit or this one.

The invariant this task asks about -- session memory must never become
authority for price/stock/shipping/quote/selected-product state -- already
holds structurally in R3 today, independent of which reasoning-loop
architecture is used: `buildNativeCommercialContext.ts` rehydrates
opportunity/need/shipping/line-items fresh from SQL every turn, explicitly
never inferred from `recentMessages` (V1.8-A section 3, "Commercial/durable
state" row). Nothing in this re-evaluation's findings weakens that
boundary, and nothing about adopting or not adopting the Harness changes
which layer owns business truth -- Capability Gateway and its backing
domain tables remain authoritative regardless (A13-H0 Phase 5, "What
remains deterministic").

## 12. Provider lock-in

R3's own `AgentLoopProvider` contract (Section 6) is already provider-
neutral by construction -- plain `{role, content}` messages in, a raw
response envelope out, no DeepSeek-specific field anywhere in the type.
Migrating R3-native to a different provider today is, by design, an
`httpAgentLoopProvider.ts`-shaped adapter swap, not a contract change.

The Harness's own provider layer was not independently re-verified for
multi-provider support in this task (out of scope to install and test a
second provider against it) -- A13-H0/V1.8-B only ever exercised
`dsh-llm-deepseek` / `deepseek-official` via `DEEPSEEK_API_KEY`. **Marked
`UNKNOWN`, not assumed neutral from package naming**, per this task's own
explicit instruction. This is an extra due-diligence item Option B/C would
owe before any provider-migration claim could be made, that Option A
already does not owe (Section 6 evidence already answers it for R3-native).

## 13. Vendor / project risk

| Signal | Assessment | Evidence |
|---|---|---|
| Project age | ~3 weeks at publish (npm: first `@deepseek-ai/dsh-*` packages Aug 13, 2026) | A13-H0, npm registry |
| Release cadence | Very high -- 4 releases in 5 days on the `alpha` channel alone during this task's own observation window | npm registry, checked 2026-09-01 |
| Maintainer / vendor | `deepseek-ai`, official org account; 208k stars, ~14.9k commits | GitHub, checked 2026-09-01 |
| Documentation maturity | Real (CONTRIBUTING.md, AGENTS.md, architecture docs exist per GitHub); no CHANGELOG/MIGRATION guide found linked from the repo root | GitHub, checked 2026-09-01 |
| API churn | Confirmed within this task's own observation window (Section 4) | -- |
| Licensing | MIT | GitHub |
| Telemetry / privacy | OTLP session telemetry to `harness-telemetry.deepseeksvc.com`, **default-on**, opt-out via `DSH_TELEMETRY_DISABLED` | A13-H0 Phase 1.5, re-confirmed not re-checked as fixed in this task |
| Bus factor | Not independently observable from the fetched pages | -- |
| Possibility of abandonment | **LOW** -- official DeepSeek project, high visibility, active cadence | -- |

**Classification: vendor/backing risk `LOW`; near-term API-stability risk
`HIGH`.** These are two different axes and this task keeps them separate
deliberately: a well-backed, actively-developed project is not the same
thing as a production-safe dependency today. The evidence supports "will
probably still exist and improve in a year" and "will probably break your
integration more than once before then" simultaneously.

## 14. Security / data governance

Unchanged from A13-H0/V1.8-B, not re-verified as fixed in this task
(explicitly out of scope to re-audit the package's own defaults beyond the
version check already performed):

- Telemetry: default-on, one env var to disable -- a real but cheap
  mitigation if ever adopted.
- Reasoning persistence: `agent.session.events` includes full `assistant`
  content blocks, explicitly including the model's own `reasoning` blocks
  (V1.8-B section 4). This task's own instruction is unambiguous: "Do NOT
  persist private chain-of-thought in PesasChile even if Harness stores
  reasoning blocks by default." Whether a redaction hook exists at the
  right granularity (strip `reasoning` before any durable write, without
  disabling the event stream entirely) was **not verified** in either
  prior audit or this one -- flagged as a blocker-to-verify for Option B/C,
  not for Option A (R3-native's own `AgentSessionStore` already never
  stores message text or reasoning by design, V1.8-A section 3).
- Tool input/output logging: `agent.session.events` includes full
  `tool/call`/`tool/result` content (V1.8-B section 4), a strictly richer
  capture than `AgentSessionStore`'s tool-name-only design -- same
  redaction-before-persistence question applies if any of this were ever
  written durably in a customer-data context.

## 15. Migration cost

| Category | Assessment |
|---|---|
| `KEEP` unconditionally | Capability Gateway and every domain boundary behind it; `CommercialActionRequest`/`ReadToolGateway`-equivalent surfaces; identity; outbox; Meta delivery; `AgentLoopProvider` contract shape (Section 6) |
| Potentially `REPLACE` (Option B/C only) | `runAgentToolLoop`'s internal request-construction (`buildAgentStepPromptPackage`), replaced by Harness session reads; R3's own provider loop, replaced by `dsh-llm-deepseek` |
| Effort to build the adapter itself | **LOW-MEDIUM** -- the two contracts it would sit behind are already narrow (Section 6) |
| Effort to close the production-topology gap (Section 9) | **HIGH** -- no existing pattern in this repo for a per-turn `resume()` cycle against a growing external event log; genuinely new engineering, not adaptation |
| Effort to close the mutation-rejection gap (Section 7) | **MEDIUM** -- needs a new, tested path, currently zero prior art in either bake-off |
| Regression surface | **HIGH** if routed into the live WhatsApp path; **LOW** if kept isolated (as today) |
| Operational risk | **HIGH**, dominated by Sections 4 and 9, not by the adapter-shape work itself |

No fake story-point precision, per this task's instruction: the honest
summary is that the *shape* of the work is bounded and already partly
scoped by existing code, but the *risk* of doing it now is dominated by two
things this task cannot make smaller by writing better adapter code --
the package's current API-churn rate and the unresolved process-topology
mismatch.

## 16. Maintenance cost comparison (12-24 months)

| | Option A (native) | Option B (adopt) | Option C (adapter) |
|---|---|---|---|
| What PesasChile owns | Session, `deriveMessages`-equivalent, compaction, token metering, checkpointing, resume, provider loop -- all in-house | Integration/adaptation layer only; vendor owns runtime/session evolution | Adapter *and* a native fallback (Option C is not credible without one, given Section 4/9) |
| Where the maintenance burden lands | Predictable, internally-paced engineering -- the same kind of work V1.3-V1.8 already did successfully | Reactive -- absorbing vendor-driven breaking changes on the vendor's cadence (four releases in five days observed in this task alone) | Both: adapter drift **and** vendor churn, simultaneously |
| Risk of "accidentally building a second framework inside PesasChile" | Low -- scope is explicitly one cross-turn session object (V1.8-B Axis 2), not a general agent framework | Low, if the adapter boundary (Section 6) is respected | **Highest** -- an adapter that has to keep a fully-functional native fallback alive *and* track an unstable upstream is, in practice, two frameworks, not one abstraction over one |

This directly answers the task's own explicit question: **Option C is the
one most likely to result in accidental framework-building inside
PesasChile**, not because an adapter is inherently bad, but because
today's specific vendor-maturity conditions (Section 4) mean a credible
Option C cannot retire its native path, and therefore doubles the
surface it has to maintain rather than replacing one thing with another.

## 17. Exit strategy

**Current exit cost: zero.** V1.8-B already confirmed zero runtime
`@deepseek-ai/*` imports anywhere in `lib/`/`app/` and zero entries in the
main repo's `package.json`/`package-lock.json`. There is nothing to exit
from today.

**If Option B/C were adopted later and then abandoned:** the JSONL event
log is, in principle, an inspectable, portable export format, and
`deriveMessages()` is a documented path to a neutral `{role, content}`
message list `conversation_message` could theoretically absorb. Neither of
these was tested as an actual export/import round-trip by any audit to
date, and Section 4/8 already show the underlying persisted format is not
stable even within the package's own recent history (a sibling persistence
mechanism, SQLite, already broke format compatibility once). **Do not treat
"the export format is documented" as equivalent to "the export format is
safe to rely on as an exit path" without re-verifying it at the time of any
future adoption decision** -- this is the same caution V1.8-B already
applied to `resume()`, extended here to the export/import direction.

## 18. Proof-of-integration results

**Executed (reused from V1.8-B, not re-run by this task):** `V18B-01`, a
real 4-turn scenario against the live DeepSeek API, proving same-session
continuity across a topic switch and an explicit return (Section 10).

**Deliberately not executed in this task:** a new spike proving (a) a
mutating `CommercialActionRequest`-shaped tool call reaching a fake
Capability Gateway and being denied, with the denial surfacing legibly to
the model (Section 7's gap), and (b) a real `create -> kill process ->
resume() -> confirm full history intact` round-trip (Section 8/9's gap,
already flagged as untested by V1.8-B section 15).

**Why not:** both would only change this document's verdict if the answer
were trending toward `ADOPT_HARNESS_PRODUCTION_RUNTIME` or
`ADOPT_HARNESS_BEHIND_RUNTIME_ADAPTER`. Section 4's dated, first-party
finding (the exact session-read API this repo already depended on for its
prior audit's conclusions was replaced ten days later) is by itself
sufficient to fail the Decision Rule's criterion 8 (Section 20) regardless
of how either spike would turn out. Spending real DeepSeek API budget and
engineering time proving two more capabilities of a package this document
is not recommending for adoption would be scope beyond what this decision
gate needs, and beyond what `AGENTS.md`'s scope-discipline rules ("No
implementar trabajo fuera de alcance sin autorizacion explicita") and this
task's own non-goals ("do not implement new R3 session") call for. Both are
named explicitly as the first two things to run if Option B/C is ever
reopened (Section 21).

## 19. Decision matrix

`STRONG` / `GOOD` / `ACCEPTABLE` / `WEAK` / `POOR`, one line of
justification per cell.

| Dimension | Option A (native) | Option B (adopt) | Option C (adapter) |
|---|---|---|---|
| Conversational quality (session-native pattern) | `ACCEPTABLE` today, `GOOD` once V1.8-B's Axis 2 lands | `GOOD` -- proven live (Section 10) | `GOOD` when routed to Harness, but only for the fraction of traffic the fallback doesn't have to catch |
| Session continuity | `WEAK` today (V1.8-A's own finding), designed target is `GOOD` | `STRONG` by source (Section 8), unproven under real topology | Inherits Option B's strength and Option A's weakness depending on path taken |
| Implementation complexity | `ACCEPTABLE` -- one new, already-scoped object | `ACCEPTABLE` for the adapter shape (Section 6), `POOR` for the topology/mutation gaps (Sections 7, 9) | `WEAK` -- two implementations to keep correct |
| Operational complexity | `GOOD` -- no new runtime, no new Node version | `POOR` -- new Node major version, new build workaround, default telemetry | `POOR` -- same operational cost as B, on top of A |
| Framework dependency | `STRONG` (none) | `WEAK` -- direct dependency on a 3-week-old developer preview | `ACCEPTABLE` -- bounded by the adapter, but the adapter itself can't be thin (Section 16) |
| Upgrade risk | `STRONG` (nothing to upgrade) | `POOR` -- confirmed breaking change inside this task's own observation window | `POOR` -- same upstream risk, absorbed by the adapter instead of avoided |
| Vendor risk | `STRONG` (no vendor) | `ACCEPTABLE` -- low abandonment risk, high near-term churn risk (Section 13) | `ACCEPTABLE` -- same as B |
| Maintenance burden | `ACCEPTABLE` -- predictable, internally paced | `WEAK` -- reactive to vendor cadence | `POOR` -- both burdens at once (Section 16) |
| Debuggability | `GOOD` -- all source in-repo, already-tested | `ACCEPTABLE` -- Cordis plugin stack adds an indirection layer | `WEAK` -- two systems to reason about when something breaks |
| Portability | `STRONG` (already provider-neutral, Section 12) | `WEAK` -- multi-provider support unverified | `ACCEPTABLE` -- inherits A's portability only for the native path |
| Provider independence | `STRONG` (Section 12) | `UNKNOWN`, treated as `WEAK` until verified | `ACCEPTABLE`, same caveat as B for the Harness path |
| Cache efficiency | `WEAK` today (V1.8-A), `GOOD` once Axis 2 lands | `STRONG`, measured (Section 10) -- contingent on Section 9 | `STRONG` for Harness-routed traffic, contingent on the same gap |
| Crash recovery | `ACCEPTABLE` -- MariaDB-backed durable state already exists, session-level recovery not yet designed | `STRONG` by source, `UNKNOWN` in practice (Section 8/9) | Same duality as B |
| Horizontal scaling | `GOOD` -- stateless call pattern already fits multi-instance deployment | `POOR` -- in-process `Agent` object model does not fit today (Section 9) | `POOR` for the Harness path, `GOOD` for the native fallback |
| Security / control | `STRONG` -- no reasoning persistence, no third-party telemetry (V1.8-A) | `WEAK` until redaction/telemetry controls are verified (Section 14) | `ACCEPTABLE`, bounded by whichever path is used |
| Exit cost | `STRONG` (nothing to exit) | `WEAK` -- persisted format stability unproven (Section 17) | `WEAK`, same as B for the Harness-routed data |

## 20. Recommendation

Checking the task's own Decision Rule (Section S), criterion by criterion:

1. Native session/runtime provides material capability we'd otherwise
   maintain ourselves -- **partially true** (real capability, Section 8),
   but insufficient alone.
2. Integration can remain behind a narrow internal boundary -- **met**
   (Section 6).
3. Capability Gateway remains authoritative for actions -- **met by
   design, unverified in practice** (Section 7's mutation-rejection gap).
4. Production topology/resume is viable -- **not met** (Section 9, the
   single clearest failure).
5. Telemetry/security can be controlled -- **partially met**, reasoning-
   redaction unverified (Section 14).
6. Version can be pinned and upgrade-gated -- **mechanically possible,
   practically hollow**: pinning against a channel shipping breaking
   changes every 1-2 days (Section 4) means either never upgrading (losing
   the reason to adopt it) or absorbing churn constantly.
7. Exit path exists -- **unverified, format stability itself in question**
   (Section 17).
8. Package maturity risk is lower than the cost of building another agent
   framework ourselves -- **not met, decisively** (Section 4's dated
   evidence is the clearest single fact in this document).

Two hard failures (4, 8) and two soft failures (5, 6, 7 partially) against
the rule's own "otherwise retain native R3" default. **Recommendation
stands as stated in Section 1: `CONTINUE_NATIVE_R3_HARNESS_PATTERN`,
`DEFER_HARNESS_ADOPTION_UNTIL_STABLE` as the temporal companion.** Re-open
this question only when the package (a) ships a `latest` dist-tag that
actually resolves the current release, (b) goes 4-6 weeks without a
breaking change to `Agent`/`Session`, or (c) reaches a stated 1.0/stability
commitment -- whichever comes first -- and re-run Section 18's two deferred
spikes before reconsidering Option B/C, not before.

## 21. Immediate next release

Design (not implement, per this task's own non-goals) R3's own cross-turn
session object, per V1.8-B section 12 Axis 2: an append-only, per-turn-
extended structure inside `runAgentToolLoop`/`salesAgentRuntime` that the
model reads incrementally from, instead of `buildAgentStepPromptPackage`
rebuilding `commercialContextSummary` from scratch every call -- modeled on
the Harness's own proven shape (append-only log + derive-on-read + bounded
compaction added only once real conversations need it), never on the
package itself. This becomes the next design task in the `SALES-AGENT-R3`
workstream (a `V1.8-C`/`V1.9` design doc, not implemented here); it does
not require, and should not wait for, any resolution of the Harness
adoption question this document closes.

## Files inspected

`experiments/deepseek-harness/package.json`,
`experiments/deepseek-harness/package-lock.json`,
`experiments/deepseek-harness/node_modules/@deepseek-ai/dsh-base/package.json`,
`docs/architecture/A13-H0-deepseek-harness-bakeoff.md`,
`docs/releases/SALES-AGENT-R3-V1.8-A-CONVERSATIONAL-CONTEXT-INPUT-AUDIT.md`,
`docs/releases/SALES-AGENT-R3-V1.8-B-HARNESS-NATIVE-SESSION-CONTINUITY-AUDIT.md`,
`lib/brain/commercial/agent-loop/agentLoopProviderTypes.ts`,
`lib/brain/commercial/commercial-action-request/types.ts`,
`docs/releases/SALES-AGENT-R3-A03-commercial-action-request.md` (cited
literal only), `.nvmrc`, `package.json`/`package-lock.json` (main repo,
grepped for `deepseek`, zero matches -- re-confirms V1.8-B), `AGENTS.md`,
`docs/ACTIVE_RELEASE.md`. External, live-checked this task:
`registry.npmjs.org/@deepseek-ai/dsh-base`,
`registry.npmjs.org/@deepseek-ai/dsh-agent`,
`github.com/deepseek-ai/deepseek-harness` (repository root and
`/releases`), all fetched 2026-09-01.

## Tests / spikes executed

None re-run and none new. This is a documentation-only decision gate per
its own non-goals; V1.8-A/B's own already-executed suites and live scenario
(`V18B-01`) are cited as standing evidence, not re-verified line-by-line
here. `npx tsc --noEmit` was not re-run because no `.ts` file was touched by
this task (only markdown). Two spikes were explicitly considered and
deliberately not executed -- see Section 18 for the reasoning.

## Files changed

New:
- `docs/releases/SALES-AGENT-R3-V1.8-C0-HARNESS-PRODUCTION-ADOPTION-REEVALUATION.md` (this file)

Modified:
- `docs/ACTIVE_RELEASE.md` (this task's entry under the `SALES-AGENT-R3`
  workstream)

No production/runtime code (`lib/`, `app/`) was created, modified, or
deleted in this task. No traffic was migrated. No Harness code was enabled
in production. `runAgentToolLoop` was not replaced. No new R3 session was
implemented. No state machine was introduced. Capability Gateway and every
business/domain store were left untouched -- all per this task's own
explicit non-goals.

## Verdict

**`R3_V1_8_C0_HARNESS_REEVALUATION_COMPLETE`**

- Primary verdict: `CONTINUE_NATIVE_R3_HARNESS_PATTERN`.
- Secondary verdict: `DEFER_HARNESS_ADOPTION_UNTIL_STABLE`.
- Exact Harness version evaluated: `@deepseek-ai/dsh@0.1.1-rc.2` (installed,
  sandboxed) against a same-day check of the public registry/GitHub state
  (`latest` dist-tag still broken at `0.0.1-rc.1`; most active channel at
  `0.1.2-alpha.4`, four releases in five days, including a confirmed break
  of the exact session-read API this repo's own prior audit depended on).
- Maturity classification: `DEVELOPER_PREVIEW` (vendor's own label,
  independently corroborated by observed API churn).
- Does not advance to `V1.8-D`/implementation. Next actionable item is a
  design task for R3's own cross-turn session object (Section 21),
  independent of this verdict.
