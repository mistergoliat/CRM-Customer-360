# SALES-AGENT-R3-V1.8.2-C2-A0 -- Customer Instruction / Unsatisfied Obligation Authority -- Forensic Audit

Status: **AUDIT ONLY**. Zero production code changed, zero prompts changed,
zero tools changed, zero schema changed, zero new workflow/intent/stage state
added. Every claim below is either (a) traced directly from the current
source tree, with file:line citations, or (b) explicitly marked
`UNVERIFIABLE_IN_THIS_ENVIRONMENT` with the concrete reason why. Nothing in
Sections 2-3, 11, 12 or 13 is answered from memory, assumption, or the task
brief's own narrative -- where the real production event/database evidence
the brief asks for could not be obtained, that gap is stated plainly instead
of being filled with a plausible-sounding fabrication.

## 0. Critical scope finding: production `conversation_id=83` is not reachable from this environment

Before any of the 19 requested sections, this fact governs how much of this
audit can be forensic-DB-verified versus code-verified only, so it is stated
first, not buried.

This repository's only reachable database is the local `main_management`
MariaDB instance (`DB_HOST=127.0.0.1`, `.env`), the same instance every prior
R3 release (`V1.8`-`V1.8.2-C1`) ran its own live benchmarks against. It was
queried directly for this audit:

```
conversation_message WHERE conversation_id = 83
  -> 2 rows: id=92 "Hola, necesito ayuda." (inbound) / id=93 "Respuesta
     wamid.concurrent-delivered-1784135444652-0422c0" (outbound)
conversation WHERE id = 83
  -> channel_account_id = "phone-concurrent-delivered-1784135444605-3afd1b",
     external_contact_id = "569835444605", created_at = 2026-07-15T17:10:44Z
```

This is a synthetic fixture row from an automated concurrency test corpus
(`wamid.concurrent-delivered-*`, `wamid.legacy-no-key-*`,
`wamid.order-forward-*`, etc. -- generic "Hola, necesito ayuda."/"Hola,
necesito ayuda con un producto." bodies repeated across thousands of
`conversation_id`s, all created within the same few seconds on 2026-07-15).
It is **not** the real dumbbell/barbell conversation described in this task's
brief. A broader search for the case's own distinctive strings (`mentira`,
`zorra`, `bacan`) across all 24,421 rows in `conversation_message` returned
zero matches. This is consistent with standing memory
([whatsapp_real_send_constraints]): the Meta webhook does not target this
local instance, so real WhatsApp production traffic has never landed in this
database's `conversation`/`conversation_message`/`agent_session_events`/
`commercial_event` tables -- only test fixtures and this session's own
directly-invoked benchmark runs (same discipline every prior R3 live
benchmark, including C1's, used and disclosed).

**Consequence**: every question in this brief that requires reading the real
`agent_session_events`/`commercial_event`/`crm_capability_executions` rows
for the actual conversation 83 (exact DeepSeek request messages per call,
exact `select_products` arguments at turns 417/420, exact
`get_product_details` product IDs at turns 425/432/434, the real
`causation_id` values behind the alleged duplicated `READ_TOOL_REQUESTED`
layer) is **`UNVERIFIABLE_IN_THIS_ENVIRONMENT`** -- not "assumed to match the
brief," not "inferred as probably true." Where this applies below, it is
marked explicitly and replaced with the strongest available substitute: a
mechanistic trace of what the actual, current code would do given the
conversation text the brief supplies verbatim, which is itself real,
citable evidence about the architecture -- just not a confirmation that this
specific trace is what happened in the specific production run. This is the
same evidentiary discipline this repository's own prior audits apply
([sales-agent-r2-a13-status], [feedback-verify-empirical-claims-before-encoding]):
never sell a mechanistic inference as a verified empirical fact.

Sections 4-10, 14, 15 (mechanism-level), 16 and 17 do not depend on this gap
-- they are architecture/code questions, fully answerable from the current
source tree, and are answered with full confidence below.

---

## 1. Core architectural question

Given the actual code (not the architecture docs), the failure is best
explained by a **combination**, but not a symmetric one: one item (H) is the
dominant, load-bearing gap; two others (C, D) are real amplifiers that make
H's consequences worse than they would otherwise be; the rest are not
supported by what the code actually does.

- **H -- lack of explicit evidence that an obligation was or was not
  satisfied: CONFIRMED, PRIMARY.** Traced in Section 9. No structure
  anywhere in this codebase represents "customer requested X" as a durable or
  ephemeral fact distinct from (a) raw transcript text and (b) current
  business state. The model must recompute the diff between "what has been
  asked for across N turns" and "what is currently true" from scratch, from
  free text, on every single provider call, with no assistance and no
  required self-check.
- **C -- stale or misleading commercialContext: CONFIRMED, SECONDARY/AMPLIFIER.**
  Traced in Section 5. `commercialContext.commercialLineItems` is a pure
  "what is true now" snapshot ([lib/domains/commercial-line-items/service.ts:127-132](../../lib/domains/commercial-line-items/service.ts)),
  never "what remains requested but absent." It is not stale in the sense of
  being wrong or out of date (it is always freshly rehydrated from
  `crm_request_facts` every turn -- [buildNativeCommercialContext.ts:340-354](../../lib/brain/commercial/context/buildNativeCommercialContext.ts)) --
  it is *silently incomplete* in a way indistinguishable, from the model's
  point of view, from being correct. This is not the same defect as D5.1-B06
  style staleness; it is the absence of a field, not a wrong value in an
  existing one.
- **D -- recentCatalogContext dominance: CONFIRMED, SECONDARY/AMPLIFIER for
  Case B specifically.** Traced in Section 6. Its eviction policy is purely
  recency/capacity-based (24h window, 5 interactions, 12 products -- never
  topic-scoped), so it can and does keep a resolved topic's product evidence
  "live" well past the point the conversation moved on, and an explicit
  prompt rule (`RECENT_CATALOG_CONTEXT_RULE_LINES`) actively instructs the
  model to re-verify anything it cites from that context via
  `get_product_details` -- a correct rule, triggered on stale-but-present
  evidence.
- **E -- pendingCatalogAction dominance/staleness: NOT SUPPORTED as a
  dominant cause, but a real, narrower gap identified.** Traced in Section 7.
  `pendingCatalogAction` only exists for `actionType: "send_product_link"`; it
  cannot represent the general pattern "the assistant asked an open question,//
  now interpret the reply as answering it" (e.g. "quieres ayuda con los
  discos compatibles o con el despacho?"). Its actual code-enforced effect is
  narrow (a single `get_product_details` authorization gate), not "authority
  over the model's topic." Its *absence* for anything other than
  `send_product_link` is itself evidence for H, not a separate cause.
- **F -- tool result semantics: PARTIALLY CONTRIBUTING, not dominant.**
  Traced in Section 8. `select_products`'s observation already returns the
  full post-mutation `items` list (never just "completed") -- this channel is
  more informative than the brief's own Section 8 worried it might be. The
  gap is not that the observation is ambiguous; it is that nothing requires
  the model to diff that returned list against the customer's actual
  cumulative ask.
- **G -- mutation result/read-model mismatch: NOT SUPPORTED.**
  `setCommercialLineItemsForOpportunity` reloads and returns the fact it just
  wrote in the same call ([service.ts:104-123](../../lib/domains/commercial-line-items/service.ts));
  there is no read-after-write staleness window in this path.
- **A/B -- model authority contract / generic runtime context construction:
  CONTRIBUTING ONLY THROUGH H, not independently.** The prompt contract is,
  if anything, unusually explicit about `select_products`'s full-replace
  semantics and about not claiming completion without evidence (Section 5's
  `SELECT_PRODUCTS_RULE_LINES`, quoted in full there) -- the contract already
  anticipates something close to this exact failure mode in words. It simply
  gives the model no structural help *computing* the value it is told to
  supply correctly.
- **I -- multiple simultaneous customer obligations not represented clearly:
  this is a restatement of H, not a separate cause.**
- **J -- interaction among the above: yes, specifically H amplified by C
  (Case A) and H amplified by D+E's narrow scope (Case B).**

## 2. Forensic Case A -- Dumbbells (conversation_id=83, turns 414-420)

Per Section 0, the real event rows for this conversation are not reachable
from this environment. The sub-questions below are answered to the extent
the current code supports a confident, mechanism-level answer; every
turn-specific number (exact arguments, exact call count) is marked
unverifiable rather than guessed.

- **What exact messages did DeepSeek receive at each provider call? /
  What did dynamic runtime context contain at each call?**
  `UNVERIFIABLE_IN_THIS_ENVIRONMENT` (Section 0). Structurally, per
  [buildAgentStepPromptPackage.ts](../../lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts)
  and [harnessAlignedMessageProjection.ts](../../lib/brain/commercial/agent-loop/harnessAlignedMessageProjection.ts)
  (SALES-AGENT-R3-V1.8.2-C1, `docs/releases/SALES-AGENT-R3-V1.8.2-C1-HARNESS-ALIGNED-MESSAGE-SEQUENCING.md`),
  each call would have included: the stable system contract; a second,
  volatile system message with `commercialContext`/`recentCatalogContext`/
  `pendingCatalogAction`/`conversationContinuity` (or, if C1's flag is off in
  production, those same fields folded into one JSON `user` mega-envelope
  per D5.2's shape); the real persistent-session transcript; and the raw
  customer text. Whether C1's flag was actually on for this real pilot
  conversation is itself unknown from this environment (C1's own doc records
  it as `IMPLEMENTED_NOT_LIVE_VALIDATED`, default off).
- **What did commercialContext say was currently selected? What did
  recentCatalogContext contain? Was there a pendingCatalogAction?**
  `UNVERIFIABLE_IN_THIS_ENVIRONMENT` for the literal values. What is
  confirmed from code: `commercialContext.commercialLineItems.items` would
  have been exactly `snapshot.commercialLineItems.items`
  ([runNativeAgentToolLoopCycle.ts:102](../../lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts)),
  i.e. whatever `select_products` last durably wrote -- nothing more, nothing
  about what was previously asked for and dropped.
- **What prior tool observations were replayed? What did `select_products`
  receive as arguments / actually persist? What fresh commercialContext was
  rebuilt after the mutation?**
  `UNVERIFIABLE_IN_THIS_ENVIRONMENT` -- this is exactly Section 11's own
  anticipated observability gap; see Section 11 below for the durable-storage
  trace confirming arguments are genuinely not recoverable after the fact for
  a real historical turn.
- **Did the model believe 25kg was already present? Did it confuse "add
  another 5" with the still-unresolved 25kg request? Did later current-state
  truth overwrite the customer's still-unresolved request cognitively?**
  Not independently verifiable from data, but **directly supported as
  plausible by two real code mechanisms**, not speculation about model
  internals:
  1. `select_products`' own governing rule instructs the model in as many
     words: *"Each select_products call must include the customer's complete
     desired selection... it replaces the entire previous selection"*
     ([buildAgentStepPromptPackage.ts:408](../../lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts)).
     If the model's own turn-by-turn reconstruction of "complete desired
     selection" silently drops 25kg (a transcript-comprehension error, not a
     tool-usage error), the **tool executes exactly as designed and
     documented** and durably overwrites 10/15/20/25 with 10/15/20 -- a
     correct capability faithfully executing an incorrect model-computed
     value. This is a full-replace-semantics amplifier of a cognition error,
     not a mutation bug.
  2. The evidence gate for `select_products`
     ([runAgentToolLoop.ts:560-577](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts))
     fails the **entire call** closed if *any* item's `(productId,
     combinationId)` was not observed within the current
     `recentCatalogContext` window (24h / last 5 catalog-tool interactions /
     12 products -- Section 6) or this turn's own tool observations. If the
     25kg product's evidence aged out of that window by turn 420 (plausible:
     turns 415/417/418/420 each may have triggered fresh `search_products`/
     `get_product_details` calls for the *other* weights, each one
     potentially evicting an older interaction from the 5-interaction cap --
     [recentCatalogContext.ts:5,297](../../lib/brain/commercial/agent-loop/recentCatalogContext.ts)),
     **any** `select_products` call that tried to include 25kg would be
     blocked outright (`status:"blocked"`, never a partial selection). Two
     live hypotheses follow with opposite implications for what the model
     "saw": either it never attempted to include 25kg (pure cognition
     failure), or it attempted to and was evidence-blocked, and then
     silently retried without disclosing the block to the customer (a
     recovery-honesty failure layered on top of the evidence-window design).
     **These are not distinguishable without the real
     `crm_capability_executions`/`agent_session_events` rows for this
     conversation** -- see Section 11.
- **Was there any explicit representation anywhere saying "25kg requested
  but not yet satisfied"?** **No.** Confirmed by exhaustive reading of
  `commercialContextSummary` ([runNativeAgentToolLoopCycle.ts:73-119](../../lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts)),
  `CommercialContextSnapshot` ([buildNativeCommercialContext.ts:87-135](../../lib/brain/commercial/context/buildNativeCommercialContext.ts)),
  `RecentCatalogContext` ([recentCatalogContext.ts:17-33](../../lib/brain/commercial/agent-loop/recentCatalogContext.ts)),
  and `PendingCatalogActionStep` ([pendingCatalogAction.ts](../../lib/brain/commercial/agent-loop/pendingCatalogAction.ts)):
  none of these types has a field for a requested-but-unsatisfied item, a
  diff, a delta, or an obligation list of any kind. This is the direct,
  literal confirmation of the brief's own central hypothesis for Case A.

**Classification**: primarily a **COGNITION ERROR** (the model's own
turn-by-turn reconstruction of "the complete desired selection," which
nothing in the system materially assists), **amplified by a MUTATION
SEMANTICS design** (full-replace, by design, per an explicit and
deliberate T13E.2 decision -- [service.ts:77-87](../../lib/domains/commercial-line-items/service.ts))
that turns a silent omission into a silent deletion, and **possibly compounded
by an AUTHORITY/CONTEXT (evidence-window) effect** whose actual role in this
specific conversation cannot be confirmed without the real event data. Not a
READ-MODEL ERROR: the durable state itself is always internally consistent
with whatever was last written.

## 3. Forensic Case B -- Bar to discs (turns 422-434)

- **What recentCatalogContext was present on 432 and 434? Did it still
  contain bar candidates only?** `UNVERIFIABLE_IN_THIS_ENVIRONMENT` for the
  literal payload. Mechanistically confirmed from
  [recentCatalogContext.ts:206-301](../../lib/brain/commercial/agent-loop/recentCatalogContext.ts):
  the window is a rolling 24-hour / 5-most-recent-catalog-interaction / 12-
  distinct-product cache with **zero topic, product-family, or semantic
  relevance filtering** -- eviction is governed purely by recency and count.
  A conversation moving from "barra olimpica" (422-430) to "discos" (432) in
  a handful of turns is very likely to still have the bar's search/detail
  interactions inside that window at 432/434, precisely because nothing in
  this function's logic treats a customer's stated topic switch as an
  invalidation signal.
- **Did pendingCatalogAction still point to a bar/link action?** Mechanically
  narrower than the brief assumes: `pendingCatalogAction` only exists for
  `actionType: "send_product_link"`
  ([pendingCatalogAction.ts:70](../../lib/brain/commercial/agent-loop/pendingCatalogAction.ts)).
  Turn 430's own response *already delivered* the bar's link in the same
  reply ("gave direct link"), and `COMMERCIAL_CLOSING_RULE_LINES` explicitly
  forbids re-offering a link once delivered this turn
  ([buildAgentStepPromptPackage.ts:328](../../lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts):
  *"Never add this closing offer when: a public link was already delivered
  or already verified this turn"*) -- so a `send_product_link` pending action
  was very likely **not** open into turn 432. The open question in turn 430
  ("¿ayuda con discos compatibles o despacho?") is a different, unrelated
  pattern this schema has **no representation for at all** -- it is not a
  product-link offer, so nothing about `pendingCatalogAction`'s design even
  attempts to carry it forward structurally.
- **Did commercialContext expose any evidence that the bar had already been
  resolved/recommended? Was the latest assistant question represented
  naturally in history?** `commercialContext` itself: no (Section 5 -- it has
  no "resolved topics" concept). History: yes, structurally -- the assistant's
  own turn-430 message (including its closing question) is part of the real
  persistent-session transcript (`historicalMessages`/`persistentSessionHistoricalMessages`),
  verbatim, per D3/D5.2/C1's own design. The mechanism exists to carry it; no
  rule tells the model to treat its own most recent open question as
  authoritative context for interpreting the next customer reply the way
  `CONVERSATION_CONTINUITY_RULE_LINES`/`PENDING_CATALOG_ACTION_RULE_LINES` do
  for their own narrower cases.
- **Did DeepSeek nevertheless prioritize catalog context over the latest
  user instruction? Did get_product_details observations reinforce the stale
  bar candidate set?** `UNVERIFIABLE_IN_THIS_ENVIRONMENT` for this specific
  run, but **directly, mechanistically explained** by an existing, correct
  prompt rule interacting with a stale-but-present evidence cache:
  `RECENT_CATALOG_CONTEXT_RULE_LINES` instructs, verbatim, *"After
  identifying a product from RecentCatalogContext, use get_product_details
  before answering with current commercial information"*
  ([buildAgentStepPromptPackage.ts:157](../../lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts)).
  If the bar remains the most recently/prominently evidenced product in
  `recentCatalogContext` at turns 432/434 (Section 6), and the model's own
  reference-resolution for an ambiguous "si" defaults to the most recent
  concrete product it has evidence for, this rule *correctly, as designed*
  drives a repeated `get_product_details` call on the bar -- not a defect in
  the rule, but the rule firing on evidence that should have already been
  irrelevant.
- **Was there any mechanism telling the model "the bar request is already
  satisfied; the newly requested unresolved object is discs"?** **No** --
  same conclusion as Case A, via a structurally different but equally absent
  mechanism: there is no "resolved topic" or "open question" representation
  anywhere in this codebase, only the narrow, single-purpose
  `pendingCatalogAction` (send_product_link only) and the recency-capped,
  topic-blind `recentCatalogContext`.

**Classification**: **STALE CANDIDATE DOMINANCE** (Section 6, confirmed
mechanism: no topic/relevance invalidation) **combined with
SATISFACTION-STATE ABSENCE** (Section 9: no "bar resolved" fact exists
anywhere to compete with the stale candidates for the model's attention).
**Not PENDING ACTION STALENESS** in the literal sense the brief poses it --
`pendingCatalogAction`'s own narrow mechanism was very likely already
correctly cleared by turn 432 (the link-delivered suppression rule); the
real gap is that nothing else exists to take its place for a
non-product-link continuity pattern. Not a **TOOL RECOVERY DEFECT** or a
**REFERENCE RESOLUTION DEFECT** in the sense of a broken mechanism -- the
mechanisms involved (recency cache, evidence gate, closing-question rule)
are each individually working as designed; the defect is in what those
correctly-functioning mechanisms are and are not being asked to represent.

## 4. Message authority layers (both cases)

Reconstructed directly from
[buildAgentStepPromptPackage.ts:686-770](../../lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts)
and [harnessAlignedMessageProjection.ts](../../lib/brain/commercial/agent-loop/harnessAlignedMessageProjection.ts)
(the exact code, not an architecture doc). Two modes coexist in this
codebase today, gated by `BRAIN_R3_HARNESS_ALIGNED_MESSAGE_MODEL_ENABLED`
(default `false` -- C1's own doc, Section 7):

**Legacy/persistent (D5.2 shape, the default today)**:
```
[0] system   stable contract + evidence/tool rules + identity (Layers 0-4)
[1..N] ...persistentSessionHistoricalMessages   real user/assistant transcript, verbatim
[N+1] user   ONE JSON envelope: { currentTime, customerMessage, commercialContext,
             recentCatalogContext, pendingCatalogAction?, conversationContinuity,
             priorStepsThisTurn, question }
```
Here, `commercialContext`/`recentCatalogContext`/`pendingCatalogAction` and
the *current* customer message are **structurally indistinguishable
fields of the same trailing JSON object** -- there is no positional signal
that the raw customer text is "the latest, most authoritative instruction";
it is simply one key among several in a flat object, with the two catalog-
evidence fields listed *before* `customerMessage` is even reached by a
naive top-to-bottom read, and *after* it alphabetically/structurally in the
literal key order shown above (`commercialContext`, `recentCatalogContext`,
`pendingCatalogAction`, then `conversationContinuity`, then, deeper still,
implicitly the customer's own message which was already given as
`customerMessage` earlier in that same object -- all four are peers).

**Harness-aligned (C1 shape, flag-gated, not yet live-validated)**:
```
[0] system    stable contract (identical text to legacy)
[1] system    "RUNTIME CONTEXT (system-provided, not authored by the customer): "
              + { currentTime, commercialContext, recentCatalogContext,
                  pendingCatalogAction?, conversationContinuity }
[2..N] ...historicalMessages
[N+1] user    <raw customer text>, unwrapped
[N+2..] assistant/user pairs   this turn's own causally-replayed tool steps
```
Here the raw customer message *is* structurally the most recent `user`
message and is explicitly unwrapped, textually isolated evidence (per C1's
own `[C1-T2]`/`[C1-T9]` tests) -- a real improvement in structural authority
for "what did the customer just say," **but C1's own Section 5 (retracted
and corrected in C1.1) already documents, from the two message shapes
directly, that this places the volatile runtime-context system message
*before* the stable historical transcript**, which is irrelevant to token
salience/authority but real for prompt-cache economics -- not this audit's
concern.

**Where commercial truth / recent catalog candidates / pending action
appear, in both modes**: always inside the *same* JSON object/message,
alongside each other, with **no explicit precedence contract between
them and the current customer message** stated anywhere in the system
instructions. `CONVERSATION_CONTINUITY_RULE_LINES` and
`PENDING_CATALOG_ACTION_RULE_LINES` each tell the model how to *use* their
own field once read, but nothing tells the model, in general, "when
`commercialContext`/`recentCatalogContext` and the customer's current or
recent message disagree about what is wanted, the customer's stated words
win." That is the authority-contract gap this task's own Section 20 forbids
solving with a hardcoded rule (`"latest input always wins"`) -- correctly
so, since such a rule would be wrong whenever the customer's words are
themselves stale relative to durable commercial truth (e.g. asking about a
price after already confirming payment). The right fix is not "which source
wins" but "what does the customer still want that isn't true yet," i.e.
Section 9's gap again -- resolving *that* makes a hardcoded precedence rule
unnecessary rather than needed.

## 5. commercialContext audit

Exact fields the model receives every turn
([runNativeAgentToolLoopCycle.ts:73-119](../../lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts)):

```
opportunityStatus, opportunityStage,
needProfile: { useCase, budgetMax, requiredFeatures } | null,
shippingDestination: { communeId, canonicalName } | null,
commercialLineItems: { items: [{ productId, combinationId, quantity }] } | null,
recentMessages: last 5, { direction, body } only, excluding this turn's own inbound,
(+ customerPurchaseHistory / customerRfm / customerHistoryCommercialSignals when available)
```

`commercialLineItems` is sourced from
`getActiveCommercialLineItemsForOpportunity` -> `crm_request_facts`
([lib/domains/commercial-line-items/service.ts:127-132](../../lib/domains/commercial-line-items/service.ts)),
which is explicitly documented, by the engineers who built it, as a
**full-replacement durable fact**, never a delta log: *"Each call REPLACES
the entire active selection (full replacement, not a delta/merge across
calls)"* ([service.ts:79-82](../../lib/domains/commercial-line-items/service.ts)).

**Critical question answered directly: yes.** `commercialContext` only ever
represents "what is true now." There is no field anywhere in
`CommercialContextSnapshot`
([buildNativeCommercialContext.ts:87-135](../../lib/brain/commercial/context/buildNativeCommercialContext.ts)),
`buildCommercialContextSummary`
([runNativeAgentToolLoopCycle.ts:73-119](../../lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts)),
or the legacy shadow-path equivalent
([lib/brain/commercial/context/buildCommercialContext.ts](../../lib/brain/commercial/context/buildCommercialContext.ts))
for "what the customer has asked for that is not yet reflected here." The
worked example in the brief (`selected=[10,15,20]`, transcript says "what
about 25") is exactly this codebase's real shape today -- not a hypothetical.
This is an **architectural gap**, documented here, not fixed here.

One partial mitigating mechanism exists and deserves to be named precisely,
so it is not overlooked in a future fix: `SELECT_PRODUCTS_RULE_LINES`
already tells the model, in the strongest terms this codebase uses anywhere
in this prompt, not to claim a selection is done without fresh evidence
(*"Understanding what the customer wants is not the same as it being done"* --
[buildAgentStepPromptPackage.ts:425](../../lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts)).
This governs what the model may **say**, not what it correctly **computes**
as the target selection to submit -- it prevents a specific class of
over-claiming, but does not help the model get the underlying arithmetic
right in the first place. The prompt engineering here is already
unusually rigorous for the failure mode this audit was commissioned to
explain; the gap is structural (missing evidence), not a missing warning.

## 6. recentCatalogContext audit

Full lifecycle traced from
[recentCatalogContext.ts](../../lib/brain/commercial/agent-loop/recentCatalogContext.ts):

- **Created**: fresh, once per turn, by a live SQL query over
  `crm_capability_executions` ([loadExecutionQuery, lines 166-220]) --
  never persisted as its own row; it is a read-time reconstruction from the
  Capability Gateway's own execution log.
- **Scope**: last 24 hours (`RECENT_CATALOG_CONTEXT_WINDOW_HOURS = 24`), at
  most the 5 most recent completed `search_products`/`get_product_details`/
  `explore_catalog`/`recommend_catalog_products` executions
  (`RECENT_CATALOG_CONTEXT_MAX_INTERACTIONS = 5`), capped at 12 distinct
  `(productId, combinationId)` pairs total across those interactions
  (`RECENT_CATALOG_CONTEXT_MAX_PRODUCTS = 12`).
- **Invalidated/filtered**: **purely by recency and count, iterating
  `completed_at DESC`** ([buildExecutionQuery, lines 166-204]) -- the first
  (most recent) occurrence of a given product wins the dedup slot
  ([productDedupeKey, lines 106-108], [dedup loop, lines 271-280]); once 5
  interactions or 12 products accumulate, older interactions are dropped
  from the array entirely (`break` at line 297). **There is no query
  predicate, filter, or post-processing step anywhere in this file that
  considers product category, topic, or conversational relevance.**
- **Loaded into each provider call**: once per turn (cycle setup --
  [runNativeAutonomousCycle.ts:505,666](../../lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts)),
  the same value reused across every provider call and every tool
  authorization check within that turn.

**Answered directly: it behaves like an evidence cache with a
non-semantic (recency/count only) invalidation policy, and it can and does
function as latent current-topic state whenever the conversation moves
faster than its 5-interaction/24-hour window empties out.** For the bar/disc
case, whether bar candidates "survived the topic transition" cannot be
confirmed for the real conversation (Section 0), but the mechanism has no
safeguard against it happening, and an explicit, correctly-functioning
prompt rule (`RECENT_CATALOG_CONTEXT_RULE_LINES`) actively re-surfaces
whatever is inside it. This is documented as the architectural gap it is;
no semantic topic-invalidation logic is proposed or implemented here, per
this task's explicit Section 6/10 boundary.

## 7. pendingCatalogAction audit

Full lifecycle traced from
[pendingCatalogAction.ts](../../lib/brain/commercial/agent-loop/pendingCatalogAction.ts):

- **Creation**: two paths only. (1) The model's own `respond` step includes
  `pendingCatalogAction: {actionType:"send_product_link", candidateProductIds}`
  when its closing question offers to send a link
  (`PENDING_CATALOG_ACTION_RULE_LINES`, rule 6). (2) Automatically derived
  from a completed `recommend_catalog_products` observation's own candidates
  (`buildPendingCatalogActionFromRecommendation`, lines 112-134). **No other
  actionType exists in the type system** -- `parsePendingCatalogAction`
  (line 70) hard-rejects anything but `"send_product_link"`.
- **Persistence**: embedded inside the `agent_tool_loop_completed`
  `commercial_event` payload for that turn (not a dedicated table/row).
- **Consumption/invalidation**: `loadPendingCatalogAction`
  (lines 275-300) always reads **only the single most recent**
  `agent_tool_loop_completed` event for the conversation -- by construction,
  this is always exactly the immediately preceding assistant turn. A pending
  action from any older turn structurally cannot resurface: the very next
  turn's own completion event (whether it renews, replaces, or omits the
  field) is what this query returns instead. This is a genuinely sound,
  self-cleaning design for its one supported action type.
- **Successful completion**: the model resolves the reference, calls
  `get_product_details`, delivers the link, and omits `pendingCatalogAction`
  from that turn's own `respond` step -- the next turn's lookback then finds
  nothing (rule 2/3 in `PENDING_CATALOG_ACTION_RULE_LINES`).
- **Cross-turn carryover**: exactly one turn of lookback, never more, by
  construction (comment at lines 260-274 makes this an explicit, deliberate
  design decision, not an oversight).

**Classification for turns 432/434, to the extent code (not data) can
determine it**: **CONSUMED, most likely** -- turn 430's own response already
delivered the bar's link in the same reply, and the closing-question rule
that governs whether a NEW `send_product_link` offer gets attached to that
turn's `respond` step explicitly forbids re-offering an already-delivered
link. The narrower, more accurate finding is not that a stale
`pendingCatalogAction` anchored the model to the bar -- it is that
**`pendingCatalogAction`'s type system has no `actionType` for "I asked
whether to continue with X or Y" at all**, so even a perfectly-designed,
self-cleaning mechanism for one specific pattern (product-link offers)
provides zero carryover for the actual pattern this conversation needed
(an open branching question about what to do next). This is the same root
absence as Section 9, expressed through a schema boundary instead of a
missing field.

## 8. Tool observation authority

Traced from
[buildToolObservation.ts](../../lib/brain/commercial/agent-loop/buildToolObservation.ts)
and [selectProductsCapability.ts](../../lib/brain/commercial/capability-gateway/selectProductsCapability.ts).

- **`select_products`**: `projectSelectProducts` (line 103-105) passes the
  capability's own `data` through unmodified: `{status:"selected",
  items: result.selection.items, changed: boolean}`
  ([selectProductsCapability.ts:93-99](../../lib/brain/commercial/capability-gateway/selectProductsCapability.ts)).
  **The observation already returns the final, complete, freshly-reloaded
  selected set** (`result.selection.items` comes from
  `setCommercialLineItemsForOpportunity`'s own post-write reload, never the
  caller-supplied input echoed back) -- not merely a generic "completed"
  status, and not ambiguous about what changed at the state level. It does
  **not** additionally state "changed FROM [...] TO [...]" (only a boolean
  `changed`), and it says nothing about whether this new state satisfies
  everything the customer has asked for across the conversation -- but the
  brief's Section 8 concern that this observation might leave "ambiguity
  about what was actually satisfied" at the state level specifically is
  **not supported**: the model that issued the call has, in its own next
  message, complete visibility into exactly what is now selected. Whatever
  goes wrong here happens *after* this observation is received, not because
  of what the observation contains.
- **`get_product_details`**: `projectProductDetails` (lines 34-57) returns a
  single product's full detail every time it is called, with no memory of
  whether this exact productId was already inspected earlier in the
  conversation and nothing new was learned. Each repeated call is, from the
  model's point of view, indistinguishable from a first-time inspection --
  there is no "you already saw this" signal. Combined with
  `RECENT_CATALOG_CONTEXT_RULE_LINES`'s mandate to re-verify via
  `get_product_details` before answering with current information, this
  makes repeated inspection of an already-fully-known, already-resolved
  product a structurally *encouraged* behavior whenever that product is
  still sitting in `recentCatalogContext`, exactly as seen in Case B.
  **Confirmed**: the model is fed fresh evidence with no notion of whether
  that evidence advances a still-open request or merely re-confirms an
  already-closed one -- because "already closed" is not a concept this
  system represents (Section 9).

## 9. Satisfaction evidence audit

**Direct answer: no such relation exists anywhere in this codebase.**
Exhaustively checked:

- `CommercialContextSnapshot`/`commercialContextSummary` (Section 5): only
  current state.
- `RecentCatalogContext`/`PendingCatalogActionStep` (Sections 6-7): only
  recent evidence/one narrow deferred action.
- `AgentLoopStepRecord`/`ToolObservation` (`agentStepTypes.ts`): scoped to
  "this turn's own steps," explicitly documented as never cross-turn state
  (`AgentLoopPromptInput.priorSteps` comment, "This turn's own prior
  steps/observations only - never cross-turn state" --
  [buildAgentStepPromptPackage.ts:65-66](../../lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts)).
- `ConversationContinuitySignal` (Section on continuity above): three
  booleans about whether *any* prior turns exist at all -- nothing about
  *what* was asked or resolved in them.
- The persistent-session transcript itself: real, verbatim, and the one
  place "customer requested X" genuinely lives -- but as unstructured prose
  the model must re-parse from scratch every call, with no computed,
  reusable relation to commercial truth.

This confirms, exactly as the brief's own working hypothesis states: **R3
knows transcript truth. R3 knows commercial truth. R3 does not explicitly
know the relation between the two.** This is not a hedge or a
partially-supported claim -- it is a literal, exhaustively-checked absence
across every type this loop's prompt-building code touches.

## 10. Rejected default solutions -- compliance check

This audit proposes none of the following, and none of the evidence above
supports them as the *minimal* fix even if they were in scope:
`currentIntent`, `conversationStage`, `activeTopic`, `nextStep`, an intent
stack, a dialogue state machine, a workflow graph, a hardcoded "latest input
always wins" rule, product-specific rules, or regex-derived obligations. In
particular, Section 4 explicitly rejects "latest input wins" as *wrong on
its own terms* (not merely out of scope) whenever durable commercial truth
is more current than what the customer just said. The gap identified in
Section 9 is a missing **evidence relation**, not a missing **decision
procedure** -- the model still decides what to do with that evidence; this
audit does not propose deciding for it.

## 11. `select_products` arguments -- observability trace

Traced end to end through the actual write path:
`selectProductsCapability.execute`
([selectProductsCapability.ts:76-107](../../lib/brain/commercial/capability-gateway/selectProductsCapability.ts))
-> `setCommercialLineItemsForOpportunity`
([service.ts:88-124](../../lib/domains/commercial-line-items/service.ts))
-> `upsertRequestFact` (persists `{items}` into `crm_request_facts.value_json`,
keyed by `factId`, **overwriting** the previous fact row's *value*, not
appending a new row -- confirmed by `getActiveRequestFact`/`upsertRequestFact`
being a single active-fact-per-key read/write pair, not an append-only log,
per the T13D/T13E.2 pattern this file documents itself against for
`shippingDestination`).

**What this means for historical forensics, confirmed directly, not
inferred**: once a later turn overwrites `crm_request_facts` for this
`(opportunityId, COMMERCIAL_LINE_ITEMS_FACT_KEY)` pair, the *previous*
value -- e.g. exactly the arguments/result of turn 417's `select_products`
call -- is gone from the durable read path `getActiveCommercialLineItemsForOpportunity`
reads. The only place the *arguments* of a specific historical
`select_products` call could survive is `crm_capability_executions`
(the Capability Gateway's own execution log, the same table
`recentCatalogContext.ts` reads from for catalog tools) -- **if** its
request/response columns capture the tool's input arguments and not only
`response_summary_json`. This audit did not have real event rows for
conversation 83 to confirm one way or the other (Section 0), and the task
brief's own framing already anticipates this: *"The current
agent_session_events intentionally omit full mutation arguments."*

**Classification, per the brief's own Section 11 instruction: this is a
genuine, confirmed observability gap for cross-turn forensic replay of a
mutating call's exact arguments**, distinct from (and narrower than) the
commercial-line-items domain's own within-turn observability, which is
good (Section 8 -- the *result* state is always fully visible to the model
in the very next message). What is missing is not "does the model know what
it just selected" (it does) but "can a human/auditor later reconstruct
exactly what arguments a specific historical mutating call received," which
is a different, legitimate, and separate need this audit surfaces but does
not attempt to close (Section 20 -- no logging added in this audit).

## 12. Duplicated read-event layers

Traced through the single production call site,
[executeReadTool.ts:83-149](../../lib/brain/commercial/read-tool-request/executeReadTool.ts),
and its one request-builder,
[atlAdapter.ts:29-46](../../lib/brain/commercial/read-tool-request/executeReadTool.ts):

- `recordReadToolRequested` is called **exactly once per real, physical
  `executeReadTool` invocation** ([executeReadTool.ts:86](../../lib/brain/commercial/read-tool-request/executeReadTool.ts)),
  writing one `READ_TOOL_REQUESTED` row to `agent_session_events` with
  payload `{tool, opportunityId}` only -- **no `phase` field exists in this
  payload shape** ([sessionEvents.ts:50-52](../../lib/brain/commercial/read-tool-request/sessionEvents.ts)).
  `causationId` is set unconditionally to `input.inboundMessageId`
  ([atlAdapter.ts:33](../../lib/brain/commercial/read-tool-request/atlAdapter.ts)) --
  **the same value for every `use_tool` step within one turn**, never a
  synthetic per-step "event id."
- This means the brief's own illustrative example (a row keyed
  `causation_id=<inbound>` followed by a second row keyed
  `phase=gathering/causation_id=<event>`) **does not match the shape this
  call site actually produces** -- there is one, and only one, event-
  recording path for a real `READ_TOOL_REQUESTED`, and it never carries a
  `phase` field or a non-inbound `causationId`. Two genuinely distinct rows
  with the *same* `causationId` (same turn) and *different* tool
  arguments (e.g. two different `get_product_details` calls for two
  different products in one turn) are two real, distinct executions, not a
  duplicated observation of one. Two rows across *different* turns
  (e.g. 425 and 432) necessarily have *different* `causationId` values
  (different inbound message ids) by construction -- also two real,
  distinct executions.
- A second, structurally different observability channel does exist and
  should not be confused with the one above: `agent_tool_loop_completed`
  `commercial_event` rows persist a per-turn summary of that turn's own
  steps (`AgentLoopStepSummary`-shaped, via
  `recordAgentToolLoopCompletedCommercialEvent`), one row per **turn**, not
  per tool call. This is the Capability-Gateway-level log
  (`crm_capability_executions`, one row per real HTTP/DB execution) versus
  the cognitive-loop-level log (one `commercial_event` row per completed
  turn, summarizing all of that turn's steps) the brief itself anticipated
  as a possible explanation in its own framing.

**Conclusion**: this audit could not reproduce, from code, the exact
duplicated-event shape the brief describes with a `phase=gathering` field on
a `READ_TOOL_REQUESTED` row -- that literal shape is not what
`sessionEvents.ts`/`atlAdapter.ts` produce today. What IS confirmed is that
this system genuinely has two distinct, correctly-separated observability
layers at different granularities (per-execution vs. per-turn), which is a
legitimate, non-duplicative design, not evidence of double-counted side
effects. Without the real rows for conversation 83, this audit cannot say
whether production genuinely differs from what this source tree implies (a
schema drift somewhere not found by this trace) or whether the brief's own
example was illustrative shorthand rather than a literal field-for-field
quote. Marked `UNVERIFIABLE_IN_THIS_ENVIRONMENT` for the literal claim;
**not** unverifiable for the underlying question ("are there two physical
executions or one observed twice") -- the code supports only the
two-distinct-executions interpretation, never a double-observation of one.

## 13. Bar loop / `get_product_details` repetition -- classification

`UNVERIFIABLE_IN_THIS_ENVIRONMENT` for the literal product-ID sequence at
turns 425/432/434 (Section 0). The mechanistically supported classification,
given the confirmed code above, is:

- **Within a single turn**: the existing duplicate-call dedupe guard
  (`executedCalls`/`buildDedupeKey`, [runAgentToolLoop.ts:513,520-523](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts))
  already blocks an *identical* repeated tool+arguments call within the same
  turn (`blocked_duplicate` governance) -- confirmed independently by C1.1's
  own live benchmark observing this exact guard reject repeat
  `search_products` calls with identical arguments
  (`docs/releases/SALES-AGENT-R3-V1.8.2-C1-HARNESS-ALIGNED-MESSAGE-SEQUENCING.md`,
  Section 16.2). **WITHIN_TURN_LOOP on the identical arguments is already
  structurally prevented**, so a same-turn repetition, if real, would have
  to be against a *different* candidate (e.g. a different combinationId of
  the same bar) -- not the flat A,A,A,A,A pattern the brief poses as one
  option.
- **Across turns (425 -> 432 -> 434)**: nothing in this codebase dedupes or
  remembers a tool call across turn boundaries -- `executedCalls` is a
  fresh, turn-scoped `Set` ([runAgentToolLoop.ts's gathering-phase local
  state]), and `recentCatalogContext`/evidence gates only ever gate
  *authorization* to call a tool, never *whether it is redundant given what
  was already learned*. **CROSS_TURN_REINSPECTION is the classification the
  code supports**: each turn's own tool loop has no memory that a
  structurally identical `get_product_details` call already ran in a prior
  turn and returned the same answer.
- **Why the next turn repeats the inspection**: `RECENT_CATALOG_CONTEXT_RULE_LINES`
  (Section 6/8) actively instructs re-verification via `get_product_details`
  whenever a product is referenced from `recentCatalogContext` -- a
  correct rule for a genuinely new reference, but with **NO_PROGRESS
  DETECTION** for a reference to a product the conversation already fully
  resolved in a prior turn. There is no "already answered this" flag on a
  product-in-context the way there is, narrowly, for a delivered
  `pendingCatalogAction` link.

**Classification: CROSS_TURN_REINSPECTION, driven by NO_PROGRESS_DETECTION_GAP**
-- not a within-turn loop (already guarded), not stale-candidate replay in
the sense of re-showing wrong data (the data would still be correct), but a
correctly-designed re-verification rule with no signal that this particular
re-verification is unnecessary because the conversation has already moved
past it.

## 14. Authority matrix

| Source | Truth represented | Freshness | Persistence | Current authority | Failure risk |
|---|---|---|---|---|---|
| raw current user (harness-aligned mode) | latest instruction | freshest | durable transcript, isolated as its own `user` message | Structurally salient (own message), but no stated precedence over commercialContext/recentCatalogContext when they conflict | Low on its own; risk only appears where nothing lets it override stale evidence |
| raw current user (legacy/persistent mode, default today) | latest instruction | freshest | durable transcript, but folded as one field in a flat JSON envelope alongside commercialContext/recentCatalogContext | No structural salience advantage over its sibling fields | Higher: positionally and structurally a peer of the very fields that can be stale |
| persistent-session history | full conversational history | append-only, real | durable, verbatim | High in principle (the actual place "customer asked for 25kg" lives) | Requires the model to re-derive the current obligation set from raw text every call, unaided -- Section 9's core gap |
| commercialContext | current business truth only | always fresh (rehydrated every turn from durable facts) | derived, real-time | High, and explicitly instructed to be trusted (reuse-silently rules) | Silently incomplete: cannot represent "not yet true," so its very freshness can read as completeness |
| recentCatalogContext | recent catalog-tool evidence | recency/count-windowed (24h / 5 interactions / 12 products), never topic-scoped | derived from durable `crm_capability_executions`, re-queried fresh each turn | Actively re-invoked by an explicit, correct prompt rule | Can outlive the conversational relevance of what it holds |
| pendingCatalogAction | one narrow deferred action (`send_product_link` only) | one-turn lookback only, self-cleaning | embedded in durable `commercial_event` payload | Narrow but sound within its scope | None of its own; its risk is entirely its *absence* for every other continuity pattern |
| tool observations (this turn) | this turn's own evidence | freshest possible | ephemeral (turn-scoped in the loop; the underlying execution is durably logged) | High for what just happened | No memory of whether this evidence duplicates an already-resolved prior turn |
| assistant history (own prior messages) | prior commitments/open questions | durable, verbatim | durable | Present but structurally unprivileged -- no rule elevates "your own last open question" the way `pendingCatalogAction`'s narrow case does | The generalized version of Case B's gap |

**Is there an explicit precedence contract among these sources? No.** The
system instructions govern *how to use* each field once read
(`CONVERSATION_CONTINUITY_RULE_LINES`, `PENDING_CATALOG_ACTION_RULE_LINES`,
`RECENT_CATALOG_CONTEXT_RULE_LINES`, `SELECT_PRODUCTS_RULE_LINES`), but no
line anywhere states what to do when two of these sources disagree about
what the customer currently wants. As Section 4 argues, the correct fix for
this is not a precedence rule (which would be wrong in the cases where
durable commercial truth is more current than the customer's own recent
words) but closing the Section 9 evidence gap, which would make most such
conflicts self-resolving.

## 15. Root-cause classification

**DUMBBELL 25KG FAILURE**
- PRIMARY: absence of an explicit requested-vs-satisfied evidence relation
  (Section 9), interacting with `select_products`' deliberate full-replace
  mutation semantics (Section 5/11) -- a cognition gap that a design
  decision elsewhere (full replacement, made for good, documented reasons
  unrelated to this failure) turns into a durable data loss instead of a
  harmless no-op.
- SECONDARY: the `recentCatalogContext` evidence window's recency/count
  eviction (Section 6) may (unverifiable for this exact conversation, but
  mechanistically real) have evidence-blocked a later attempt to re-include
  25kg, producing either a silent non-attempt or a silently-abandoned retry
  -- itself a symptom of the same missing evidence relation, since a
  requested-but-unsatisfied representation would make such a block
  recoverable and disclosable instead of silent.
- NOT CAUSAL: mutation result/read-model mismatch (disproven, Section 8/11);
  duplicated observability (not this case's mechanism); a broken evidence
  gate (working exactly as designed); model authority/prompt-contract gaps
  in the sense of "the model was never told to be careful" (disproven --
  Section 5 quotes rules that already anticipate exactly this failure mode
  in words).

**BAR->DISC FAILURE**
- PRIMARY: absence of any structured representation for "the assistant's
  own immediately preceding open question has been answered" outside the
  single narrow case `pendingCatalogAction` already covers
  (`send_product_link`) -- the general form of Section 9's gap.
- SECONDARY: `recentCatalogContext`'s non-semantic, recency/count-only
  eviction policy (Section 6) keeping bar evidence available and
  structurally salient past the point of conversational relevance, actively
  re-triggered by a correct-but-topic-blind prompt rule
  (`RECENT_CATALOG_CONTEXT_RULE_LINES`).
- NOT CAUSAL: `pendingCatalogAction` staleness in the literal sense (Section 7
  argues it was most likely already correctly cleared by the link-delivered
  suppression rule); a broken get_product_details tool (it worked correctly
  every time it was called; the defect is in when it was called again); a
  tool recovery defect (no tool failure was reported in this case's
  narrative).

## 16. Architectural conclusion

R3 lacks **(C) explicit request<->effect satisfaction evidence**, primarily.
This is the one gap, of the six listed in the brief's own Section 16, that
is exhaustively confirmed absent across every relevant type in this codebase
(Section 9) and that both forensic cases trace back to as their PRIMARY
cause (Section 15) -- not merely a contributing factor among equals.

Two of the others are real, but strictly secondary/amplifying, never
independently sufficient to explain either case on their own:
**(D) catalog-context invalidation/relevance discipline** is genuinely
missing (Section 6), but only manifests as a customer-visible failure
*because* (C) is missing -- if the model had a live, resolved-vs-open
obligation ledger, a stale-but-present bar candidate in `recentCatalogContext`
would not by itself cause it to re-litigate an already-closed topic. And the
brief's **(A) better prompt authority contract** is, per Section 5's direct
quotation of `SELECT_PRODUCTS_RULE_LINES`, already unusually rigorous for
exactly this failure class -- more prompt engineering in the same direction
is not the missing ingredient; a structural evidence source for the prompt
to *reference* is.

- **MINIMAL FIX** (not implemented here, per this task's AUDIT ONLY
  constraint): none proposed -- any concrete design (even a minimal one)
  for representing requested-vs-satisfied obligations is itself the next
  release's design work, not something this audit should pre-empt by
  sketching a specific shape. What this audit does establish is the
  *constraint* such a design must satisfy: additive evidence the model can
  read and reference, never a workflow/stage/intent field it is driven by.
- **ARCHITECTURAL FIX**: same as above, at a larger scope if the same gap
  is found to recur outside catalog/product-selection flows (shipping,
  quotes) once C2's own follow-on work investigates them.
- **OPTIONAL HARDENING**: a `get_product_details`/`recentCatalogContext`
  "already resolved in a prior turn" signal (Section 13) would reduce
  cross-turn re-inspection without touching obligation tracking directly --
  genuinely optional, since it would not, by itself, fix either forensic
  case's PRIMARY cause.

## 17. Testable hypotheses for C2

**H1.** If the model is given explicit, structured evidence that a specific,
previously-requested item (e.g. 25kg) is absent from `commercialContext.commercialLineItems`,
it will correctly include that item in its next `select_products` call,
without needing to re-derive that absence itself from free-text history.

**H2.** If a `select_products` evidence-gate block (Section 2, mechanism 2)
is disclosed to the model as a structured observation distinct from a
silent no-op, cross-turn item loss following a blocked-then-abandoned retry
decreases, and/or the model's own response to the customer stops implying a
selection succeeded when it did not.

**H3.** If `recentCatalogContext` candidates carry an explicit
"already-answered" or "topic-closed" marker once the customer's own
follow-up message has moved to a different product/topic, repeated
`get_product_details` calls on an already-resolved product (Section 13)
decrease without needing semantic topic classification -- a purely
mechanical marker (e.g. "this candidate's assistant-visible resolution was
already delivered") may be sufficient, never a `currentIntent`/`activeTopic`
field.

**H4.** If the assistant's own immediately preceding open
question is represented structurally (not merely present in free-text
history) the way `pendingCatalogAction` already does for `send_product_link`
offers, a plain confirmatory reply ("si", "si con los discos") is
correctly bound to that question rather than re-triggering catalog
evidence for the previously-resolved topic.

**H5.** If `select_products`' observation explicitly states the delta
(`added`/`removed`/`unchanged` relative to the pre-call selection) rather
than only the resulting full list, the model's own narration to the
customer more reliably matches what was actually persisted, independent of
whether the underlying cognition error that produced the wrong call is also
fixed.

Each hypothesis maps to an isolated, falsifiable experiment (a controlled
live-DeepSeek A/B on the exact scenario it targets, following the same
methodology C1/C1.1 already established for this codebase) and none of them
requires `currentIntent`, `conversationStage`, or any workflow-state
addition to test.

## 18. Documentation

Created:
- This file.
- `docs/ACTIVE_RELEASE.md` updated in the same change (pointer only, per
  `AGENTS.md`'s mandatory workflow) -- see the `SALES-AGENT-R3` workstream
  section.

No production code, prompt, tool, or schema file was changed by this task.

## 19. Final verdict

**`R3_C2_NO_SINGLE_PRIMARY_CAUSE`**

Justification for choosing this over `R3_C2_AUTHORITY_GAP_CONFIRMED`: the
gap confirmed in Section 9 is not a *model authority* gap (the model is not
under-empowered to act, nor is the prompt contract silent on how to behave
-- Section 5 shows the opposite, an unusually explicit contract) and it is
not reducible to any single one of the five other named categories
(context staleness, tool recovery, mutation state) in isolation. Both
forensic cases (Section 15) show the **same missing evidence category**
(request<->satisfaction) acting as PRIMARY cause, but each case reaches
customer-visible failure only through a **different, real, secondary
amplifier** specific to that case's own subsystem (full-replace mutation
semantics for dumbbells; non-semantic catalog-context eviction for the
bar/discs). A verdict of `R3_C2_CONTEXT_STALENESS_PRIMARY` would overstate
Case A's mechanism and understate that Case B's own `pendingCatalogAction`
was most likely already correctly cleared (Section 7) -- it was the
*absence* of an equivalent mechanism for open-ended questions, not staleness
of an existing one, that mattered there. The honest verdict is that one
underlying gap (Section 9) is confirmed and dominant, but its two
observed failure surfaces are not identical mechanisms, and calling either
subsystem-specific label "the" primary cause would misdirect where C2's
next design work should look for a general -- not case-specific -- fix.
