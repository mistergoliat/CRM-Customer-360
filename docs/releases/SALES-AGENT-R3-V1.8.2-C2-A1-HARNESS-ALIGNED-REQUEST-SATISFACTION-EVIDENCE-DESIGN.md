# SALES-AGENT-R3-V1.8.2-C2-A1 -- Harness-Aligned Request/Satisfaction Evidence Design

Status: **DESIGN ONLY**. Zero production code, prompts, tools, or schema
changed. This document designs the smallest Harness-aligned evidence
mechanism that closes the gap confirmed empirically by
[C2-A0](SALES-AGENT-R3-V1.8.2-C2-A0-CUSTOMER-INSTRUCTION-UNSATISFIED-OBLIGATION-AUDIT.md)
and [C2-A0.1](SALES-AGENT-R3-V1.8.2-C2-A0.1-PRODUCTION-EVIDENCE-RECONCILIATION.md):
`R3_C2_REQUEST_SATISFACTION_EVIDENCE_GAP_CONFIRMED`. Every design decision
below is checked against the delete-and-re-derive test and against the two
real production failures, not against a hypothetical.

Two constraints from the task owner are treated as load-bearing, not
optional preferences, throughout this document:

1. `recentCatalogContext` must stop being *behaviorally* readable as "what
   we are talking about now." It is recent evidence, nothing more. Its
   current design is already re-derivable (Harness-aligned by
   construction); the fix is to stop letting recency alone imply relevance,
   never to persist a "topic" on it.
2. The pre-mutation checkpoint must never become a corrector. Its exact
   philosophy: *DeepSeek proposes an effect -> architecture detects that the
   evidence it reasoned over changed or a factual discrepancy now exists ->
   the proposal is invalidated -> evidence is re-projected -> DeepSeek
   reasons again.* This is the same philosophy already shipped for Live
   Turn Assimilation (`tryAssimilate()`'s Boundary 1,
   [`runAgentToolLoop.ts:1197-1211`](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts)):
   invalidate a stale candidate and re-derive from durable truth; never
   substitute the model's own reasoning with a rule.

---

## 0. North star discipline applied throughout

Every field proposed in this document is run through:

**DELETE-AND-RE-DERIVE TEST**: can this evidence be deleted entirely right
now and reconstructed, byte-for-byte, from (a) durable user transcript,
(b) durable assistant transcript, (c) durable tool/capability outcomes
(`crm_capability_executions`, `commercial_event`), and (d) a fresh
`commercialContext` read? If yes: **DERIVED EVIDENCE**, acceptable. If no:
**PERSISTENT SEMANTIC STATE**, rejected by default.

No field in Section 19's final design fails this test. Where an earlier
candidate design (Options 2/3, Section 18) would fail it, that is stated
explicitly and is the reason it was not selected.

---

## 1. Design against the two confirmed failures

Both example evidence shapes below are illustrative of the *kind* of fact
the design must expose -- Section 19 gives the actual conceptual contract.

**Case A (dumbbells)** -- the model must be able to see, without any new
natural-language extraction step (Section 3 explains why none is needed):

```
catalogEvidenceVsSelection: [
  { productRef: "productId:1025 (25kg hex dumbbell, per get_product_details)",
    commercialReflection: "absent",
    lastObservedVia: "get_product_details", lastObservedTurnsAgo: 0 }
]
```

Never: `"therefore add 25kg"`, `"activeObligation": "25kg"`,
`"nextStep": "select_products"`, `"currentIntent": "modify dumbbells"`. The
model reads the raw transcript (unchanged) plus this one factual diff and
decides, itself, whether 25kg is still wanted, was already declined, or the
diff is stale.

**Case B (bar -> discs)** -- the model must be able to see:

```
openQuestionContinuity: { assistantAskedLastTurn: true, awaitingCustomerChoice: true }
catalogDiscoveryFreshness: { newCatalogDiscoveryCallSinceLastAssistantMessage: false,
                              turnsSinceLastCatalogDiscoveryCall: 2 }
```

Never: `"activeTopic": "discs"`, `"nextStep": "search_products"`,
`"bar objective closed"` as a persisted fact. The model still has to
reference its own last message (already in transcript) and the customer's
literal words ("si con los discos") to know *what* to search for -- the
architecture only ever supplies the objective, structural nudge that its
own recent tool activity has not actually advanced past what it already
knew.

---

## 2. Minimum derived evidence

**Starting from information theory, not schema.** What is missing from the
model-visible causal record today, confirmed by A0/A0.1, is exactly two
facts, not four:

1. **A structured comparison between what has already been observed/
   confirmed via tools and what current durable effects show.**
2. **A structured comparison between what tool-discovery activity has
   happened and what the conversation's own most recent open question or
   newly-named object would require.**

The brief's own four candidate categories (A: customer-reference evidence,
B: durable-effect comparison, C: assistant-open-question linkage, D:
tool-evidence coverage) collapse into these two once the actual mechanism
is chosen (Section 3): **A and C are the same operation** (extracting a
structured reference from a message) **applied to two different message
roles** (the customer's message for A, the assistant's own prior message
for C); **B and D are the same operation** (comparing a reference against a
durable effect surface) **applied to two different effect surfaces**
(`commercialContext.commercialLineItems` for B, the set of catalog-
discovery tool calls made for D). The minimum useful evidence set is
therefore **two derivations, not four fields**:

### 2.1 `catalogEvidenceVsSelection` (answers B, using A's "reference" for free)

- **Source durable facts**: `recentCatalogContext.interactions[*].products`
  (already durable, re-queried from `crm_capability_executions` every turn
  -- [`recentCatalogContext.ts`](../../lib/brain/commercial/agent-loop/recentCatalogContext.ts)),
  this turn's own completed `search_products`/`get_product_details`/
  `explore_catalog` observations, and a fresh
  `commercialContext.commercialLineItems.items` read
  ([`buildNativeCommercialContext.ts:340-354`](../../lib/brain/commercial/context/buildNativeCommercialContext.ts)).
- **Deterministic derivation rule**: `{productId, combinationId}` pairs
  present in the observed-evidence set but absent from
  `commercialLineItems.items` (matched the same way
  `resolveObservedRecommendationSourceProduct.ts` already matches evidence
  -- reusing, not reinventing, the existing matching logic).
- **Interpretation**: purely factual (a set difference over two already-
  structured lists). No semantic label, no revocation judgment, no
  quantity-intent judgment attached.
- **Re-derivable**: yes, trivially -- delete it and recompute the same set
  difference from the same three already-durable/fresh sources; the result
  is identical every time given the same inputs.
- **Risk of becoming workflow state**: low, provided it is rendered as a
  plain, recency-annotated list ("observed, not currently in confirmed
  selection") and never wrapped in "todo"/"pending action" framing.
- **Why DeepSeek needs it**: today it must re-derive this exact diff by
  re-reading unstructured transcript every single call; this makes an
  operation DeepSeek already performs (badly, per A0.1's evidence) free and
  perfectly reliable, without telling it what to do about the result.

### 2.2 `catalogDiscoveryFreshness` (answers D, anchored by C's "linkage")

- **Source durable facts**: the timestamp/ordering of the most recent
  `search_products`/`explore_catalog`/`recommend_catalog_products`
  execution (catalog-**discovery** tools only -- `get_product_details`
  excluded, since it only re-inspects an already-identified product and
  proves nothing about whether a *new* object has been searched) relative
  to the position of the assistant's own most recent message in the durable
  transcript.
- **Deterministic derivation rule**: has a discovery-class tool executed
  since the assistant's own last message? A pure ordering/count comparison
  over already-durable, already-timestamped rows.
- **Interpretation**: purely factual -- a temporal fact about tool activity,
  never a claim about what any specific referenced object is.
- **Re-derivable**: yes, trivially, from the same durable execution log
  `recentCatalogContext` already reads.
- **Risk of becoming workflow state**: very low -- it names no entity, no
  topic, no product; it is a pure activity-recency count.
- **Why DeepSeek needs it**: it converts "you have been re-verifying
  already-known products" from something the model must notice by
  comparing tool-call intent against outcome (the exact comparison A0.1's
  Case B shows it failed to make, twice) into a fact it is simply told.

### 2.3 Why nothing else from A/B/C/D needs its own field

The brief's "assistant-open-question linkage" (C) still needs one more
piece beyond `catalogDiscoveryFreshness`: *that* an open, multi-option
question was asked at all. Section 6 shows this is better solved by
**generalizing an already-shipped, already-Harness-aligned mechanism**
(`pendingCatalogAction`) than by adding a third derivation -- so it is
designed there as a schema-family extension, not a new derivation category.

---

## 3. Customer-reference derivation -- the hardest part, resolved by not extracting

**Chosen: Option C (deterministic derivation only from already-structured
tool/action history), for both evidence categories, with one embellishment
for the open-question case (Section 6) that is still Option C in spirit --
never Option A or B.**

### Why A and B are rejected, not merely disfavored

- **Option A (ephemeral LLM-produced structured interpretation, recomputed
  every turn)** and **Option B (durable LLM-produced semantic event)** both
  require adding a *second* language-understanding step whose entire job is
  to do again, in isolation and without the tools DeepSeek itself has, the
  same reference-resolution work DeepSeek is already doing when it decides
  which product to call `get_product_details` on. This is not merely
  costly (an extra provider call per turn, extra latency, extra $) -- it is
  **duplicated, disagreeing reasoning**: a second interpreter can
  legitimately reach a different reading of "las de 25" than the primary
  loop did, and now the system has two competing "truths" about the same
  customer sentence with no principled way to prefer one. Option B compounds
  this by making the second interpreter's *possibly-wrong* reading durable,
  which is precisely the "semantic-state creep"/"contamination of durable
  truth" failure mode this task explicitly warns against -- a
  misinterpretation the model made once becomes a persisted "fact" future
  turns treat as evidence.
- Both A and B were evaluated for hallucination risk (real -- entity/
  quantity extraction from free text is exactly where small models
  confabulate), replayability (Option A is nondeterministic across replays
  of the same transcript; Option B is deterministic once written but
  requires new correction/supersession semantics the brief itself flags as
  a cost), crash recovery (Option B needs its own idempotency/dedupe design
  -- new surface area for no proven benefit here), and cost/latency (both
  add a provider round trip this design does not need).

### Why C is sufficient, empirically, for both confirmed cases

**Case A's reference is not extracted at all -- it already exists,
structurally, as a side effect of DeepSeek's own tool calls.** When the
model calls `get_product_details(productId=1025)` for the 25kg dumbbell (as
A0.1's evidence shows it did, five times over, in turn 417), that call *is*
the structured reference -- fully typed, fully durable, already correctly
attributed to a real catalog identity, at zero additional cost. `2.1`'s
diff needs nothing more than what already exists in
`recentCatalogContext`/this turn's observations.

**Case B's reference is genuinely different in kind** (a customer names a
category, "discos," that was never the target of *any* tool call -- there
is no structured evidence to diff against, because the missing action is
exactly the bug). For this class, Option C alone cannot name *what* the
customer meant (no entity was ever resolved to a productId) -- but it does
not need to. `2.2`'s freshness fact does not require knowing that "discos"
means discos; it only needs to know that no discovery-class tool call has
happened since the assistant's own last message, which is a pure count. The
*meaning* of "discos" remains entirely the model's own job, exactly as
Harness philosophy requires -- it already has the raw words ("si con los
discos", "¿...discos compatibles o... despacho...?") verbatim in its own
context; what it lacked was the nudge that its own recent tool activity had
not actually acted on either.

**A genuinely important limit, stated honestly (not solved here)**: this
design does not cover every conceivable future obligation-tracking
scenario -- for example, a customer naming a brand-new product in passing,
with no open assistant question anchoring it and no tool call ever
targeting it, in a context where the model has other, unrelated tool
activity that would make `catalogDiscoveryFreshness` look "fresh" even
though the new mention itself was never acted on. This is out of scope for
this design (it is not implicated by either confirmed production failure)
and is recorded as a residual gap in Section 15, not silently assumed away.

**Verdict for Section 3: Option C selected, explicitly, for both evidence
categories.** No new NLU/LLM interpretation layer is added anywhere in this
design.

---

## 4. Raw transcript remains source of truth

Precedence is defined only for **factual authority**, never for
conversational decision-making:

- Verbatim user transcript and verbatim assistant transcript are always the
  ground truth for *what was actually said*. Neither derived evidence field
  (2.1, 2.2) nor the generalized open-question tag (Section 6) ever
  replaces, summarizes, or is shown *instead of* the raw messages that
  produced them -- they are always additive, alongside the unmodified
  transcript the model already reads.
- Fresh `commercialContext` (via `commercialLineItems`, `shippingDestination`,
  etc.) is always the ground truth for *what is currently true
  commercially*. `2.1`'s diff can never assert a selection state that
  disagrees with a fresh `commercialLineItems` read -- it is computed
  *from* that read, not alongside a stale copy of it.
- Durable capability outcomes (`crm_capability_executions`) are always the
  ground truth for *what tool activity actually happened*. `2.1`/`2.2` are
  both pure functions of that log; if the log and a derived field ever
  disagree, the log is definitionally correct and the derived field is
  recomputed, never patched.

**No precedence is defined between the customer's current message and
`commercialContext`/`recentCatalogContext`/the new evidence fields when
they seem to "disagree" about what the customer wants** -- exactly per this
task's own Section 4 instruction ("do NOT define... 'latest message always
wins'"). That is not a gap this design leaves open by oversight: A0's own
Section 4 already established that such a rule would be actively wrong
whenever durable commercial truth is more current than the customer's own
recent words. Section 2's evidence exists precisely so that no such
precedence rule is ever needed -- the model is shown the discrepancy as a
fact and applies its own judgment, informed by the (unmodified) raw
transcript, to decide which side of an apparent disagreement is actually
still live.

---

## 5. Request <-> effect comparison -- semantic boundary

**Acceptable** (descriptive, factual, symmetric -- can express both "still
open" and "already resolved" shapes without asserting which one is true):

```json
{
  "productRef": "productId:1025 (25kg hex dumbbell)",
  "commercialReflection": "absent"
}
```
```json
{
  "productRef": "productId:1030 (30kg hex dumbbell)",
  "commercialReflection": "absent"
}
```

Both of these are structurally *identical* in shape (an observed product
absent from the current selection) even though, per the real conversation,
one (25kg) is a live discrepancy and the other (30kg) was explicitly
revoked. **This is the boundary, stated precisely**: the architecture is
only ever responsible for the structural fact "observed, currently absent"
-- it is never responsible for, and must never attempt, classifying *why*
it is absent (revoked vs. still-pending vs. never-actually-wanted). That
judgment requires reading and weighing the customer's own words about that
specific product ("mentira, saca la de 30" vs. "mmm y las de 25"), which
only the model, with the full raw transcript in view, is positioned to do
correctly. A 30kg entry appearing in this list alongside a 25kg entry is
not a design defect -- the model is expected to recognize, from the
transcript it already has, that one is closed and one is not, exactly as it
already correctly narrated the 30kg revocation in its own turn-414
response.

**Not acceptable** (asserts a decision or a status the architecture has no
authority to assign):

```json
{ "status": "pending", "requiredAction": "add_product" }
```

```json
{ "activeObligation": "25kg", "resolved": false }
```

The semantic boundary is exactly: **the evidence names a factual relation
between two already-durable states (observed vs. reflected); it never
names a verb the model should perform, and it never persists a judgment
about whether the relation still matters.**

---

## 6. Assistant open-question linkage

**Design: generalize the already-shipped, already-Harness-aligned
`pendingCatalogAction` pattern, rather than add a new extraction step.**

`pendingCatalogAction` already proves this exact shape works end to end:
the model, at the moment it writes a `respond` step ending in a specific
kind of open question ("¿Quieres que te envíe el link...?"), is *already*
required to tag that question structurally on its own step
(`PENDING_CATALOG_ACTION_RULE_LINES`, rule 6 -- A0 Section 7), and the
runtime carries that tag forward for exactly one turn, self-cleaning,
re-derived every time from the single most recent `agent_tool_loop_completed`
event ([`pendingCatalogAction.ts:260-274`](../../lib/brain/commercial/agent-loop/pendingCatalogAction.ts)).
This is a superior source for "what was the open question about" than
re-parsing the assistant's own free text after the fact, for three reasons:
(a) the model already knows exactly what its own question meant *at the
moment it wrote it* -- capturing that is strictly more reliable than
inferring it later; (b) it requires zero new extraction/NLU logic, only a
generalization of an existing, tested mechanism; (c) it stays entirely
model-authored, preserving "the model remains the decision-maker" for
*whether and how* to flag its own question, exactly as it already does for
link offers.

**Conceptual extension** (schema design deferred to an implementation
slice, Section 21): a sibling concept to `PendingCatalogActionStep`, call
it conceptually `OpenQuestionContinuitySignal`, with the same lifecycle
(model-authored on `respond`, one-turn lookback, self-cleaning) but not
restricted to `send_product_link` -- covering the general shape "my closing
question offered the customer a choice among named next steps" (e.g.
"discos compatibles o despacho"). The *evidence* this exposes to the next
turn is deliberately thin and factual:

```
openQuestionContinuity: { assistantAskedLastTurn: true, awaitingCustomerChoice: true }
```

**Never**: a branching workflow field naming which option was chosen, which
option remains open, or what to do about it. The model resolves "si con
los discos" against its own, already-present, verbatim prior message --
this signal only tells it structurally that resolution is expected, the
same narrow, non-prescriptive role `pendingCatalogAction` already plays for
its one existing case.

**Recomputable from transcript**: yes -- if this signal were deleted, it
could be reconstructed by re-reading the assistant's own most recent
message and confirming (from the same durable `agent_tool_loop_completed`
event payload the model itself wrote it into) that it ended in an
open-choice question. This is exactly `pendingCatalogAction`'s own,
already-proven re-derivation contract, generalized.

---

## 7. `recentCatalogContext` correction -- recency is not relevance

**The task owner's own framing is adopted verbatim as the design
constraint: `recentCatalogContext` stays exactly what it is (a re-derived,
recency/count-windowed evidence cache); what changes is that its
consumers stop being allowed to treat "present in the window" as
"currently relevant."**

**Rejected explicitly**: persisting a `resolved`/`superseded` flag on a
candidate row, modifying `recentCatalogContext`'s own storage or query to
drop "old" candidates outright (this would just move the staleness problem
from "shown as relevant" to "silently evicted, possibly still needed" --
worse, not better, per Section 15's own catalog-result-drift threat), and
any notion of a persisted "active topic."

**Chosen: a separate, freshly-recomputed relevance annotation, computed at
prompt-build time, never stored.** For each interaction already present in
`recentCatalogContext` (unchanged), compute one purely temporal fact
against the same already-durable `crm_capability_executions` ordering
`recentCatalogContext` itself already reads:

```
recentCatalogContext.interactions[i].supersededByNewerDiscovery: boolean
```

Derivation rule: `true` when a *later* discovery-class tool execution
(`search_products`/`explore_catalog`/`recommend_catalog_products`, not
`get_product_details`) exists in the same window for a **disjoint**
product set (no shared `productId` with this interaction). This is a pure,
deterministic, re-derivable-every-time annotation -- delete it and the same
recomputation over the same durable log reproduces it identically. It
never claims the older candidates are *wrong* or *irrelevant to the
customer's real intent* (that remains the model's own judgment, per
Section 5's boundary) -- it only states, factually, that newer, disjoint
discovery activity exists, which is exactly the nudge `RECENT_CATALOG_CONTEXT_RULE_LINES`
(A0 Section 6/8) needs to stop reflexively treating the oldest-but-still-
present candidate as equally authoritative evidence for "which product is
the customer asking about right now."

This directly answers the brief's own three evaluation questions: (a)
**causal recency relative to the latest user reference** is exactly the
signal computed; (b) **old candidates remain visible, annotated as old**,
never hidden or silently dropped; (c) a **separate relevance projection**
(this annotation) is preferred over modifying `recentCatalogContext` itself
-- confirmed the right choice, since it keeps `recentCatalogContext`'s own
contract (an unfiltered recency/count cache, useful for its original
purpose of reference resolution) completely unchanged while adding exactly
the one fact its consumers were missing.

---

## 8. Tool-evidence coverage

Already designed in full as `catalogDiscoveryFreshness` (Section 2.2).
Restated against this section's exact question: **yes**, this is fully
derivable deterministically from already-structured tool-call summaries and
catalog-result evidence (the `crm_capability_executions` ordering, cross-
referenced with `conversation_message`/`commercial_event` ordering for "the
assistant's own last message") -- with zero dependency on knowing *what*
the latest referenced object is. It expresses **"no catalog-discovery tool
call has occurred since your own last message"** and stops there; it never
expresses "therefore call search_products," which remains, as required, a
decision only the model makes.

---

## 9. `select_products` full-replace safety -- pre-consequence evidence check

Full-replace semantics are assumed intentional and are not redesigned here
(consistent with A0/A0.1's own conclusion that this is a deliberate,
documented decision unrelated to the actual defect).

**Boundary chosen: A -- surface discrepancy evidence back to DeepSeek and
allow another reasoning step.** Neither B (deterministically block the
mutation) nor C (execute anyway, unchecked) is compatible with the Harness
constraint this task sets: B substitutes a hardcoded judgment ("this
proposal is wrong") for the model's own reasoning -- exactly the "architecture
decides" failure mode Section 0 forbids; C simply reproduces today's bug.

**Exact boundary, stated precisely (per the task owner's own framing,
adopted as the specification)**:

```
DeepSeek proposes an effect (a use_tool step for select_products/
  set_shipping_destination/select_shipping_option/create_quote)
   -> architecture recomputes the discrepancy evidence (2.1) fresh,
      exactly as it would for the very next provider call
   -> IF the freshly-recomputed evidence is materially different from the
      evidence the model had when it decided this step
      (a new discrepancy appeared, a previously-shown discrepancy was
      resolved by intervening durable state, or the proposal's own item set
      does not correspond to what the discrepancy evidence showed at
      decision time)
      -> discard the proposed step (no execution, no consequence, no
         budget/step cost -- identical treatment to a Boundary-1 staleness
         discard)
      -> re-project evidence fresh
      -> DeepSeek reasons again, from the same loop, same turn
   -> ELSE (evidence unchanged) -> proceed to the Capability Gateway exactly
      as today, unmodified
```

**This is explicitly a freshness check, never a correctness check.** It
never asks "is this a good decision?" -- only "is the evidence this
decision was based on still what it was a moment ago?" If the model, having
seen accurate, unchanged discrepancy evidence, still decides to submit a
selection that leaves 25kg unreflected (for instance, because it correctly
judged the customer had moved on), that decision is never overridden or
second-guessed by this checkpoint. The checkpoint fires only on **evidence
drift**, the same class of event Boundary 1 already exists to catch for
customer messages -- this is that same mechanism, extended to cover
discrepancy evidence drift as well as new-inbound drift, not a new kind of
gate.

**No product-specific validation logic is introduced.** The comparison is
generic over `(productId, combinationId, quantity)` tuples and the same
`catalogEvidenceVsSelection` derivation already defined in Section 2.1 --
nothing here is aware of "dumbbells" or "bars" as concepts.

---

## 10. Pre-action reasoning checkpoint -- composition with Live Turn Assimilation

**Directly analogous to Boundary 1, and this design treats it as a natural
sibling of the exact same mechanism, not a new concept:**

```
Existing (unchanged):
validated AgentStep -> tryAssimilate() [Boundary 1: new inbound?]
  -> if stale: discard, refresh commercialContextSummary(), continue
  -> if fresh: proceed to consequence

New (this design), for mutating steps only, immediately after Boundary 1:
validated AgentStep (mutating) -> recompute catalogEvidenceVsSelection fresh
  -> if materially different from what the model saw when deciding: discard,
     re-project evidence, continue
  -> if unchanged: proceed to Capability Gateway (existing, unmodified)
```

Both checks share the exact same control-flow contract already proven by
`tryAssimilate()` ([`runAgentToolLoop.ts:866-907`](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts)):
a discard never pushes the step, never executes a tool, never returns a
candidate as terminal, and never consumes `decisionIndex`/tool budget -- it
re-enters the same while loop with refreshed context, bounded only by the
existing deadline check, exactly like every other Boundary-1 discard today.

**Is this Harness-aligned? Yes, explicitly, for the same reason Boundary 1
already is**: it never decides *for* the model; it only ensures the model
never acts on evidence that has silently gone stale between the moment it
reasoned and the moment its choice would take effect -- a freshness
guarantee, not a decision. This is the single cleanest way to compose C2
with V1.8.1b-A, since it reuses the exact invalidate-and-continue shape
that mechanism already established and already has crash/race test
coverage for (per A0.1's own file citations).

---

## 11. Ephemeral vs. durable semantic interpretation

**Chosen: ephemeral, for both evidence derivations (2.1, 2.2) and for the
open-question signal (Section 6).** Not chosen by default assumption --
evaluated explicitly:

| | Ephemeral (recomputed every call) | Append-only semantic event | Hybrid |
|---|---|---|---|
| Semantic-state accumulation | None -- nothing durable beyond what already exists | Model interpretation becomes durable evidence; needs correction/supersession semantics not designed here | Only the open-question tag is durable (already true today for `pendingCatalogAction`, one-turn, self-cleaning) |
| Freshness | Always current, by construction | Can go stale relative to newer durable facts unless actively invalidated | Same as ephemeral for the diff, same as append-only (narrowly) for the tag |
| Determinism/replay | Fully deterministic -- same durable inputs always produce the same diff | Deterministic once written, but the *writing* step (if LLM-produced) is not | Deterministic throughout, since no LLM production step exists anywhere in this design |
| Cost/latency | Zero extra provider calls -- pure in-memory computation over data already loaded this turn | An extra provider call per interpretation event, or reuse of the main loop's own output (adds coupling) | Zero extra calls (the tag is authored as part of the model's own existing `respond` step, already happening) |
| Hallucination risk | None -- no LLM involved in producing the diff itself | Real, if an LLM produces the semantic event; the very risk this task explicitly asks to avoid | None for the diff; the open-question tag's only "interpretation" is the model correctly recognizing its own already-decided closing question, the same judgment it already makes for `pendingCatalogAction` |
| Contamination of durable truth | None -- nothing is written that could later be wrong and hard to correct | Real -- a wrong interpretation, once durable, must be explicitly superseded, adding design surface | None -- the tag is exactly as narrow and self-cleaning as `pendingCatalogAction` already is |

**This design compares itself explicitly against DeepSeek Harness Session/
event semantics**: Harness's own append-only session events durably record
*what happened* (a message arrived, a tool ran, a result came back) --
never a durable *interpretation* of what those events mean. This design's
two derivations (2.1, 2.2) are computed the same way Harness computes
`deriveMessages()` output: fresh, from append-only facts, every time,
never themselves persisted as a new kind of fact. The one piece of this
design that *is* durable (the generalized open-question tag) is durable in
exactly the same sense `pendingCatalogAction` already is today -- a
structured echo of something the model *said*, not an interpretation of
what it meant, carried forward for one turn only. This is fully consistent
with, not an exception to, Harness's own append-only-facts-only philosophy.

---

## 12. Derivation pipeline

Smallest correct pipeline, stated in terms of *when* each step runs:

```
ONCE PER TURN (cycle setup, alongside the existing recentCatalogContext/
pendingCatalogAction loads -- no new DB round trip beyond what these two
already make):
  load recentCatalogContext (unchanged)
  load pendingCatalogAction (unchanged)
  load openQuestionContinuity (new, same one-event lookback pattern)
  load fresh commercialContext (unchanged)

PER PROVIDER CALL (gathering phase, every decision slot -- pure, in-memory,
no new I/O beyond what is already loaded this turn or refreshed by
assimilation):
  recompute catalogEvidenceVsSelection from
    (recentCatalogContext + this-turn's toolObservationsThisTurn + fresh commercialLineItems)
  recompute catalogDiscoveryFreshness from
    (recentCatalogContext's own timestamps + this-turn's toolObservationsThisTurn)
  project both, plus openQuestionContinuity, into the dynamic runtime-
    context system message (Section 13)

AFTER TOOL EXECUTION (Boundary 2, unchanged control flow):
  no new step -- the executed tool's own observation already flows into
  toolObservationsThisTurn, which the next provider call's recomputation
  above already picks up for free

AFTER LIVE ASSIMILATION (tryAssimilate(), Boundary 1, extended):
  when new inbound is folded in, refreshCommercialContextSummary() already
  re-reads fresh commercial truth -- this design adds no separate refresh
  hook, since the PER PROVIDER CALL recomputation above already re-derives
  both new fields from whatever commercialContextSummary/toolObservations
  are current at that moment, with zero extra plumbing

BEFORE MUTATION (new Boundary, Section 9/10, siblings to Boundary 1):
  recompute catalogEvidenceVsSelection fresh
  compare against the evidence in effect when this step was decided
  discard-and-continue on material drift; proceed unchanged otherwise

PERSISTED: nothing new. `openQuestionContinuity`'s one-turn tag lives
  inside the existing agent_tool_loop_completed commercial_event payload,
  the exact same durable location pendingCatalogAction already uses.

NEVER PERSISTED: catalogEvidenceVsSelection, catalogDiscoveryFreshness,
  supersededByNewerDiscovery (Section 7) -- all three are recomputed fresh
  every time they are needed and never written anywhere.
```

---

## 13. Message model integration

**Placement: the same dynamic-runtime-context system message C1 already
established** (`buildAgentStepPromptPackage.ts`/
`harnessAlignedMessageProjection.ts`, message `[1]`, "RUNTIME CONTEXT
(system-provided, not authored by the customer)"), as two additional keys
alongside the existing `commercialContext`/`recentCatalogContext`/
`pendingCatalogAction`/`conversationContinuity`:

```
[0] system   stable contract (unchanged)
[1] system   RUNTIME CONTEXT: { currentTime, commercialContext,
              recentCatalogContext (each interaction now also carrying
                supersededByNewerDiscovery, Section 7),
              pendingCatalogAction?, openQuestionContinuity? (new),
              catalogEvidenceVsSelection (new), catalogDiscoveryFreshness (new),
              conversationContinuity }
[2..N] ...historicalMessages (unchanged)
[N+1] user    <raw customer text>, unwrapped (unchanged)
[N+2..] assistant/user causal tool-step pairs (unchanged)
```

**Why this placement and not a new message**: every field this design adds
is, by its own nature, "system-provided, not authored by the customer" --
exactly the category C1's own dynamic-context message already exists to
carry. Introducing a *third* system message, or a synthetic user/tool-
observation message, would (a) violate this task's own explicit instruction
that raw current user text must remain its own, unmixed message, and (b)
add a message-boundary distinction (evidence vs. runtime context) that
serves no causal-ordering purpose -- both are equally "true right now,"
computed at the same moment, for the same reasoning step. The legacy/
persistent-envelope path (flag off) receives the same two new keys inside
its existing trailing JSON object, exactly the way `pendingCatalogAction`
already does today for that path.

**Raw current user remains untouched**: no field, in either message model,
ever merges into or replaces `customerMessage`/the isolated raw `user`
message. This design adds evidence *about* the causal record; it never
touches the causal record itself.

---

## 14. Observability design (specification only, not implemented)

Future operators must be able to reconstruct, without ever logging chain-
of-thought or provider secrets:

- **Raw user references used for evidence derivation**: trivially available
  already -- `conversation_message` remains canonical and untouched; this
  design adds no new "reference" text anywhere (Section 3's whole point).
- **Derived discrepancy evidence presented to the model**: a bounded,
  structured snapshot of `catalogEvidenceVsSelection`/
  `catalogDiscoveryFreshness` as actually projected into a given provider
  call -- small, already-structured, safe to log in full (unlike chain-of-
  thought, this is architecture-authored data, not model reasoning).
- **Model-proposed mutation arguments**: this is A0.1's own confirmed
  observability gap (neither existing event layer currently logs
  `select_products`' input arguments) -- **this design does not silently
  inherit that gap**: the new pre-mutation checkpoint (Section 9/10)
  already has, in memory, exactly the proposed step's arguments at the
  moment it evaluates freshness, which is the natural, cheapest point to
  also durably record them for the first time, closing A0.1's gap as a
  side effect of this design rather than as separate new work.
- **Whether evidence was refreshed before consequence / whether a proposal
  was invalidated and re-reasoned**: a natural byproduct of the new
  Boundary's own discard-and-continue path -- exactly the same `warnings`-
  array discipline `tryAssimilate()`'s own Boundary 1 already uses
  (`agent_loop_open_turn_checkpoint_continue:...`-style bounded warning
  strings), never a new free-text log.
- **Final executed capability arguments / final durable effect**: already
  available today via `select_products`' own observation
  (`{status, items, changed}`, A0 Section 8) -- unchanged.
- **Event-layer provenance**: this design's own new observability points
  must use **exactly one event type/layer**, explicitly to avoid
  reproducing the confusing dual-layer pattern A0.1 documented (Layer A:
  real Capability-Gateway-time execution log; Layer B: a separate, post-hoc
  per-step re-projection from `agent-session/shadowRecorder.ts`). A future
  implementation slice (Section 21) must pick one existing layer (Layer A,
  the real-execution-time log, is the natural fit, since the pre-mutation
  checkpoint runs at exactly that boundary) and must not introduce a third
  parallel event source.

---

## 15. Failure modes

| Threat | Mitigation, consistent with Harness |
|---|---|
| Incorrect semantic extraction | Not applicable by design -- no extraction step exists (Section 3); the only "interpretation" is the model's own self-authored open-question tag, which cannot be "incorrect" about itself |
| Stale extraction after assimilation | Both derivations recompute fresh every provider call from whatever `toolObservationsThisTurn`/`commercialContextSummary` is current at that moment (Section 12) -- there is nothing to go stale, since nothing is cached across the assimilation boundary |
| Contradictory user instructions | Left entirely to the model -- Section 5's boundary means the architecture never adjudicates contradiction, it only shows the same structural fact for every observed-but-unreflected product regardless of whether the customer's words about it were consistent |
| Revoked requests | Section 5 explicitly: a revoked item can appear in `catalogEvidenceVsSelection` exactly like a still-open one; this is by design, not a defect -- the model is trusted, as it already correctly is for narrating revocations today, to read the transcript and know the difference |
| Assistant misstatement | Out of scope -- this design adds no new claim about what the assistant said, only about what tools executed and what durable state shows; an assistant misstatement is a response-generation defect this design neither causes nor fixes |
| Commercial truth changing independently (e.g. an external system updates the opportunity) | `catalogEvidenceVsSelection` is recomputed from a *fresh* `commercialContext` read every time (Section 2.1) -- an independent change is picked up on the very next recomputation, same as `commercialContext` itself already is today |
| Catalog result drift (the Catalog Service returns different data for the same product across calls) | Not newly introduced -- this design compares durable `crm_capability_executions` records already captured at call time, the same source `recentCatalogContext` already trusts; a genuinely drifting catalog is an existing, separate risk this design neither worsens nor is responsible for |
| Stale `recentCatalogContext` (Section 7's own subject) | Directly addressed by `supersededByNewerDiscovery`, a freshly recomputed, non-persisted annotation |
| Over-constraining DeepSeek | Every field is additive and optional-shaped (absent/empty when nothing applies, per the existing discipline `pendingCatalogAction`/`customerPurchaseHistory` already use); nothing new is *required* of the model's response shape |
| Evidence becoming de facto `nextStep` | Guarded structurally by Section 5's semantic boundary and by never including a verb/action/status field anywhere in the design -- every field name and shape in Sections 2/6/7 was chosen specifically to fail this test if it ever crept toward one |
| Repeated semantic reinterpretation changing nondeterministically | Not applicable -- both derivations are pure functions of durable data; the same inputs always produce the same output, unlike an LLM-based extraction step would |
| Long-history cost | Both derivations operate only over `recentCatalogContext`'s already-bounded window (5 interactions / 12 products / 24h) and this turn's own observations -- no full-history scan is introduced |
| Compaction interaction | Addressed fully in Section 16 |

---

## 16. Compaction / persistent session

**Key finding, directly from the existing compaction prompt**
([`compactAgentSessionHistory.ts:20-25`](../../lib/brain/commercial/agent-session/compactAgentSessionHistory.ts)):
compaction is **already instructed** to preserve exactly the kind of
information this design cares about -- *"customer-stated goals,
preferences, constraints, product categories discussed, corrections,
contradictions, topic switches, references likely to matter later,
commitments or statements the assistant made, and unresolved questions"* --
and is **already explicitly forbidden** from summarizing "what the
assistant should do next," "a current intent," "a next step," or "a
workflow stage." This is, independently of this task, already a
Harness-aligned, prose-level preservation of exactly the request/
satisfaction-relevant facts a long conversation would otherwise lose.

**Does C2 need a new compaction invariant? No.** This design's two
derivations (`catalogEvidenceVsSelection`, `catalogDiscoveryFreshness`) are
deliberately scoped to `recentCatalogContext`'s own existing window (5
interactions / 12 products / 24h) and this turn's own observations --
**never to the compacted prefix**. This is a considered scope boundary, not
an oversight: extending structured, deterministic derivation across the
compaction boundary would require either (a) re-deriving structured
evidence from compacted *prose* (unreliable -- prose is not structured data,
and parsing it deterministically reintroduces exactly the regex/keyword
extraction this design rejects in Section 3), or (b) persisting an
obligation ledger that survives compaction (explicitly forbidden by this
task's own brief). Neither is necessary: for anything old enough to have
been compacted away from raw form, the model already relies on -- and this
design does not need to improve -- the *existing*, already-adequate
compaction summary's own prose preservation of "commitments" and
"unresolved questions," read by the model exactly as it already reads any
other historical fact.

**Both confirmed production failures (Case A, Case B) occurred well within
a single, short span of sequential turns (414-434), never across a
compaction boundary** -- this design's scope (the live, uncompacted window)
is sufficient to address both without needing to extend into compacted
history at all.

**Answering the three evaluation questions directly**:
- *Must compacted session evidence preserve customer commitments?* Already
  does, per its own existing prompt -- confirmed, not newly required.
- *Can semantic evidence be included in compaction output?* Not needed --
  this design's evidence is derived fresh from the live window every turn,
  never from the compacted prefix, so there is nothing new for compaction
  to carry.
- *Does current compaction already preserve enough?* Yes, for this design's
  own scope -- and this design deliberately does not ask compaction to do
  more than it already correctly does.
- *Does C2 expose a new compaction invariant?* No new invariant is
  required. The existing invariant ("never summarize what the assistant
  should do next; only what happened") already fully supports this design's
  own boundary (evidence, never decision) without modification.

---

## 17. Harness alignment scorecard

| Design property | Harness aligned? | Why |
|---|---|---|
| Append-only durable facts | Yes | No new durable table; the one durable addition (`openQuestionContinuity`'s tag) reuses the existing `agent_tool_loop_completed` append-only event, the same pattern `pendingCatalogAction` already uses |
| Fresh derivation | Yes | `catalogEvidenceVsSelection`, `catalogDiscoveryFreshness`, and `supersededByNewerDiscovery` are all recomputed every provider call from already-durable/already-fresh sources, never cached across calls |
| Model remains decision-maker | Yes | Every field is descriptive (Section 5's boundary); none names a required action, a topic, or a stage; the pre-mutation checkpoint (Section 9/10) only re-projects evidence and re-prompts, never overrides the model's choice |
| Replayability | Yes | All three ephemeral derivations are pure functions of durable inputs -- replaying the same durable log reproduces identical evidence every time; no LLM-produced interpretation step exists to introduce nondeterminism |
| Crash recovery | Yes | Nothing new is held only in memory across a crash boundary that was not already held that way (the one durable piece, the open-question tag, follows `pendingCatalogAction`'s already-tested crash/reclaim discipline); the pre-mutation checkpoint's discard-and-continue is idempotent and safe to re-run after a crash, exactly like Boundary 1 already is |
| No workflow state | Yes | Confirmed by Section 0's delete-and-re-derive test applied to every field in Sections 2, 6, and 7 -- none fails it |
| Causal ordering | Yes | All evidence is placed in the dynamic-context system message that already sits correctly relative to the causal transcript (Section 13); raw current user text remains untouched and isolated |
| Compaction compatibility | Yes | Scoped deliberately to the live window; relies on, and does not need to extend, the already-adequate existing compaction invariant (Section 16) |
| Governed mutations | Yes | The Capability Gateway, evidence gate, and full-replace semantics for `select_products` are entirely unmodified (Section 9) -- this design only adds a pre-consequence freshness check ahead of the existing, unchanged governance path |

No row fails. The design is not revised or rejected on this basis.

---

## 18. Options considered

### Option 1 -- Deterministic structured-evidence diff + self-tagged open questions (SELECTED)

- **Architecture**: exactly Sections 2, 6, 7, 9, 10 above.
- **Data flow**: durable tool/capability outcomes + fresh commercial truth
  -> pure, in-memory diff/comparison functions, recomputed every provider
  call -> projected into the existing dynamic-context system message.
- **Persistence model**: nothing new except one generalized, already-
  precedented, one-turn, self-cleaning tag (`openQuestionContinuity`),
  stored exactly where `pendingCatalogAction` already is.
- **Model interaction**: purely additive evidence; model behavior, response
  shape, and decision authority are unchanged in kind, only better-informed.
- **Strengths**: zero new provider calls, fully deterministic, fully
  replayable, reuses three already-proven patterns (`resolveObservedRecommendationSourceProduct`'s
  matching logic, `pendingCatalogAction`'s lifecycle, `tryAssimilate()`'s
  discard-and-continue control flow) rather than inventing new ones; closes
  A0.1's `select_products` argument-observability gap as a side effect.
- **Weaknesses**: does not classify *why* an observed-but-unreflected
  product is absent (by design, Section 5) -- a very chatty conversation
  could show several such entries at once, requiring the model to do more
  of its own filtering than a system that pre-classified them would; does
  not cover a reference to a product that was never tool-called and has no
  anchoring open question (Section 3's stated residual limit).
- **Harness alignment**: full (Section 17).
- **Expected effect on Case A**: the model would see, on turn 417's own
  concluding decision and again on turn 420, an explicit
  `catalogEvidenceVsSelection` entry for the 25kg product it had already
  observed -- removing the need to re-derive that fact from unaided
  re-reading of history, and giving turn 420 specifically (where zero fresh
  tool calls occurred) a structural reminder that survives even without a
  new search.
- **Expected effect on Case B**: the model would see, on turns 432/434,
  `openQuestionContinuity.awaitingCustomerChoice: true` plus
  `catalogDiscoveryFreshness.newCatalogDiscoveryCallSinceLastAssistantMessage: false`
  -- a direct, structural signal that its own open question has not yet
  been acted on with any new search, independent of `recentCatalogContext`
  still showing bar candidates.
- **Operational complexity**: low -- two new pure functions, one schema-
  family generalization, one new Boundary sibling to an existing one.

### Option 2 -- LLM-derived ephemeral reference summary

- **Architecture**: a dedicated small provider call each turn, reading the
  recent transcript tail and emitting a structured "customer currently
  wants: [...]" object.
- **Data flow**: transcript -> LLM summarizer -> structured object -> next
  turn's main reasoning call.
- **Persistence model**: none (ephemeral), recomputed every turn.
- **Model interaction**: the main loop's DeepSeek call would trust a
  *different* model's (or the same model's, in a separate, context-poorer
  call) interpretation of the customer's own words, rather than reasoning
  over them directly.
- **Strengths**: could, in principle, generalize beyond what tool calls
  happen to have already resolved (addresses Option 1's stated residual
  limit).
- **Weaknesses**: duplicated, potentially disagreeing reasoning (Section 3);
  real hallucination risk on exactly the kind of ambiguous, colloquial
  phrasing ("mmm y las de 25") this system must handle; nondeterministic
  across replays; an extra provider call every turn, adding cost and
  latency for a fact the main loop's own tool calls frequently already
  produce for free.
- **Harness alignment**: partial -- ephemeral avoids state accumulation,
  but a second interpretation layer with no principled precedence over the
  primary loop's own reasoning is a structural risk this task's own Section
  3 explicitly asks to avoid.
- **Expected effect on Case A/B**: plausibly positive if the extraction is
  accurate, but with a real chance of introducing a *new* class of failure
  (the summarizer itself misreading "las de 25") that this design's chosen
  Option 1 cannot suffer from, since Option 1 never interprets free text.
- **Operational complexity**: medium-high (a new provider integration point,
  new prompt, new failure/retry handling, new cost/latency budget).
- **Rejected**: unnecessary given Option 1 already resolves both confirmed
  cases, and it reintroduces exactly the hallucination/duplication/
  nondeterminism risks Section 3 evaluates against.

### Option 3 -- Durable semantic obligation event log

- **Architecture**: an LLM (or the main loop itself) emits durable,
  append-only "ObligationStated"/"ObligationResolved"/"ObligationRevoked"
  events, persisted and read back in future turns as evidence.
- **Data flow**: transcript -> semantic classifier -> durable event log ->
  future turns' reasoning.
- **Persistence model**: new durable, append-only event type -- genuinely
  append-only in the storage sense, but durable *interpretation*, not
  durable *fact*.
- **Model interaction**: future turns would read a *classification* of past
  intent, not the raw transcript's own words alone.
- **Strengths**: closest, of the three alternatives, to solving the
  Option-1 residual limit (a reference with no anchoring tool call or open
  question) durably rather than only ephemerally.
- **Weaknesses**: this is the design most likely to fail the delete-and-
  re-derive test outright -- an "ObligationStated" event, once persisted, is
  not obviously reconstructible byte-for-byte from durable transcript alone
  if the classifier's own judgment was ambiguous or later shown wrong; it
  requires new correction/supersession semantics (what happens when a later
  turn shows the original classification was wrong?); it is the clearest
  case of "semantic-state creep" this task's own brief warns against,
  despite being technically append-only in storage terms.
- **Harness alignment**: the weakest of the three -- append-only storage
  does not, by itself, satisfy Harness's deeper "derive, do not persist
  interpretation" philosophy (Section 11).
- **Expected effect on Case A/B**: could work, but at the cost of the exact
  kind of durable, hard-to-correct semantic state this entire design effort
  exists to avoid.
- **Operational complexity**: high -- new schema, new correction semantics,
  new classifier integration, new observability for "why does the ledger
  say X."
- **Rejected**: fails the delete-and-re-derive test in the general case;
  not needed given Option 1's sufficiency for both confirmed failures.

### Option 4 -- Hybrid: Option 1 + compaction-time-only obligation summarization

- **Architecture**: Option 1 exactly as designed, plus a proposal to have
  the *existing* compaction LLM call (already running, already producing
  prose) additionally emit a small structured "open commitments" list
  alongside its existing prose summary, for use only in very long
  conversations that have already crossed a compaction boundary.
- **Data flow**: identical to Option 1 for the live window; for the
  compacted prefix, adds a structured side-channel to the existing
  compaction call.
- **Persistence model**: Option 1's, plus one new structured field on the
  already-durable `compacted_prefix_json`.
- **Strengths**: would close Option 1's one deliberately-scoped gap
  (Section 16) for conversations long enough to compact.
- **Weaknesses**: Section 16 already shows the existing compaction prompt's
  *prose* already captures "commitments... unresolved questions" -- adding
  a structured side-channel duplicates what the prose already does, for a
  case (evidence about an obligation surviving a compaction boundary) that
  neither confirmed production failure (Case A, Case B) actually needed,
  since both occurred entirely within the live window.
- **Harness alignment**: same as Option 1 for the live-window portion;
  the compaction side-channel would need its own delete-and-re-derive
  analysis (is a structured list, produced once by an LLM at compaction
  time, re-derivable from the compacted-away raw messages? only as well as
  compaction itself already is, which is to say: approximately, via a fresh
  LLM re-summarization, the same imperfect guarantee compaction's own prose
  already carries) -- not a regression, but not a clear improvement either.
- **Expected effect on Case A/B**: identical to Option 1 (neither case
  crossed a compaction boundary).
- **Operational complexity**: Option 1's, plus a real (if small) compaction-
  prompt change and a new field to validate/test.
- **Rejected, for now**: not combined into the selected design because it
  adds real complexity and a new compaction-prompt change to solve a
  problem (evidence surviving compaction) that Section 16 shows is already
  adequately handled by the *existing* compaction invariant, and that
  neither confirmed production case actually exercises. If a future
  forensic case shows the live-window scope is insufficient (a genuine
  cross-compaction obligation loss), Option 4 is the documented, ready
  extension path -- not implemented speculatively here.

### Selection

**Option 1 is selected.** It is the only option that fully passes Section 0's
delete-and-re-derive test with no caveats, requires no new LLM interpretation
step (eliminating Section 3's hallucination/duplication/nondeterminism
concerns entirely), reuses three already-shipped, already-tested mechanisms
rather than inventing new ones, and is independently sufficient -- confirmed
against the actual production evidence, not merely argued in the abstract --
to address both Case A and Case B.

---

## 19. Recommended C2 design (concrete enough for a later implementation task)

### Component/module boundaries (conceptual -- no code written)

- **`deriveCatalogEvidenceDiscrepancy`** (new, pure function, no I/O).
  Inputs: `recentCatalogContext`, `toolObservationsThisTurn`,
  `commercialLineItems` (from fresh `commercialContext`). Output:
  `catalogEvidenceVsSelection: Array<{ productId, combinationId?, name,
  lastObservedVia, lastObservedTurnsAgo }>` (only the "observed, currently
  absent" case -- the minimal, evidenced shape; a "different quantity"
  variant is a natural, structurally-identical extension left for a later
  slice once evidenced, not built speculatively here). Lives alongside
  `resolveObservedRecommendationSourceProduct.ts`, reusing its own
  evidence-matching logic rather than re-implementing it.
- **`deriveCatalogDiscoveryFreshness`** (new, pure function, no I/O).
  Inputs: `recentCatalogContext` (with its existing per-interaction
  timestamps), the durable ordering of the assistant's most recent message.
  Output: `catalogDiscoveryFreshness: { newCatalogDiscoveryCallSinceLastAssistantMessage: boolean,
  turnsSinceLastCatalogDiscoveryCall: number | null }`.
- **`OpenQuestionContinuitySignal`** (new conceptual type, sibling to
  `PendingCatalogActionStep`). Model-authored on `respond`, one-turn
  lookback via the same `agent_tool_loop_completed` event
  `pendingCatalogAction` already reads, self-cleaning by the same
  most-recent-event-wins rule. Exposed to the next turn as
  `openQuestionContinuity: { assistantAskedLastTurn: boolean,
  awaitingCustomerChoice: boolean }`.
- **`supersededByNewerDiscovery`** (new, computed inline wherever
  `recentCatalogContext` is projected into a prompt -- not a new module,
  an annotation added at projection time only, never touching
  `recentCatalogContext.ts`'s own query/storage logic).
- **New Boundary** (sibling to Boundary 1 in `runAgentToolLoop.ts`),
  conceptually `checkMutationEvidenceFreshness()`, invoked immediately
  after Boundary 1 and only for steps classified `COMMERCIAL_ACTION`
  (reusing the existing `resolveAgentCapabilityExposure` classification,
  never a new one).

### Derivation lifecycle

Exactly Section 12's pipeline: `recentCatalogContext`/`pendingCatalogAction`/
`openQuestionContinuity` load once per turn; `catalogEvidenceVsSelection`/
`catalogDiscoveryFreshness`/`supersededByNewerDiscovery` recompute at every
provider call and are automatically fresh across a Boundary-1 assimilation
refresh with no new plumbing (Section 12).

### Provider projection

Exactly Section 13: two new keys in the existing dynamic-context system
message (harness-aligned mode) or the existing trailing JSON envelope
(legacy/persistent mode); `recentCatalogContext`'s own interactions gain one
new, additive, non-breaking field.

### Tool-loop integration

`deriveCatalogEvidenceDiscrepancy`/`deriveCatalogDiscoveryFreshness` are
called from the same place `buildCommercialContextSummary` already is
(`runNativeAgentToolLoopCycle.ts`), and recomputed again inside
`buildAgentStepPromptPackage`'s own call site for every gathering-phase
decision slot, mirroring exactly how `commercialContextSummary` is already
threaded through.

### Live Assimilation integration

No new refresh hook. Both derivations are recomputed from whatever
`commercialContextSummary`/`toolObservationsThisTurn` is current at the
moment of each provider call -- since `tryAssimilate()` already refreshes
`commercialContextSummary` on new inbound (Boundary 1,
[`runAgentToolLoop.ts:898-904`](../../lib/brain/commercial/agent-loop/runAgentToolLoop.ts)),
the next call's derivation is automatically current, with zero additional
wiring.

### Mutation checkpoint integration

Section 9/10's new Boundary, invoked once per proposed mutating step,
before it reaches `ensureOpportunity`/the Capability Gateway -- discard-and-
continue on evidence drift, proceed unchanged otherwise.

### Observability

Section 14: closes A0.1's `select_products` argument-observability gap as a
side effect (the new Boundary already holds the proposed arguments in
memory at the natural point to also durably record them); all new
observability uses exactly one event layer, explicitly avoiding A0.1's
documented dual-layer confusion.

### Compaction implications

None beyond Section 16's conclusion: no new compaction invariant, no change
to `compactAgentSessionHistory.ts`'s prompt, scope deliberately limited to
the live/uncompacted window.

---

## 20. Validation plan (design only -- no tests written yet)

**A. Exact production regression -- dumbbells.** Reconstruct the real
sequence (10/15/20/25/30 -> revoke 30 -> mention 25 -> add another 5 ->
"vas a agregar las 25 o no") against a controlled provider (deterministic
or live, mirroring C1/C1.1's own methodology). **Assertion**: the prompt
sent to the model at the turn-420-equivalent decision must contain a
`catalogEvidenceVsSelection` entry for the 25kg product. **Explicitly not
asserted**: that the model's own next action adds 25kg -- only that the
evidence was present for it to reason from, per this task's own instruction
("no requirement that architecture itself automatically adds it").

**B. Exact production regression -- bar/discs.** Reconstruct bar
recommendation/link -> assistant asks discs-or-shipping -> "si con los
discos" -> "si". **Assertion**: the prompt sent to the model at the
turn-432-equivalent and turn-434-equivalent decisions must contain
`openQuestionContinuity.awaitingCustomerChoice: true` and
`catalogDiscoveryFreshness.newCatalogDiscoveryCallSinceLastAssistantMessage: false`.
**Explicitly not asserted**: that a `search_products` call for discs is
architecturally forced.

**Additional required scenarios**:
- **Contradictory/revoked request**: customer states, then explicitly
  revokes, a product within the live window -- assert
  `catalogEvidenceVsSelection` still surfaces it factually (per Section 5,
  this is intentional, not a bug) and that no field anywhere classifies it
  as "revoked" or "resolved."
- **New inbound during a mutation proposal**: a customer message arrives
  while a mutating step is mid-flight -- assert the new Boundary (Section
  9/10) and the existing Boundary 1 compose correctly (Boundary 1 fires
  first for the customer-message case; the new Boundary fires for a
  materially-changed discrepancy diff; neither should double-discard the
  same candidate for two different reasons in a way that mis-attributes the
  cause in observability output).
- **Compaction boundary**: a request made before a compaction boundary,
  referenced again after it -- assert the live-window derivations
  correctly show *no* discrepancy evidence for anything already compacted
  away (confirming Section 16's scope boundary is real, not merely
  claimed), and that the model still has access to the compacted prose
  summary exactly as it does today.
- **Stale catalog context**: a product observed many interactions ago, now
  evicted from `recentCatalogContext`'s own 5-interaction/12-product cap --
  assert it correctly does *not* appear in `catalogEvidenceVsSelection`
  (the derivation only ever sees what `recentCatalogContext` itself still
  holds -- this is an accepted, pre-existing limit of the window, not a new
  defect).
- **Independent commercial-state change**: `commercialLineItems` changes
  between two provider calls in the same turn via some path other than this
  turn's own `select_products` call -- assert the next recomputation
  reflects it immediately (Section 15's row on this threat).
- **No-discrepancy normal turn**: a turn with no observed-but-unreflected
  products and no open question pending -- assert both new fields are
  absent/empty, never present-but-trivial (preserving the existing
  "optional field, absent when inert" discipline).
- **Ambiguous customer request where the model should still be allowed to
  ask**: assert nothing in this design forces a tool call or a specific
  response shape -- the model must remain free to ask a clarifying question
  instead of acting on the evidence, with no validation asserting otherwise.

---

## 21. Implementation slicing (not implemented here)

- **`C2-A2`**: `deriveCatalogEvidenceDiscrepancy` +
  `deriveCatalogDiscoveryFreshness` as standalone, pure, unit-tested
  functions -- no wiring into the prompt yet. Independently reversible
  (dead code until wired).
- **`C2-B0`**: wire `catalogEvidenceVsSelection`/`catalogDiscoveryFreshness`
  into the dynamic runtime-context message, behind a new flag; live-
  DeepSeek behavioral benchmark for the Case-A shape (Validation Plan item
  A), mirroring C1/C1.1's own methodology. Reversible via the flag alone.
- **`C2-B1`**: generalize `pendingCatalogAction` into
  `OpenQuestionContinuitySignal` (schema-family extension); wire
  `openQuestionContinuity` into the prompt behind the same or a sibling
  flag; live-DeepSeek behavioral benchmark for the Case-B shape (Validation
  Plan item B). Reversible via its own flag.
- **`C2-B2`**: the pre-mutation freshness checkpoint (Section 9/10), with
  crash/race tests mirroring Live Turn Assimilation's own existing suite
  (`[C1-L3]`-style discrete-message proofs, D7-style atomic-write races).
  Reversible via its own flag, independent of B0/B1.
- **`C2-B3`**: observability -- durable logging of proposed mutation
  arguments at the new Boundary (closing A0.1's gap), using exactly one
  event layer; a short runbook update naming Layer A vs. Layer B
  authoritative-execution-count guidance (A0.1's own recommendation).
  Independently reversible (additive logging only).
- **`C2-B4`** (only if a future forensic case demonstrates the live-window
  scope is insufficient): Option 4's compaction-time structured side-
  channel -- explicitly deferred, not scheduled, pending real evidence of
  need.

Each slice is independently testable and independently reversible via its
own flag, following the exact precedent every prior R3 sub-release in this
family (`V1.8.1b-A`, `V1.8.2-B`, `V1.8.2-C1`) already established.

---

## 22. Documentation

Created:
- This file.
- `docs/ACTIVE_RELEASE.md`, updated in the same change (pointer only, per
  `AGENTS.md`'s mandatory workflow).

No production code, prompt, tool, or schema file was changed by this task.

---

## 23. Final verdict

**`R3_C2_DESIGN_READY`**

Justification against the stated bar: one architecture is selected
(Option 1, Section 18); every field in it passes the delete-and-re-derive
test with no exceptions (Sections 2, 6, 7, and the scorecard in Section 17);
it preserves model decision authority throughout (Section 5's semantic
boundary, enforced in every field definition); it composes explicitly and
concretely with Live Turn Assimilation by extending the exact same
discard-and-continue control flow Boundary 1 already established (Sections
9, 10, 12); it addresses compaction directly, with a reasoned, evidence-
based scope boundary rather than a hand-wave (Section 16); and it
introduces no persistent workflow state anywhere (confirmed by Section 0's
test applied to every candidate concept, and by the explicit hybrid-option
comparison in Section 18 that rejected the two designs -- Options 2 and 3
-- that would have risked it).
