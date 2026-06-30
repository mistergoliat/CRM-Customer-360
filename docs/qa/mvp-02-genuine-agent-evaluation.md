# MVP-02 — Evaluation Report

Evaluation is property-based against varied conversation scenarios, not exact-string matching, per instruction. All tests run against the real local MariaDB (native inbound, `crm_opportunities`, `crm_agent_actions`, `crm_agent_conversation_state`, `crm_agent_turn`) and a deterministic scripted provider (`createScriptedAgentProvider`) -- the loop, tools, policy, and persistence are exercised for real; only the model's *decisions* are scripted, so the test proves the runtime, not a particular model's behavior.

## Commands and results (this session)

```text
npx tsc --noEmit -p tsconfig.json        -> clean, exit 0
npm run lint                              -> 0 errors, 35 warnings (baseline; no new warnings introduced)
npm run build                             -> exit 0
npx tsx --test tests/commercial-agent/*.test.ts   -> 20/20 passing
npx tsx --test <every *.test.ts in the repo>      -> 603/603 passing (583 baseline + 20 new), 0 failures
```

## Property coverage

| Required property | Test | Result |
|---|---|---|
| Multiple formulations of the same goal | `tests/commercial-agent/evaluation.test.ts` -- "two different formulations of the same goal converge on the same opportunity" | pass: same `opportunityId` from two differently-worded restatements |
| Goal change mid-conversation | "the customer changing their goal mid-conversation is reflected, not stuck on the old one" | pass: `state.customerGoal` updates, asserted `!=` the prior value |
| More than one tool used | `loop.test.ts` -- "uses more than one tool in a single turn" | pass: `get_product_detail` + `get_related_products`, both `ok` |
| Asks when information is missing | "denies a tool call with missing required arguments and lets the agent recover" | pass: policy returns `missing_information`, the next scripted call supplies the field and succeeds |
| Recommendations from real catalog data | `loop.test.ts` -- "executes a real tool call..." | pass: response price matches the tool's real fixture price |
| No invented price | `evaluation.test.ts` -- "no price is stated unless a tool actually returned it" | pass: structural check -- every `$` token in the response is cross-referenced against tool outputs, not asserted by string match |
| Multi-turn continuity | `loop.test.ts` -- "maintains continuity across turns" | pass: second turn (fresh `runCommercialAgentTurn` call, fresh provider) sees the first turn's `customerGoal`, `turnCount` reaches 2 |
| Durable commercial action executed | "executes a real tool call..." and the opportunity/follow-up tests | pass: real rows in `crm_opportunities` / `crm_agent_actions`, verified by direct SQL count, not by trusting the tool's return value alone |
| Replay without duplication | "repeating the same opportunity action does not create a duplicate row (idempotent)" | pass: `SELECT COUNT(*) ... = 1` after two calls with the same intent |
| Tool failure with recovery | `evaluation.test.ts` -- "a tool failure (product not found) is recovered from with a useful alternative" | pass: `get_product_detail` errors, the agent's next action is a different tool, turn still finalizes usefully |
| Claim/post-sale handled to the real limit, no auto-block | `loop.test.ts` + `evaluation.test.ts` claim tests | pass: case registered durably, `humanOwnerActive` stays `false`, agent asks for the specific evidence needed |
| Human request without automatic block | "a request to talk to a human does not stop the agent..." | pass: `finalDecision: "respond"`, `humanOwnerActive: false`, response does not contain a transfer-only message |
| Handoff only when it adds value/is necessary | "an exclusive handoff blocks further durable actions but the conversation stays readable" | pass: handoff only happens on an explicit `handoff` decision (the scripted "no progress/risk" case), and even then only blocks `durable_write` tools afterward, not reads |
| Visible state in the HUB | `operationalSummary.test.ts` | pass: `GET`-equivalent read returns `customerGoal`/state plus a factual per-turn narration; asserted the narration never contains the model's raw "thought" string |
| Bounded iterations, safe exit | `loop.test.ts` -- "hitting the iteration limit ends in a safe, honest exit" | pass: `finalDecision: "blocked_no_progress"`, a real (non-empty) message, `max_iterations_reached` warning -- never an infinite loop or a crash |
| Malformed model output recovered, not crashed | "malformed provider output is recovered from instead of crashing the turn" | pass |

## What this evaluation does **not** cover (named, not hidden)

- **No real model was exercised.** `BRAIN_MODEL_API_URL`/`BRAIN_MODEL_API_KEY` are unset in this environment. Every scenario above proves the *runtime's* properties (tool execution, policy, persistence, continuity, safe degradation) hold for any decision sequence a model could produce, including adversarial ones (missing fields, malformed JSON, runaway tool calls) -- it does not prove a specific model will *choose* the right tool/response for a given message. That requires a live `BRAIN_MODEL_API_URL` and a separate, model-specific evaluation pass once credentials exist.
- **No comparison against legacy Zenvia output** was run (no access to Zenvia conversation logs in this repository/session). The metrics module (`computeAgentRuntimeMetrics`) is built so that, once both systems' turns are recorded comparably, `autonomousResolutionRate`/`humanTransferRate`/`toolSuccessRate` can be computed for each and compared -- the comparison itself is not done here.
- **No live WhatsApp send was exercised.** `BRAIN_META_SEND_ENABLED` stays `false`; the agent's response is proven to reach `brain_message_outbox` as a `planned` row (existing, separately-tested send path), not delivered to a real phone.
- **orders/maintenance/post_sales toolsets** have no tools registered, so no evaluation scenario exists for them yet (see product doc, Limitations).

## How to extend this evaluation once a real model is available

1. Set `BRAIN_MODEL_API_URL`/`BRAIN_MODEL_API_KEY`/`BRAIN_MODEL_NAME`.
2. Swap `createScriptedAgentProvider` for `createHttpAgentProvider()` in a copy of these scenarios (same assertions, real model decisions).
3. Add a CSAT/outcome capture point so `positive_csat_rate`/`recontact_rate` in the product brief can be computed from real conversations instead of left out.
