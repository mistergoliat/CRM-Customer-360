# SALES-AGENT-R3-V1.8.2-C2-A0.1 -- Production Evidence Reconciliation + DeepSeek Harness Alignment Check

Status: **AUDIT / RECONCILIATION ONLY**. Zero production code, prompts,
tools, or schema changed. This task reconciles
[SALES-AGENT-R3-V1.8.2-C2-A0](SALES-AGENT-R3-V1.8.2-C2-A0-CUSTOMER-INSTRUCTION-UNSATISFIED-OBLIGATION-AUDIT.md)
against real production event evidence for `conversation_id=83`, supplied
directly by the user from the EC2 MariaDB instance behind the live pilot.
That evidence is treated as authoritative and is not re-disputed, per the
task's own instruction. Everything below is either (a) a direct restatement
of the supplied production evidence, (b) a direct trace of the current
source tree against that evidence with file:line citations, or (c) marked
`STILL UNVERIFIED` where even this new evidence does not settle a question
A0 raised. Nothing is inferred about model internals beyond what the
observable inputs/outputs and the code's own deterministic logic support.

---

## 1. Production evidence reconciliation -- Case A (dumbbells)

### 1.1 What A0 got right, now confirmed

- Settlement/assimilation mechanics work exactly as A0's read of
  `runAgentToolLoop.ts`/turn-settlement code predicted: 415 correctly
  assimilated into 414, 418 correctly assimilated into 417, both turns
  reaching `COMPLETED` normally. No settlement or assimilation defect is
  implicated in this failure at all -- confirmed, not merely assumed.
- `select_products` executed and completed successfully both times it was
  called (turn 417: `resultStatus=COMPLETED`, `gatewayStatus=completed`,
  `stableErrorCode=null`; turn 420: `resultStatus=COMPLETED`). The capability
  itself never failed, was never denied, and was never blocked in either
  call this log shows. This directly confirms A0 Section 15's "NOT CAUSAL:
  ... a broken evidence gate (working exactly as designed)" -- the gate did
  not visibly reject anything in this log.
- `commercialLineItems`' full-replace mutation semantics (A0 Section 5/11)
  remain the correct explanation for *why* an incomplete `items` array
  silently deletes 25kg rather than merely failing to add it -- nothing in
  this evidence contradicts that; the capability did exactly what its own
  documented contract says it does.

### 1.2 What this evidence newly settles that A0 could not

**Real catalog evidence was gathered before the failing turn-417 selection,
and it still failed.** Turn 417 shows 5 real `search_products` request/
completed pairs and 5 real `get_product_details` request/completed pairs
(seq 641-660, `causation_id=417`) *before* the `select_products` call
(seq 661-663). This is a materially different picture than A0's Section 2
could offer without data: A0 could only pose "did the model never attempt to
include 25kg" versus "was 25kg evidence-blocked" as two *equally open*
hypotheses. Now: a turn that ran 5 distinct search/detail pairs (plausibly
one per distinct weight under discussion -- 5/10/15/20/25, though the exact
productIds are `STILL UNVERIFIED`, see Section 1.4) had every structural
opportunity to gather fresh evidence for 25kg specifically, immediately
before the `select_products` call that then omitted it. This shifts the
weight of evidence away from A0's H2 (evidence-window eviction blocking a
25kg attempt) and toward H1 (a pure reconstruction/binding error: the model
had the evidence available and still did not carry it into the `items`
array) -- **not because H2 is disproven** (a `blocked` observation could
still have occurred on an attempt not shown in this log excerpt), but
because the alternative, simpler explanation now has direct, positive
support it did not have in A0: evidence-gathering activity happened and
still did not produce a correct outcome.

**Turn 420 is the more decisive piece of evidence.** It shows *zero*
`search_products`/`get_product_details` calls before its own
`select_products` attempt (seq 692-694: `COMMERCIAL_ACTION_REQUESTED` ->
`ACCEPTED` -> `COMPLETED`, directly, no read-tool activity at all this turn).
The customer's message ("vas a agregar las 25 o no") names exactly one
thing. The resulting confirmed state ("2 pares de mancuernas de 5 kg, 1 par
de 10 kg, 1 par de 15 kg y 1 par de 20 kg") shows a *second* 5kg unit added
-- an item the customer did not ask about in this turn -- while 25kg, the
one item explicitly named, remains absent. **This is not explainable as an
evidence-availability problem**: nothing was blocked from being added,
since something (an extra 5kg unit) *was* added. This is direct,
observable evidence of a **request<->effect binding error**: whatever
internal reconstruction produced the `items` array for this call, it bound
the customer's explicit reference to the wrong target quantity/product
rather than either (a) correctly adding 25kg or (b) correctly leaving the
selection unchanged and truthfully reporting that 25kg still could not be
confirmed. This is new, stronger, and more specific than anything A0 could
establish from architecture alone.

**The `calculate_shipping` failure is confirmed real and unrelated to the
selection bug.** Both turns show `calculate_shipping` failing with
`stableErrorCode="catalog_response_mismatch"` -- a genuine backend/catalog
data problem, not a symptom of the request/satisfaction gap. Notably, the
assistant's actual responses for both turns 417 and 420 make **no shipping
claim at all** -- consistent with `CALCULATE_SHIPPING_RULE_LINES` (A0
Section 5, quoted there) correctly preventing the model from fabricating a
shipping result it never received. **The model's evidence discipline
worked correctly for shipping and failed only for the selection-items
content** -- an important, precise distinction this evidence newly
establishes: this is not a general "the model ignores tool evidence"
defect, it is specific to reconstructing the *cumulative, multi-turn*
target list for `select_products`.

### 1.3 Corrected classification

| Category | Verdict | Basis |
|---|---|---|
| Cognition error (reconstructing the complete desired selection) | **PRIMARY, now empirically supported** | Turn 417 had fresh 5+5 evidence and still omitted 25kg; turn 420 added an unrequested 5kg instead of the explicitly requested 25kg with zero fresh evidence gathering, i.e. working from whatever it already believed the state should be |
| Capability execution (select_products, calculate_shipping) | **NOT CAUSAL** | Both executed exactly as designed; select_products completed successfully both times; calculate_shipping failed for an unrelated, real infrastructure reason and was correctly not misreported |
| Read-model behavior (commercialLineItems) | **NOT CAUSAL** | No evidence of a stale or incorrect read; the confirmed state at each point is exactly what the last real write produced |
| Request/satisfaction evidence gap | **PRIMARY, structural, unchanged from A0, now with direct empirical symptoms attached to it in both turns** | Nothing in the events shown represents "25kg requested, not yet in effect" as a fact the model could read instead of re-deriving |
| Event-observability ambiguity | **RESOLVED, not merely narrowed** -- see Section 3 below | The apparent "10 calls where 5 were expected" is fully explained as two recorders observing the same 5 real executions, not a mystery |

### 1.4 What remains genuinely unverified

- The exact `items` array passed to `select_products` in either call (A0's
  own Section 11 observability gap stands: neither event layer's payload,
  as supplied, includes the capability's input arguments -- only
  `resultStatus`/`gatewayStatus`/`observationStatus`/`governance`).
- Whether any `select_products` attempt for 25kg was ever made and rejected
  by the evidence gate (`status:"blocked"`) at a point not included in this
  log excerpt -- no `COMMERCIAL_ACTION_REJECTED`-typed event for
  `select_products` appears in the evidence given for either turn, which is
  suggestive that no block occurred, but the excerpt is not stated to be
  exhaustive of every event in these turns.
- The exact productIds the 5 `search_products`/`get_product_details` pairs
  in turn 417 targeted (i.e., whether they genuinely covered all five named
  weights, including 25kg, one-for-one) -- plausible from the count and the
  conversation's own content, not confirmed from a payload.

---

## 2. Production evidence reconciliation -- Case B (bar -> discs)

### 2.1 What this evidence newly settles

**Neither turn 432 nor turn 434 ever issued a `search_products`,
`explore_catalog`, or `recommend_catalog_products` call.** The only tool
activity in both turns, across the full event range given, is
`get_product_details` (5 real calls per turn, per Section 3's reconciliation
below). This is a materially stronger and more specific finding than A0's
Section 3/13 could produce from architecture alone: A0 could only say the
`RECENT_CATALOG_CONTEXT_RULE_LINES` mandate to re-verify via
`get_product_details` *could* explain repeated bar inspection; production
evidence now shows this is not one plausible mechanism among several -- it
is the *only* tool activity that happened, in both turns, with **zero
attempts to search a new product category at all**. The actual assistant
outputs corroborate this exactly: turn 432 "talked about the same bar again,
gave the bar link again"; turn 434 "returned two 20 kg bars again and asked
which bar link to send." Neither response ever mentions a disc.

**This settles A0's own open Section 3 question for Case B in favor of one
specific classification.** A0 listed five candidate classifications
(within-turn loop, pending-action staleness, tool recovery defect, reference
resolution defect, satisfaction-state absence) and could not fully rank
them without data. With this evidence:

- **Within-turn loop**: not what happened -- the existing duplicate-call
  dedupe guard would have blocked a literal same-arguments repeat within one
  turn (A0 Section 13, confirmed via C1.1's own live benchmark observing
  this exact guard fire); "two 20 kg bars" in turn 434's own response
  implies at least two distinct `get_product_details` targets were involved
  across that turn's 5 calls, not one product inspected five identical
  times.
- **Pending-action staleness**: **not supported as the mechanism** -- A0
  already argued (Section 7) that turn 430's own link-delivered response
  most likely cleared any `send_product_link` pending action per the
  closing-question suppression rule, and this evidence adds nothing to
  revive it: no product-link delivery pattern repeats in 432/434's own
  described outputs in a way that implicates `pendingCatalogAction`
  specifically (it only ever governs a *link offer*, and the actual
  observed defect is a *search-tool-selection* failure, a different
  mechanism entirely).
- **Tool recovery defect**: **ruled out** -- no failure/error is reported
  for any of the 20 `get_product_details` calls across both turns; the tool
  worked exactly as asked every time, it was simply never the right tool to
  invoke.
- **Reference-resolution / latest-user-reference failure**: **confirmed,
  and now the most direct description of the observable defect.** "si con
  los discos" and "si" are messages *about* a category
  (`discos`/compatible discs) that had never been searched. The model's
  own next action, both times, was to re-inspect a category
  (`get_product_details` against bar candidates) it had already fully
  resolved. This is a tool-selection/reference-binding failure in the
  most literal sense: the customer's new noun ("discos") was never bound to
  a new search action at all.
- **Satisfaction-state absence**: **confirmed as the reason this did not
  self-correct across two consecutive turns**, not as the proximate
  mechanism of either individual failure. Turn 432 already showed the
  identical bar-anchored non-response-to-discos pattern; turn 434 repeated
  it verbatim in kind (again zero disc-related tool calls) despite the
  customer confirming *again* ("si"). Nothing durable recorded "we already
  failed to address discos once this conversation" for the next turn to
  read and avoid repeating.

### 2.2 Corrected classification

**PRIMARY, empirically confirmed**: a latest-user-reference/tool-selection
failure -- the newly-named object ("discos") was never bound to any
catalog-search tool call in either of the two turns that should have
triggered one, while `recentCatalogContext`'s still-present bar candidates
(Section 6's confirmed non-semantic eviction policy) remained the only
catalog evidence the model's `get_product_details` calls kept revisiting.

**SECONDARY**: missing satisfaction/resolution evidence -- explains the
*repetition* across turns 432 and 434 (why the identical wrong pattern
recurred rather than self-correcting), not the *initial* occurrence at 432.

**NOT CAUSAL**: `pendingCatalogAction` staleness in the literal sense (most
likely already correctly cleared); any tool execution failure (none
occurred); within-turn tool budget exhaustion or a duplicate-call dedupe
gap (the dedupe guard is a same-turn, same-arguments mechanism and is not
implicated by a cross-turn, different-object failure).

### 2.3 Is the behavior itself sufficient to classify this as "failure to advance from a resolved object to a newly requested object"? **Yes, directly.**

The bar was resolved (turn 430 delivered its link and asked an explicit,
disjoint follow-up question about discs/shipping). The customer twice
confirmed wanting the newly-named object. The model's own tool activity
and response content, in both following turns, never once advanced past
the resolved object. This is not an inference from architecture; it is the
literal content of the supplied assistant outputs and the literal absence
of any disc-directed tool call in the supplied event log.

### 2.4 What remains genuinely unverified

- The exact productIds behind the 5 `get_product_details` calls per turn
  (plausibly the same 2-4 bar candidates from turns 422-430, consistent with
  "two 20 kg bars" in turn 434's response, but not confirmed from a
  payload).
- Whether `recentCatalogContext`'s underlying `crm_capability_executions`
  rows at turns 432/434 still literally contained the turn-422/428/430 bar
  interactions, versus some other explanation for why `get_product_details`
  kept resolving to bar candidates specifically (e.g., a different evidence
  source not examined in A0's original trace). The *behavior* is confirmed;
  the *exact evidence-source pointer* it read from is not, absent the raw
  `recentCatalogContext`/`crm_capability_executions` payloads for this
  conversation at these two turns.

---

## 3. Event layers, reconciled against real production evidence

A0's Section 12 could not reproduce, from the source tree alone, a
`READ_TOOL_REQUESTED`-shaped event carrying a `phase` field, and said so
plainly. This task re-audited the source tree specifically against the
literal shapes supplied and found the producer of exactly that shape --
**this is a real, confirmed, resolvable mechanism, not an illustrative
approximation, and not a mystery.**

### EVENT LAYER A

- **Producer**: [`lib/brain/commercial/read-tool-request/sessionEvents.ts`](../../lib/brain/commercial/read-tool-request/sessionEvents.ts)
  (`recordReadToolRequested`/`recordReadToolCompleted`, payload
  `{tool, opportunityId}`, called synchronously from
  [`executeReadTool.ts:86,91,105,138`](../../lib/brain/commercial/read-tool-request/executeReadTool.ts)
  -- i.e. **at the moment each individual read tool call actually executes**)
  for `search_products`/`get_product_details`; and
  [`lib/brain/commercial/commercial-action-request/sessionEvents.ts`](../../lib/brain/commercial/commercial-action-request/sessionEvents.ts)
  (`recordCommercialActionRequested`/`Accepted`/`Terminal`, payload
  `{actionType, opportunityId}` / `{actionType, capability}` /
  `{actionType, capability, resultStatus, gatewayStatus, stableErrorCode,
  retryable}`) for `select_products`/`calculate_shipping`-class mutating
  actions, called synchronously from
  `executeCommercialActionRequest.ts` at the same real-execution boundary.
  Both adapters
  ([`read-tool-request/atlAdapter.ts:33`](../../lib/brain/commercial/read-tool-request/atlAdapter.ts),
  [`commercial-action-request/atlAdapter.ts:40`](../../lib/brain/commercial/commercial-action-request/atlAdapter.ts))
  set `causationId = input.inboundMessageId` unconditionally -- confirmed
  identical to the production evidence's `causation_id=417`/`causation_id=420`
  for this layer.
- **Meaning**: the real, governance-checked, Capability-Gateway-boundary
  record of one physical tool/capability execution -- this is the
  authoritative execution log.
- **Physical execution?** **YES.**

### EVENT LAYER B

- **Producer**: [`lib/brain/commercial/agent-session/shadowRecorder.ts`](../../lib/brain/commercial/agent-session/shadowRecorder.ts),
  function `appendToolActivityEvents` (lines 84-118), invoked via
  `recordAgentToolLoopToolActivityEvents` (lines 212-230) from
  [`salesAgentRuntime.ts:509-516`](../../lib/brain/commercial/sales-agent-runtime/salesAgentRuntime.ts)
  -- the native R3 runtime this pilot conversation runs on
  (`processNativeWhatsAppInbound -> runNativeAutonomousCycle -> ... ->
  salesAgentRuntime.ts`, per prior release evidence). Called **exactly
  once per turn, after the entire Agent Tool Loop has already finished**,
  iterating over `stepsSummary` (`buildStepsSummary(loop.steps)` -- an
  **in-memory record of steps already taken this turn**, not a new
  HTTP/DB call) and re-emitting one `REQUESTED`+terminal event pair *per
  step* it already has a record of. Payload for the `REQUESTED` event:
  `{tool: step.tool, phase: step.phase}` -- **an exact, literal match for
  the production evidence's `{"tool":"search_products","phase":"gathering"}`
  shape.** `causationId` is **not set** on the `REQUESTED` event
  (line 91-98, no `causationId` field passed -> null/absent) and is set to
  `requested.event?.eventId ?? null` -- **the just-created `REQUESTED`
  event's own synthetic row id** -- on the terminal event (line 110). This
  is an exact, literal match for the production evidence's "causation_id =
  event id or NULL."
- **Meaning**: a deliberate, designed, **post-hoc re-projection** of the
  same turn's own step summary into the same `agent_session_events` table,
  in a uniform, tool-agnostic vocabulary (`{tool, phase}` /
  `{tool, phase, governance, observationStatus}`) that spans both read
  tools and commercial actions in one shape -- unlike Layer A, which is
  split across two differently-shaped modules by governance class. The
  module's own header comment names this intent explicitly: *"Derives
  AgentSessionStore events from an already-completed Agent Tool Loop turn -
  shadow/additive only."*
- **Physical execution?** **NO.** It is a second, deliberate observability
  write against an execution that already happened and was already recorded
  by Layer A -- not a second HTTP/DB call to `search_products`,
  `get_product_details`, or the Catalog/Carrier services.

### A confirmed comment/code discrepancy worth flagging precisely (not fixed here)

The actual call site of Event Layer B,
[`salesAgentRuntime.ts:501-506`](../../lib/brain/commercial/sales-agent-runtime/salesAgentRuntime.ts),
carries a comment asserting this call is *"never a second event-recording
path"* and *"only adds the turn-level envelope"* for
"USER_MESSAGE_RECEIVED/tool-summary/ASSISTANT_MESSAGE_SENT" events, since
*"every individual tool/action request+result is already recorded
independently, for free, inside executeReadTool/executeCommercialActionRequest."*
This comment is **factually incorrect about what the code it annotates
actually does**: the function actually called here,
`recordAgentToolLoopToolActivityEvents`, does not write
USER_MESSAGE_RECEIVED/ASSISTANT_MESSAGE_SENT at all (that is the *other*
exported function, `recordAgentToolLoopSessionShadowEvents`, used only by
the separate legacy ATL runtime) -- it calls the exact same
`appendToolActivityEvents` helper that both entry points share, which does
emit one `REQUESTED`+terminal pair per individual tool step, i.e. it *is*
a second event-recording path for each individual tool execution, exactly
as the production evidence shows. This is a real, locatable instance of a
code comment that no longer matches the code's own behavior -- surfaced
here as a precise finding per this task's reconciliation mandate, not
corrected in this audit-only task.

### Can both layers describe the same physical action? Can they represent different actions?

**Layer A and Layer B, for a given tool step, always describe the exact
same physical action** -- Layer B is mechanically derived from
`loop.steps`, the same in-memory record that already reflects whatever
Layer A already executed and recorded; it introduces no new decision, no
new HTTP/DB call, and no new side effect. They can never diverge on *which*
actions occurred (Layer B cannot invent a step Layer A does not already
have a record of), but they *can* diverge in *count* if Layer A's own
recording ever partially failed (both are "shadow/additive only," fail-open
on their own write failures -- `catch` blocks in both `sessionEvents.ts`
modules and in `shadowRecorder.ts`) -- a scenario this evidence does not
show occurring here (the two layers' counts line up exactly, 5-and-5, in
both cases given).

### How should future debugging count executions?

**Count real executions from Event Layer A only** (`read-tool-request/
sessionEvents.ts` / `commercial-action-request/sessionEvents.ts`,
`causation_id` = the real inbound message id). Event Layer B
(`agent-session/shadowRecorder.ts`, `causation_id` = a synthetic event id or
null, payload keyed by `{tool, phase}`) should be read as a **per-step,
turn-scoped activity ledger for the cognitive loop**, useful for
reconstructing *what the model decided to do, in what phase, with what
governance outcome*, but never as an independent count of physical
executions. A future debugging runbook entry naming this precisely (which
`event_type`+payload-shape pairs belong to which layer, and which layer is
authoritative for execution counts) would prevent exactly the
misinterpretation A0 flagged as a real risk ("future production debugging
does not mistake duplicated observability for duplicated side effects") --
not implemented here, per this task's scope.

---

## 4. Re-evaluation of A0's central finding

A0's central finding: *"R3 knows transcript truth. R3 knows commercial
truth. R3 does not explicitly know the relation between the two."*

Distinguishing the four truths precisely, against this production evidence:

1. **Transcript truth**: confirmed real and correctly maintained (settlement/
   assimilation worked exactly as designed in both cases).
2. **Current commercial truth**: confirmed real, internally consistent, and
   always reflects the last real write (Section 1.3) -- never itself wrong
   or stale in either case.
3. **Causal tool/effect truth**: **now directly confirmed to exist and be
   real, granular, and available to the model within the turn** -- this is
   the new information this task adds. Turn 417 shows the model genuinely
   had 10 real pieces of fresh catalog evidence plus one real, correctly-
   observed mutation result available before its final response. Case B
   shows the model genuinely had 5 real, successfully-completed
   `get_product_details` observations available each turn. **Causal tool/
   effect truth is not the bottleneck in either case** -- it was present,
   correct, and not the limiting resource.
4. **Request<->effect relation**: **still, and now more clearly than before,
   the one truth this system does not compute anywhere.** With (1), (2),
   and (3) all confirmed present and functioning correctly in the specific
   turns that still failed, the missing-relation hypothesis is **strengthened
   by this evidence, not merely left standing** -- there is no longer a
   plausible alternative reading where the failure is "the model didn't have
   enough evidence" (Case A, turn 417) or "the model never learned the
   effect of its own action" (both cases -- `select_products`'s own
   observation already returns the full resulting state, per A0 Section 8,
   confirmed unmodified here). The failure occurs specifically at the step
   of *reconciling* (1)+(2)+(3) into a correct next action, which is exactly
   the relation this system has no representation for.

**Conclusion: the missing request<->effect relation remains the strongest
common architectural gap, and production evidence has moved it from "the
best available explanation given the architecture" to "the only explanation
consistent with what is now confirmed to have actually happened in both
turns."**

---

## 5. DeepSeek Harness comparison

**Canonical Harness shape** (per this task's own framing, consistent with
this codebase's own `deriveMessages()`/causal-projection lineage):
append-only session events -> `deriveMessages()` -> model sees ordered
causal history -> model decides. Harness's own design philosophy does not
include a semantic "dialogue state" object anywhere in its canonical
pipeline -- its answer to "how does the model know what's going on" is
*"give it a complete, correctly-ordered causal record and trust it to
reason over that record,"* never *"maintain a summary object of what's
going on for it."*

**R3's actual shape, mapped onto that canonical pipeline**:

| Harness concept | R3 equivalent | Alignment |
|---|---|---|
| append-only session events | `agent_session_events` (both layers), `commercial_event`, `conversation_message` | Aligned -- genuinely append-only, durable |
| `deriveMessages()` | `deriveMessages.ts` / `buildAgentStepPromptPackage.ts` / `harnessAlignedMessageProjection.ts` | Aligned -- fresh projection every call, never a cached derived state object |
| model sees ordered causal history | persistent-session transcript + (C1 mode) causal tool-step replay | Aligned, and actively improving (C1's own stated purpose) |
| *(no equivalent in canonical Harness)* | `commercialContext` (fresh, re-derived every turn from durable facts) | **Aligned** -- it is itself a derived, re-queried-every-turn projection, not persisted strategy state, even though vanilla Harness has no direct analogue for "durable business facts" |
| *(no equivalent in canonical Harness)* | `recentCatalogContext` (recency/count-windowed cache, re-queried every turn from `crm_capability_executions`) | **Structurally derived** (re-queried fresh every turn, deletable and re-creatable from the durable execution log) **but behaviorally can act like latent topic/workflow state** -- this is the crux of Section 5's own question, addressed below |
| *(no equivalent in canonical Harness)* | `pendingCatalogAction` (one-turn lookback, self-cleaning, single action type) | Aligned -- narrow, re-derived every turn from the single most recent `commercial_event`, never persisted beyond one turn |
| model decides | AgentStep loop (`respond`/`use_tool`/`handoff`) | Aligned, unchanged by this audit |

### Would official Harness solve this by persisting semantic dialogue state? **No -- proven, not assumed, from the mechanism itself.**

Harness's own canonical answer to "the model loses track of what's going
on" is never "add a dialogue-state object" -- it is "make sure the causal
record the model re-reads every turn is complete, correctly ordered, and
faithfully represents what actually happened," and then trust the model's
own reasoning over that record. Applied to this specific failure: Harness
would not fix Case A/B by adding `currentIntent`/`activeTopic`; it would
fix it, if at all, by ensuring the causal record itself contains
**a fact the model can point to and reason from** -- e.g., a durable,
freshly-re-derivable event or projection stating that a discrepancy exists
between what was said and what is currently true -- which is itself just
one more *derived evidence node* in the same append-only, causal-projection
pipeline Harness already uses for everything else. This is evidence, not
strategy: the model still decides what to do about the discrepancy (add
the item? ask again? treat the earlier mention as superseded?) -- Harness's
own philosophy is fully compatible with adding *this specific kind* of
evidence and fully incompatible with adding a decision-shaped field
(`nextStep`) instead.

### Where R3 has added derived evidence that can accidentally behave like latent workflow/topic state

**`recentCatalogContext` is the confirmed offender**, now with a direct
behavioral demonstration in Case B (Section 2), not merely the structural
argument A0's Section 6 made in the abstract. It is genuinely re-derived
fresh every turn from a durable, append-only log
(`crm_capability_executions`) -- structurally Harness-aligned by
construction -- but its **eviction policy (recency/count only, never
topic-aware)** means it can, and in Case B evidently did, keep an already-
resolved product family's evidence more prominent and more "ready to act
on" than a customer's brand-new, never-yet-searched request. This is the
one place in this codebase where a mechanism built the *right* way
(derived, re-queried, deletable-and-recreatable) still produces a
*workflow-state-like effect* (anchoring the model to "the current topic")
purely through its own selection/eviction logic, not through anything
persisted as strategy.

`pendingCatalogAction` is comparatively well-behaved by this same test
(Section 7 below) -- its narrowness and one-turn lookback make it a much
smaller surface for this effect, and this evidence did not implicate it
directly in either case.

### A or B?

**B -- better derivation/projection from durable truth.** Every existing
R3 mechanism already in this codebase (`commercialContext`,
`recentCatalogContext`, `pendingCatalogAction`) is already built on the B
philosophy: fresh, re-queried, re-derivable, never itself the strategy.
The confirmed gap (Section 4) is not "R3 needs to remember more across
turns" (A) -- it already remembers everything durably, in the transcript
and in `crm_request_facts`/`crm_capability_executions`. The gap is that
**no existing derivation computes the one relation that matters**
(request vs. current effect). Adding that relation as one more derived
projection is squarely a B-shaped fix; recommending A (a persisted
intent/topic/stage field) would not only fail the Harness-alignment test
this task itself sets (Section 7), it would also be solving a problem
("R3 forgets") that Section 4's own evidence shows is not the actual
problem ("R3 remembers everything and still doesn't compute the one thing
that matters").

---

## 6. Request/satisfaction evidence -- conceptual boundary only

**Permitted shape** (evidence, freely derivable, never persisted as a
decision): a freshly-computed fact of the form *"the causal transcript
contains a customer reference to X; the current durable effect (`commercialContext`)
does not yet reflect X; these are in tension."* This is symmetric --
it must be equally capable of expressing *"X was explicitly revoked in the
transcript, and the current durable effect no longer reflects it either
(consistent, no tension)"* as a non-event, never asserting a value for what
should happen next.

**Forbidden shape**: `currentIntent=X`, `activeTopic=X`, `nextStep=do Y`,
`conversationStage=Z` -- anything that names a *decision* or a *topic
label* rather than a *discrepancy between two already-durable facts*.

**The minimum information the model lacks today, stated precisely**: a
fresh, per-turn, re-derivable statement of *which specific transcript-
referenced product/quantity/action does not currently match durable
commercial truth* -- without the architecture naming what to do about that
mismatch (add it, drop it, ask about it, treat it as superseded by a later
message). The model remains the one that reads "customer mentioned 25kg;
current selection does not include 25kg" and decides, using its own
judgment and the surrounding conversation, whether that is a live, unmet
request or a moot, superseded one. Symmetrically for Case B: a fresh
statement that *"the customer's most recent message references a product/
category with no catalog-tool evidence gathered for it yet"* would be
evidence the model could act on with a search call -- never a persisted
"active topic = discos" field asserting what the model must now pursue.

---

## 7. Delete-and-re-derive test

| Candidate concept | Deletable and recomputable from durable truth? | Classification |
|---|---|---|
| A discrepancy fact ("transcript mentions 25kg; `commercialLineItems` does not") | Yes -- purely a function of (a) the durable transcript already read every turn and (b) a fresh `commercialLineItems` read already performed every turn. Nothing about it needs to survive independently; if deleted, re-running the same derivation over the same durable inputs reproduces it exactly. | **DERIVED EVIDENCE** |
| A "this candidate's underlying search is no longer the most recent relevant one" freshness signal for `recentCatalogContext` (addressing Case B) | Yes, **provided** it is computed as a recency/relevance test against the causal tool-call and transcript history every turn, never stored as a persisted "topic" label on a candidate. The distinction is real: a persisted `resolved:true` flag on a candidate row would count as semantic state; a freshly recomputed "is this still the most recent catalog interaction relative to the customer's latest words" test does not. | **DERIVED EVIDENCE, if implemented as a recomputed test, not a stored flag** |
| An "open question I asked last turn" representation (generalizing `pendingCatalogAction` beyond `send_product_link`) | Yes -- the assistant's own last message is already durable transcript; a fresh per-turn derivation ("was the assistant's immediately preceding message a question, and about what referenced evidence") reconstructs the same fact every time without persisting anything beyond what `pendingCatalogAction` already persists for its one existing case (a turn-scoped, self-cleaning record). | **DERIVED EVIDENCE** |
| A `select_products` before/after delta (H5 from A0) | Yes -- trivially, a pure diff of two already-durable reads (`commercialLineItems` immediately before and immediately after the call), never itself a new durable fact. | **DERIVED EVIDENCE** |
| Any field naming what the model should do next, or labeling a conversational "topic"/"stage"/"intent" | No such field passes this test by construction -- it is not a fact about durable truth, it is a decision or a label, and "deleting and re-deriving" it does not even type-check as a question (there is no durable source of truth a decision could be re-derived from; a decision is exactly what re-deriving cannot produce, since it depends on judgment, not on already-recorded facts). | **PERSISTENT SEMANTIC STATE -- rejected by construction, none recommended** |

**No candidate identified anywhere in this reconciliation requires
persistent semantic state.** Every gap found in both production cases is
addressable, at the conceptual-boundary level this task scopes to, purely
by adding derived evidence.

---

## 8. Root-cause reclassification (production-evidence-based)

**DUMBBELL 25KG FAILURE**
- PRIMARY: a request<->effect binding/reconstruction error -- the model,
  given real, fresh, sufficient catalog evidence (turn 417) and given zero
  fresh evidence at all (turn 420, where it instead added an unrequested
  second 5kg unit while leaving the explicitly requested 25kg absent),
  fails to correctly compute the customer's cumulative desired selection
  from the causal transcript plus current durable state.
- SECONDARY: `select_products`' full-replacement mutation semantics
  (deliberate, documented, unrelated design decision) converting each such
  omission into a silent deletion of previously-confirmed items rather than
  a harmless no-op; `commercialContext`'s "current state only" shape
  providing no discrepancy signal for the model to check itself against.
- NOT CAUSAL: capability execution failure (both `select_products` calls
  completed successfully); read-model staleness (state is always internally
  consistent with the last real write); the `calculate_shipping` failure
  (real, but independently caused by `catalog_response_mismatch`, and
  correctly never misreported to the customer); evidence-gate blocking as
  the *sole* explanation (downgraded relative to A0, given turn 417's own
  fresh-evidence-gathering activity and turn 420's misdirected-rather-than-
  blocked addition).
- EMPIRICALLY CONFIRMED: settlement/assimilation correctness; both
  `select_products` calls completed; both `calculate_shipping` calls failed
  for a real, unrelated reason; the model never misrepresented the shipping
  failure; turn 420 made no fresh tool calls before its own mutation; two
  real, distinct, non-duplicative-of-side-effects event-recording layers
  produced the "10 calls" appearance from 5 real calls (Section 3).
- STILL UNVERIFIED: the literal `items` arguments of either `select_products`
  call; whether a blocked 25kg attempt occurred outside the given log
  excerpt; the exact productIds behind turn 417's 5 search/detail pairs.

**BAR->DISC FAILURE**
- PRIMARY: a latest-user-reference/tool-selection failure -- across two
  consecutive turns, a customer message naming a new, never-yet-searched
  object ("discos") was never bound to any catalog-search tool call; the
  model's only tool activity in both turns re-inspected already-resolved
  bar candidates via `get_product_details`.
- SECONDARY: missing satisfaction/resolution evidence, explaining why the
  identical failure pattern repeated unchanged at turn 434 after already
  occurring at turn 432, with nothing durable recording that the first
  attempt had already failed to address the customer's request.
- NOT CAUSAL: any tool execution failure (none occurred across 10 real
  `get_product_details` calls); a broken evidence gate (every call
  completed); `pendingCatalogAction` staleness in the literal sense (most
  likely already correctly cleared by turn 430's own link-delivered
  suppression rule); within-turn tool-call budget exhaustion (a
  tool-selection defect, not a budget one).
- EMPIRICALLY CONFIRMED: zero search/explore/recommend calls for "discos"
  in either turn; `get_product_details` was the sole real tool activity in
  both turns (5 real calls each, per Section 3's reconciled count); both
  final responses stayed anchored to the bar; the identical failure pattern
  recurred, unmodified, at the second opportunity.
- STILL UNVERIFIED: the exact productIds behind each turn's 5
  `get_product_details` calls (plausibly 2+ distinct bar variants, per "two
  20 kg bars" in turn 434's own response, but not confirmed from a
  payload); the exact underlying `recentCatalogContext`/
  `crm_capability_executions` rows read at these two turns.

---

## 9. Verdict review

A0's verdict, `R3_C2_NO_SINGLE_PRIMARY_CAUSE`, was chosen specifically
because A0 could not yet confirm, case by case, that the *same* gap was
truly dominant in both failures rather than each case having its own
distinct, unrelated root cause that merely happened to look similar at the
architecture level. This task's production evidence removes that
uncertainty:

- Case A's PRIMARY cause (Section 8) is a request<->effect binding failure,
  now confirmed to occur even when fresh, sufficient causal evidence was
  available (turn 417) and even when no confounding evidence-gathering was
  involved at all (turn 420).
- Case B's PRIMARY cause (Section 8) is a failure to bind a newly-referenced
  object to the correct evidence-gathering action, which is the *same
  underlying capability gap viewed from the tool-selection side rather than
  the mutation-argument side*: in both cases, the system had no derived
  fact stating "here is what the customer has asked for that current durable
  truth/evidence does not yet reflect," and in both cases the model,
  lacking that fact, fell back on the same-shaped error -- continuing to
  act on/around already-resolved state (Case A: previously-confirmed
  weights; Case B: the previously-resolved bar) rather than correctly
  incorporating the newly-stated, still-unaddressed customer request.

Per this task's own reasoning ("different secondary amplifiers do not
automatically imply no shared primary cause"), the secondary amplifiers
identified in each case (full-replace mutation semantics for Case A;
non-semantic `recentCatalogContext` eviction for Case B) are now properly
demoted to SECONDARY in both, rather than treated as case-specific
co-primary causes the way A0's hedge implicitly allowed. The evidence
supplied in this task is exactly what was needed to make that
demotion with confidence rather than as a plausible reading.

**Verdict: `R3_C2_REQUEST_SATISFACTION_EVIDENCE_GAP_CONFIRMED`**

This supersedes A0's `R3_C2_NO_SINGLE_PRIMARY_CAUSE`. It is chosen over
the other four alternatives because: `R3_C2_AUTHORITY_GAP_CONFIRMED` is
directly contradicted by A0's own quoted evidence (the prompt contract is
unusually explicit and already anticipates this failure mode in words --
Section 5 of A0); `R3_C2_CONTEXT_STALENESS_PRIMARY` fits Case B's secondary
mechanism but not Case A's (turn 417's commercialContext was never shown to
be stale or wrong, only silently incomplete by design); `R3_C2_TOOL_RECOVERY_PRIMARY`
is directly contradicted by this task's own evidence (zero tool failures
implicated in either case's primary mechanism); `R3_C2_MUTATION_STATE_PRIMARY`
fits Case A's secondary mechanism but not Case B's (no mutation was even
attempted in Case B's failing turns).

---

## 10. Next-stage recommendation

**Recommend `SALES-AGENT-R3-V1.8.2-C2-A1` -- Harness-Aligned Request/
Satisfaction Evidence Design**, as a design task (not an implementation
task), constrained explicitly to:

- The evidence produced must be **derived**, computed fresh from durable
  truth every turn -- never a persisted decision, stage, or topic label
  (Section 7's test is the acceptance criterion for the design itself).
- It must be **re-derivable from durable truth**: the durable transcript,
  durable assistant messages, durable tool/capability outcomes
  (`crm_capability_executions`/`commercial_event`), and a fresh
  `commercialContext` read -- no new durable table whose *deletion* would
  lose information not otherwise reconstructible from those sources.
- **The model remains the decision-maker**: the design supplies a fact
  ("X was mentioned; Y is the current effect; they differ"), never a
  conclusion ("therefore add X") or an instruction ("ask about X next").
- **No workflow state machine, no intent stack, no conversation stage.**
- **No product-specific hardcoding** (nothing keyed to "dumbbells" or
  "bars" specifically -- the mechanism must generalize across every
  commercial-line-item/catalog-reference pattern this system has).
- **No regex-derived obligation ledger** -- the discrepancy evidence must be
  computed from already-structured facts (transcript text plus
  `commercialLineItems`/tool observations), not from pattern-matching raw
  customer language into a business rule.
- **Causal with assimilated user messages**: the design must compose
  correctly with Live Turn Assimilation's own causal fragment ordering
  (A0 Section 1's architecture list) -- a discrepancy fact must reflect the
  full, correctly-ordered set of customer fragments this turn, not merely
  the turn's opening message.
- **Fresh commercial truth remains authoritative for effects**: the design
  must never let a discrepancy fact override or shadow `commercialContext`
  as the source of truth for what is currently, actually selected/confirmed
  -- it only ever adds a *comparison* against that truth, never replaces it.
- **Catalog evidence must not masquerade as active topic state**: any
  design touching `recentCatalogContext` (Section 5's confirmed offender)
  must preserve or improve its re-derivability (Section 7) and must not
  introduce a persisted "resolved"/"active" flag on a candidate -- only a
  freshly recomputed relevance/recency test, if any change to that
  mechanism is in scope for C2-A1 at all.

This is the correct next step because Section 9's verdict identifies one
confirmed, dominant, common gap across both real production failures, and
Section 6/7 of this task already establish the conceptual boundary and the
acceptance test (delete-and-re-derive) that C2-A1's actual design must
satisfy -- narrowing the design space substantially before any schema or
prompt work begins, exactly as an audit-then-design sequence should.

---

## 11. Documentation

Created:
- This file.
- `docs/ACTIVE_RELEASE.md`, updated in the same change (pointer only, per
  `AGENTS.md`'s mandatory workflow).

No production code, prompt, tool, or schema file was changed by this task.

---

## 12. Final output summary

1. **Production evidence reconciliation**: A0's architectural predictions
   held up under real production data in every case they were testable;
   the new evidence resolves two questions A0 could not (whether fresh
   evidence-gathering preceded Case A's failure -- yes, and it still
   failed; whether Case B ever attempted to search for discs -- no, in
   either turn) and fully explains the "duplicated event" observation A0
   flagged as unverifiable.
2. **Corrected event-layer explanation**: Layer A
   (`read-tool-request/sessionEvents.ts` +
   `commercial-action-request/sessionEvents.ts`, `causation_id`=inbound
   message id) is the real, physical-execution log; Layer B
   (`agent-session/shadowRecorder.ts#appendToolActivityEvents`,
   `causation_id`=synthetic event id/null, `{tool,phase}` payload) is a
   deliberate, additive, post-hoc re-projection of the same executions in a
   uniform vocabulary -- confirmed by direct source trace, matching the
   supplied production shapes exactly, including a real, locatable stale
   code comment that mischaracterizes what Layer B's own call site does.
3. **Corrected root-cause classification**: both cases now show the same
   PRIMARY cause (a request<->effect binding/reference-resolution failure
   rooted in the missing discrepancy-evidence capability), each with its
   own distinct, real, but SECONDARY amplifier (full-replace mutation
   semantics for dumbbells; non-semantic catalog-context eviction for
   bar/discs).
4. **Harness alignment conclusion**: official Harness semantics would not
   solve this by persisting semantic dialogue state -- its own philosophy
   solves exactly this class of problem via richer derived causal evidence,
   not stored decisions; `recentCatalogContext` is the one existing R3
   mechanism that, despite being structurally derived, can behaviorally
   masquerade as latent topic state, and C2 should move toward (B) better
   derivation, never (A) more persistent state.
5. **Final verdict**: `R3_C2_REQUEST_SATISFACTION_EVIDENCE_GAP_CONFIRMED`,
   superseding A0's `R3_C2_NO_SINGLE_PRIMARY_CAUSE`.
6. **Recommended next task**: `SALES-AGENT-R3-V1.8.2-C2-A1` -- Harness-
   Aligned Request/Satisfaction Evidence Design, bounded by the nine
   constraints in Section 10, design-only, no implementation.

No implementation was performed in this task.
