---
title: LLM-R1-T08E - Non-Thinking Tool Budget Experiment
doc_id: release-llm-r1-t08e-nonthinking-tool-budget-experiment
status: implemented
owner: architecture
last_reviewed: 2026-08-17
source_of_truth_for:
  - the isolated maxToolExecutions=3 experiment for C09 under deepseek-v4-flash with thinking=disabled
  - benchmark-only loop budget override wiring
  - benchmark decision-trace contract for tool-budget analysis
  - the T08E causal verdict
depends_on:
  - ./LLM-R1-T08A-provider-deadline-enforcement-fix.md
  - ./LLM-R1-T08B-deepseek-thinking-mode-benchmark.md
  - ./LLM-R1-T08C-nonthinking-tool-execution-repair.md
  - ./LLM-R1-T08D-multi-intent-tool-budget-and-mutation-guard.md
tags:
  - release
  - agent-loop
  - benchmark
  - llm-provider
  - reliability
---

# LLM-R1-T08E - Non-Thinking Tool Budget Experiment

`LLM-R1-T08D` proved that C09 does not intrinsically need more than two tools, but also showed that the live non-thinking model still tends to spend the two-slot budget on the wrong sequence. `T08E` isolates exactly one behavioral variable:

```text
maxToolExecutions:
before = 2
experiment = 3
```

Everything else stays fixed:

- model: `deepseek-v4-flash`
- mode: `thinking=disabled`
- `maxDecisions=3`
- provider deadline / timeout semantics from `T08A`
- prompt package from `T08D`
- Commercial Mutation Execution Guard from `T08D`
- tool implementations and evidence gates
- `recentCatalogContext` semantics
- fixture ground truth and scorer
- production runtime configuration

The experiment was executed on **Monday, August 17, 2026**.

## Hypothesis

If the non-thinking model is not structurally unable to complete C09, but instead wastes its first two tool slots on low-priority reads/prep work, then a benchmark-only increase from `maxToolExecutions=2` to `3` should let it reach `select_products` often enough to cross the reliability gate for C09 without reopening the false-confirmation problem.

This would mean:

> budget 3 is a practical mitigation for non-thinking tool prioritization, not proof that the business flow intrinsically requires three tools.

## Part 1 - Code-path reconstruction

Verified directly from current code, not inferred only from `T08D` prose:

1. `runAgentToolLoop.ts` still defaults to:
   - `DEFAULT_MAX_DECISIONS = 3`
   - `DEFAULT_MAX_TOOL_EXECUTIONS = 2`
   - `DEFAULT_TIMEOUT_MS = 20000`
2. The loop already supported per-invocation overrides for `maxDecisions`, `maxToolExecutions`, and `timeoutMs`; `T08E` reused that existing typed mechanism.
3. Gathering stops at:
   - `decisionIndex < maxDecisions`
   - `toolExecutionCount < maxToolExecutions`
   The loop exits as soon as either budget is exhausted.
4. `maxDecisions` and `maxToolExecutions` are independent:
   - gathering can spend `3` tool decisions with `maxDecisions=3`
   - the final natural-language response can still be produced in finalization, so `tool -> tool -> tool -> respond` is viable with `maxDecisions=3`, provided `maxToolExecutions=3`
5. Budget consumption semantics:
   - blocked unregistered tool: consumes decision budget, not tool budget
   - blocked duplicate tool: consumes decision budget, not tool budget
   - evidence-gate blocked tool: consumes decision budget, not tool budget
   - `invalid_arguments`: consumes decision budget, not tool budget
   - only a tool call that actually executed counts toward `toolExecutionCount`
6. C09 ground truth still requires only:
   - `select_products`
7. C09 prior seeded evidence still includes:
   - recent catalog context for products `31` and `32`
   - confirmed shipping context seed
8. `get_product_details` is still not structurally required for `select_products` in C09:
   - the evidence path is already satisfied by prior `recentCatalogContext`
   - the model still often chooses to re-read details anyway
9. The Commercial Mutation Execution Guard from `T08D` is unchanged:
   - if `select_products` never completed this turn, a completion-style commercial claim is blocked
   - the user gets the fallback clarification message instead of a false confirmation

## Part 2 - Isolated budget override

No global default was changed.

Implementation result:

- production/default loop budget remains `2`
- benchmark harness can call the loop with `maxToolExecutions=3`
- the override is typed and per-run, not environment-global

Code changes:

- `runAgentToolLoop.ts`
  - exported the default loop constants so the harness can report and reuse the exact runtime defaults without hardcoding a second copy
- `benchmark/runCorpus.ts`
  - added `loopOverrides`
  - resolves a benchmark loop configuration and passes it into the real loop
- `benchmark/multiIntent/runMultiIntentCorpus.ts`
  - mirrors the same override/config shape for consistency
- `scripts/benchmark-agent-tool-loop.ts`
  - added `--max-tool-executions=<n>`

Invariant preserved:

```text
Production default maxToolExecutions = 2
Benchmark-only experiment maxToolExecutions = 3
```

## Part 3 - Decision trace observability

Added benchmark-only structured trace output:

- `lib/brain/commercial/agent-loop/benchmark/trace.ts`
- wired into each benchmark result and summary

Per gathering decision, the trace now captures:

- decision index
- tool execution count before the decision
- remaining tool executions
- remaining decisions
- model step type
- selected tool
- tool arguments
- observation status
- observation data status
- observation error code
- governance outcome
- whether the call consumed tool budget
- whether the call was blocked / duplicate / invalid
- per-attempt LLM timing

Per turn, the trace captures:

- ordered tool sequence
- `select_products` attempted/completed
- `set_shipping_destination` attempted
- `get_product_details` attempted
- mutation guard activation
- terminal reason
- warnings
- LLM call count
- tool execution count
- turn latency
- LLM call latencies

No `reasoning_content` is captured or persisted.

## Part 4 - Regression coverage

New or updated regression coverage added and validated:

- `T08E-1`
  - default budget remains `2`
- `T08E-2`
  - explicit `maxToolExecutions=3` allows three successful tool executions
- `T08E-3`
  - `maxDecisions=3` still supports `tool -> tool -> tool -> respond` because finalization owns the closing response
- `T08E-4`
  - mutation guard still blocks an unbacked claim with budget `3`
- `T08E-5`
  - a completed `select_products` still allows the backed confirmation with budget `3`
- `T08E-6`
  - duplicate protection unchanged
- `T08E-7`
  - deadline/timeout behavior from `T08A` unchanged (`httpAgentLoopProvider.test.ts` remained green)
- `T08E-8`
  - prompt package unchanged (`buildAgentStepPromptPackage.test.ts` remained green, including exact/golden checks)
- `T08E-9`
  - production thinking wiring unchanged by `T08E`
  - the legacy/non-allowlisted path still omits `thinking`
  - the only current production `thinking: "disabled"` path remains the pre-existing allowlisted multi-intent exception in `runNativeAutonomousCycle.ts`

Also added a harness-specific regression:

- benchmark harness default budget remains `2`
- benchmark-only override reaches the third tool
- no prompt or fixture change was needed to prove the wiring

## Part 5 - Focused live benchmark: C09 only

Configuration:

```text
date: 2026-08-17
model: deepseek-v4-flash
thinking: disabled
case: C09
runs: 20
maxToolExecutions: 3
maxDecisions: 3
timeoutMs: 20000
```

### Raw focused benchmark results

| Run | Sequence | `select_products` attempted | `select_products` completed | Guard | Turn ms |
|---|---|---:|---:|---:|---:|
| 0 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 7872 |
| 1 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 6293 |
| 2 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 5739 |
| 3 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 6175 |
| 4 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 5379 |
| 5 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 5873 |
| 6 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 5659 |
| 7 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 5813 |
| 8 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 6162 |
| 9 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 6114 |
| 10 | `get_product_details -> get_product_details -> set_shipping_destination` | no | no | yes | 6471 |
| 11 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 5425 |
| 12 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 6180 |
| 13 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 5706 |
| 14 | `get_product_details -> select_products -> set_shipping_destination` | yes | yes | no | 5755 |
| 15 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 5445 |
| 16 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 5957 |
| 17 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 5420 |
| 18 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 6326 |
| 19 | `get_product_details -> set_shipping_destination -> select_products` | yes | yes | no | 6026 |

### Focused metrics

- `select_products` attempt rate: `95.0%` (`19/20`)
- `select_products` completion rate: `95.0%` (`19/20`)
- `unbackedCommercialMutationClaimRate`: `0.0%`
- mutation guard activation rate: `5.0%` (`1/20`)
- timeout rate: `0.0%`
- structured failure rate: `0.0%`
- terminalReason correctness: `100.0%`
- tool selection accuracy (`requiredToolCompletionRate` for C09 ground truth): `95.0%`
- tool argument accuracy: `95.0%`

### Sequence distribution

- `get_product_details -> set_shipping_destination -> select_products`: `18/20` (`90.0%`)
- `get_product_details -> select_products -> set_shipping_destination`: `1/20` (`5.0%`)
- `get_product_details -> get_product_details -> set_shipping_destination`: `1/20` (`5.0%`)

### Latency / call-count impact

- LLM calls/turn:
  - avg=`4.00`
  - p50=`4`
  - p95=`4`
  - max=`4`
- actual tool executions/turn:
  - avg=`3.00`
  - p50=`3`
  - p95=`3`
  - max=`3`
- LLM latency:
  - p50=`1472ms`
  - p95=`1897ms`
  - max=`2101ms`
- turn latency:
  - p50=`5873ms`
  - p95=`6471ms`
  - max=`7872ms`

## Part 6 - Causal classification

Focused C09 result:

```text
completion = 95%
unbacked claims = 0%
timeout = 0%
```

This crosses the task's reliability gate.

Classification: **Case A - budget=3 solves it**.

Dominant mechanism:

**A1** dominates.

Observed interpretation:

- in `18/20` runs, the model still used the first two slots on:
  - `get_product_details`
  - `set_shipping_destination`
- the third slot then allowed:
  - `select_products`

That means:

> The increased budget is a practical compensation for non-thinking tool prioritization, not proof that the business flow intrinsically requires three tools.

Only `1/20` runs showed earlier reprioritization (`get_product_details -> select_products -> set_shipping_destination`).

## Part 7 - Failed trace taxonomy for C09

There was exactly one failed run under budget `3`.

Taxonomy:

- `F1` - `select_products` never attempted because other tools consumed all budget: `1/20` (`5.0%`)
- `F2`: `0`
- `F3`: `0`
- `F4`: `0`
- `F5`: `0`
- `F6`: `0`
- `F7`: `0`
- `F8`: `0`
- `F9`: `0`
- `F10`: `0`

Failure trace summary:

- sequence:
  - `get_product_details -> get_product_details -> set_shipping_destination`
- no `select_products` attempt
- mutation guard activated
- final response corrected to the guard fallback
- no timeout
- no structured/provider failure

## Part 8 - C02/C04 regression check

Because C09 crossed the gate, `C02` and `C04` were rerun:

```text
model: deepseek-v4-flash
thinking: disabled
maxToolExecutions: 3
runs: 10 each
date: 2026-08-17
```

Results:

- `C02`
  - completion: `100%`
  - unbacked claims: `0%`
  - timeout: `0%`
  - actual tool executions/turn avg: `2.0`
  - LLM calls/turn avg: `3.0`
- `C04`
  - completion: `100%`
  - unbacked claims: `0%`
  - timeout: `0%`
  - actual tool executions/turn avg: `1.0`
  - LLM calls/turn avg: `2.0`

Combined latency/call counts (`C02` + `C04`, 20 runs):

- LLM calls/turn:
  - avg=`2.50`
  - p50=`2`
  - p95=`3`
  - max=`3`
- actual tool executions/turn:
  - avg=`1.50`
  - p50=`1`
  - p95=`2`
  - max=`2`
- LLM latency:
  - p50=`1494ms`
  - p95=`1841ms`
  - max=`2103ms`
- turn latency:
  - p50=`3964ms`
  - p95=`4680ms`
  - max=`4720ms`

Interpretation:

- allowing a third tool did **not** force wasteful three-tool behavior in cases already working
- realized tool count remained below the ceiling when the case did not need more

## Part 9 - Full corpus (`C01-C12`, 10 runs/case)

Because `C02`, `C04`, and `C09` all cleared the gate, the full corpus was executed:

```text
cases: C01-C12
runsPerCase: 10
model: deepseek-v4-flash
thinking: disabled
maxToolExecutions: 3
date: 2026-08-17
```

### Aggregate full-corpus metrics

- successful turn / overall pass rate: `76.7%`
- required tool completion rate: `99.2%`
- tool selection accuracy: `99.2%`
- tool argument accuracy: `99.2%`
- terminal reason correctness: `91.7%`
- forbidden tool invocation rate: `0.0%`
- unbackedCommercialMutationClaimRate: `0.0%`
- mutation guard activation rate: `0.83%` (`1/120`)
- structured failure rate: `0.0%`
- empty response rate: `0.0%`
- invalid model JSON rate: `0.0%`
- schema failure rate: `0.0%`
- timeout turn rate: `0.0%`
- LLM calls/turn:
  - avg=`2.35`
  - max=`4`
- actual tool executions/turn:
  - avg=`1.30`
  - max=`3`
- LLM latency:
  - p50=`1684ms`
  - p95=`2254ms`
  - max=`2848ms`
- turn latency:
  - p50=`3960ms`
  - p95=`7040ms`
  - max=`9444ms`

### Full-corpus failures observed

Failures by case:

- `C07`: `7/10`
  - note: expected a controlled tool failure (`failed/blocked observation`) that the live model did not actually produce
  - the turns still used the required tools, had correct arguments, and preserved the expected terminal reason
- `C09`: `1/10`
  - same `F1` pattern seen above
- `C11`: `10/10`
  - note: expected a structured provider failure (`invalid_response`) that was not observed in live mode
- `C12`: `10/10`
  - note: expected `provider_unavailable` / structured failure, but the live model returned a normal response instead

### Interpretation of the full-corpus result

Important distinction:

- `C09`, the target case of `T08E`, improved from the `T08D` live result of `10%` completion to `95%` in the focused 20-run experiment
- the full-corpus `overallPassRate` is dragged down mainly by `C07`, `C11`, and `C12`

Observed inference:

- `C11` and `C12` are structured-failure expectation cases whose live runs did not reproduce the offline failure modes
- `C07` failed its controlled-failure expectation, but not due to unbacked commercial mutation, timeout, or tool-budget exhaustion
- no new safety regression attributable to `maxToolExecutions=3` was observed

That means the full-corpus run does **not** refute the focused C09 result, but it also does **not** support a blanket production switch without acknowledging those non-C09 live benchmark mismatches.

## Production impact

Production thinking configuration changed:

```text
NO
```

Production default `maxToolExecutions` changed:

```text
NO
```

Clarification of the current production state as of **August 17, 2026**:

- `T08E` did not introduce any production `thinking` override
- the legacy / non-allowlisted path still omits `thinking`
- `runNativeAutonomousCycle.ts` already contained a pre-existing allowlisted multi-intent exception that conditionally sets `thinking: "disabled"`; that exception is not introduced by `T08E`

## Final verdict

Verdict:

```text
BUDGET_3_SOLVES_C09
```

Why:

- focused C09 gate passed (`95%` completion, `0%` unbacked, `0%` timeout)
- C02/C04 showed no regression
- no critical safety regression attributable to budget 3 was observed in the full-corpus run

But the causal interpretation must stay narrow:

> Budget 3 is an effective operational mitigation for C09 under deepseek-v4-flash with thinking=disabled, because it gives the model a third chance to reach select_products after spending the first two slots on lower-priority tools. This is not evidence that the business flow itself intrinsically requires three tools.

## Next task

Recommended next task:

1. Decide whether to run a production-configuration follow-up that switches the non-thinking benchmark path from budget `2` to budget `3`, or keep it benchmark-only until the full-corpus non-C09 live mismatches (`C07/C11/C12`) are explicitly triaged.
2. If production adoption is considered, document the distinction between:
   - focused C09 mitigation success
   - unrelated/live-scorer expectation mismatches outside the target case
3. If the team wants to keep budget `2` in production, the next architectural path remains deterministic reservation/prioritization of mutation capacity rather than open-ended budget growth.

## Files changed

- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts`
  - exported loop defaults for shared runtime/benchmark use
- `lib/brain/commercial/agent-loop/benchmark/runCorpus.ts`
  - added benchmark loop override/config wiring
- `lib/brain/commercial/agent-loop/benchmark/multiIntent/runMultiIntentCorpus.ts`
  - mirrored the same config contract
- `lib/brain/commercial/agent-loop/benchmark/types.ts`
  - added loop config and trace types
- `lib/brain/commercial/agent-loop/benchmark/trace.ts`
  - new structured decision-trace builder
- `scripts/benchmark-agent-tool-loop.ts`
  - added `--max-tool-executions`
- `tests/agent-loop/runAgentToolLoop.test.ts`
  - `T08E-1` through `T08E-6`
- `tests/agent-loop/benchmark/offlineHarnessEndToEnd.test.ts`
  - benchmark wiring regression
- `tests/agent-loop/benchmark/trace.test.ts`
  - trace-specific regression
- `tests/agent-loop/httpAgentLoopProvider.test.ts`
  - clarified HP31 wording to match the current production state
- `tests/agent-loop/runNativeAgentToolLoopCycleConfig.test.ts`
  - `T08E-9`
- `docs/releases/LLM-R1-T08E-nonthinking-tool-budget-experiment.md`
  - this document

## Validation executed

- `npx tsc --noEmit`
- `npm run build`
- `npx tsx --test tests/agent-loop/runAgentToolLoop.test.ts`
- `npx tsx --test tests/agent-loop/benchmark/offlineHarnessEndToEnd.test.ts tests/agent-loop/benchmark/metrics.test.ts tests/agent-loop/benchmark/providers.test.ts tests/agent-loop/benchmark/safetyIsolation.test.ts tests/agent-loop/benchmark/trace.test.ts`
- `npx tsx --test tests/agent-loop/httpAgentLoopProvider.test.ts tests/agent-loop/runNativeAgentToolLoopCycleConfig.test.ts`
- `npx tsx --test tests/agent-loop/buildAgentStepPromptPackage.test.ts`
- `npx tsx --test tests/agent-loop/benchmark/liveGate.test.ts`
- live benchmark:
  - `C09 x20`
  - `C02 x10`
  - `C04 x10`
  - `C01-C12 x10`

---

```text
LLM-R1-T08E: DONE

Model:
deepseek-v4-flash

Mode:
thinking=disabled

C09 runs:
20

Tool budget before:
2

Tool budget experiment:
3

C09 select_products attempt rate:
95.0%

C09 select_products completion:
95.0%

C09 unbacked mutation claim rate:
0.0%

C09 mutation guard activation rate:
5.0%

C09 timeout rate:
0.0%

Dominant tool sequence:
get_product_details -> set_shipping_destination -> select_products

Failed run taxonomy:
F1=1 (5.0%)
F2=0
F3=0
F4=0
F5=0
F6=0
F7=0
F8=0
F9=0
F10=0

C09 LLM latency:
p50=1472ms
p95=1897ms
max=2101ms

C09 turn latency:
p50=5873ms
p95=6471ms
max=7872ms

C09 LLM calls/turn:
avg=4.00
max=4

C09 actual tool executions/turn:
avg=3.00
max=3

C02 regression:
PASS

C04 regression:
PASS

Full corpus:
FAIL

Production thinking configuration changed:
NO

Production default maxToolExecutions changed:
NO

Verdict:
BUDGET_3_SOLVES_C09

Next:
Decide separately whether to promote budget 3 beyond the benchmark path, after triaging the non-C09 live corpus mismatches (C07/C11/C12) that were not safety regressions and did not negate the focused C09 result.
```
