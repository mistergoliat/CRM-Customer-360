import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRun, compareVariants, computePromptStats, computeVariantMetrics, selectionIsCorrupt, type AbRunRecord } from "@/lib/brain/commercial/agent-loop/benchmark/r3AutonomousAB/analysis";
import { resolveBenchmarkE2EFlags } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/runCommercialE2ECase";
import { AB_VARIANTS, diffVariantFlags, resolveVariantFlags, type AbVariantId } from "@/lib/brain/commercial/agent-loop/benchmark/r3AutonomousAB/variants";
import type { BenchmarkE2EDurableStateSnapshot, BenchmarkE2EToolInvocationTrace, BenchmarkE2ETurnTrace } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/types";

/**
 * SALES-AGENT-R3-P7.8. Pure tests over synthetic traces: taxonomy (section
 * 26), metrics/denominators (K), negative controls (L), harness failures and
 * the architecture-signal rule (section 31).
 */

function inv(capability: string, stepIndex: number, status = "completed", gatewayStatus: string | null = "completed", errorCode: string | null = null): BenchmarkE2EToolInvocationTrace {
  return {
    stepIndex,
    capability,
    workId: null,
    workVersion: null,
    objectiveId: null,
    objectiveType: null,
    eligibilityAtTurnStart: null,
    gateway: gatewayStatus === null ? null : { status: gatewayStatus, errorCode, retryable: false },
    toolObservation: { status, errorCode, retryable: false },
    inTurnEvidence: { relevantEvidenceProduced: [], blockerPotentiallyChanged: false, potentiallyAffectedReasonCodes: [] }
  };
}

function state(items: { productId: string; quantity: number }[] = [], extra: Partial<BenchmarkE2EDurableStateSnapshot> = {}): BenchmarkE2EDurableStateSnapshot {
  return {
    capturedAt: "2026-09-21T00:00:00.000Z",
    workId: "w",
    workVersion: 1,
    workStatus: "ACTIVE",
    objectiveType: null,
    objectiveStatus: null,
    selection: { present: items.length > 0, freshness: items.length > 0 ? "CURRENT" : null, itemCount: items.length > 0 ? items.length : null, items },
    destination: { present: false, freshness: null, communeId: null },
    shipping: { present: false, freshness: null },
    quote: { present: false, freshness: null, quoteId: null, quoteStatus: null },
    identityLevel: "LEVEL_0_ANONYMOUS",
    ...extra
  };
}

function turn(input: { ordinal?: number; invocations?: BenchmarkE2EToolInvocationTrace[]; message?: string; terminalReason?: BenchmarkE2ETurnTrace["response"]["terminalReason"]; before?: BenchmarkE2EDurableStateSnapshot; after?: BenchmarkE2EDurableStateSnapshot; elapsed?: number }): BenchmarkE2ETurnTrace {
  return {
    turnOrdinal: input.ordinal ?? 0,
    inboundMessageId: "m",
    correlationId: "c",
    customerMessage: "x",
    durableStateBeforeTurn: input.before ?? state(),
    kernel: null,
    toolInvocations: input.invocations ?? [],
    proposal: null,
    objectiveReconciliation: { decided: null, reconciled: null },
    eligibilityShadow: null,
    response: { status: "responded", terminalReason: input.terminalReason ?? "responded", finalMessage: input.message ?? "Listo.", handoffReason: null, toolExecutionCount: input.invocations?.length ?? 0 },
    runtimeWarnings: [],
    outbox: { attempted: true, outboxWritten: true, outboxId: 1, status: "pending", messageTextPresent: true },
    durableStateAfterTurn: input.after ?? state(),
    providerCalls: [
      { caseId: "x", runIndex: 0, callIndex: 0, elapsedMs: input.elapsed ?? 1000, outcome: "success", errorCode: null, finishReason: "stop", inputTokens: 100, outputTokens: 10, reasoningTokens: 0, providerRequestId: null, model: "m" }
    ]
  };
}

const baseFlags = resolveBenchmarkE2EFlags();

function record(variant: AbVariantId, caseId: string, turns: BenchmarkE2ETurnTrace[], opts: { run?: number; negative?: boolean; expectations?: Record<string, boolean | null> } = {}): AbRunRecord {
  return {
    pairId: `${caseId}-r${opts.run ?? 0}`,
    variant,
    caseId,
    runOrdinal: opts.run ?? 0,
    sequenceIndex: 0,
    firstInPair: true,
    isNegativeControl: opts.negative ?? caseId.startsWith("N"),
    trace: {
      benchmarkRunId: "b",
      caseId,
      runOrdinal: opts.run ?? 0,
      executionMode: "HYBRID",
      startedAt: "",
      finishedAt: "",
      initialState: state(),
      turns,
      finalState: turns[turns.length - 1]?.durableStateAfterTurn ?? null,
      outcome: { status: "PASS", expectationResults: opts.expectations ?? {}, forbiddenViolations: [], failure: null }
    },
    harnessError: null,
    runConfig: { variant, model: "m", temperature: 0, thinking: "disabled", timeoutMs: 60000, maxOutputTokens: 4000, maxModelRetries: 5, maxDecisions: 3, maxToolExecutions: 2, promptVersion: AB_VARIANTS[variant].promptVersion, promptSha256: "h", eligibilityInfluencedCognition: AB_VARIANTS[variant].cognition.eligibilityInfluencedCognition, flags: resolveVariantFlags(baseFlags, variant) },
    promptStats: { systemPromptChars: variant === "A_HYBRID" ? 30000 : 3000, systemPromptApproxTokens: 1, policyLineCount: variant === "A_HYBRID" ? 120 : 15, toolCatalogChars: 5000, providerCallCount: 1 }
  };
}

const first = (r: AbRunRecord, turnOrdinal = 0) => analyzeRun(r).find((analysis) => analysis.turnOrdinal === turnOrdinal)!;

// ---- taxonomy ----------------------------------------------------------------

test("P7.8: grounded + respond without select_products is NO_COMMIT_AFTER_GROUNDING (E02, quantity not stated)", () => {
  const analysis = first(record("A_HYBRID", "E02", [turn({ invocations: [inv("get_product_details", 0)], message: "¿Quieres que te envíe el link para revisarlo?" })]));
  assert.equal(analysis.grounded, true);
  assert.equal(analysis.commitAttemptedAfterGrounding, false);
  assert.equal(analysis.category, "NO_COMMIT_AFTER_GROUNDING");
});

test("P7.8-17: asking for a missing quantity when quantity was NOT stated is not penalized as unnecessary confirmation", () => {
  const analysis = first(record("A_HYBRID", "E02", [turn({ invocations: [inv("get_product_details", 0)], message: "¿Cuántas unidades necesitas?" })]));
  assert.equal(analysis.askedForQuantity, true);
  assert.equal(analysis.unnecessaryConfirmation, false);
  assert.notEqual(analysis.category, "UNNECESSARY_CONFIRMATION");
});

test("P7.8-17: asking a question when quantity WAS stated (E04 t0: 'una barra') is UNNECESSARY_CONFIRMATION", () => {
  const analysis = first(record("A_HYBRID", "E04", [turn({ invocations: [inv("get_product_details", 0)], message: "¿Quieres que la agregue a tu selección?" })]));
  assert.equal(analysis.category, "UNNECESSARY_CONFIRMATION");
  assert.equal(analysis.unnecessaryConfirmation, true);
});

test("P7.8: grounded then select_products completed with the stated quantity is COMMIT_SUCCESS and a durable commit", () => {
  const analysis = first(record("B_AUTONOMOUS", "E04", [turn({ invocations: [inv("get_product_details", 0), inv("select_products", 1)], after: state([{ productId: "31", quantity: 1 }]) })]));
  assert.equal(analysis.category, "COMMIT_SUCCESS");
  assert.equal(analysis.commitAttemptedAfterGrounding, true);
  assert.equal(analysis.commitCompletedAfterGrounding, true);
  assert.equal(analysis.durableCommitAfterGrounding, true);
});

test("P7.8: durable quantity different from the stated one is WRONG_QUANTITY", () => {
  const analysis = first(record("B_AUTONOMOUS", "E04", [turn({ invocations: [inv("get_product_details", 0), inv("select_products", 1)], after: state([{ productId: "31", quantity: 3 }]) })]));
  assert.equal(analysis.category, "WRONG_QUANTITY");
  assert.equal(analysis.wrongQuantity, true);
});

test("P7.8-14: attempted-but-rejected select_products counts as attempted, NOT as durable commit (model requested, Gateway/domain failed)", () => {
  const analysis = first(record("A_HYBRID", "E02", [turn({ invocations: [inv("get_product_details", 0), inv("select_products", 1, "blocked", "blocked", "opportunity_unavailable")] })]));
  assert.equal(analysis.commitAttemptedAfterGrounding, true);
  assert.equal(analysis.commitCompletedAfterGrounding, false);
  assert.equal(analysis.durableCommitAfterGrounding, false);
  assert.equal(analysis.category, "GATEWAY_REJECTION");
});

test("P7.8: select_products BEFORE grounding is not 'after grounding' for the primary metric but is caught by the fixed cohort", () => {
  const r = record("B_AUTONOMOUS", "E02", [turn({ invocations: [inv("select_products", 0), inv("get_product_details", 1)], after: state([{ productId: "31", quantity: 1 }]) })]);
  const analysis = first(r);
  assert.equal(analysis.commitAttemptedAfterGrounding, false);
  assert.equal(analysis.selectAttempted, true);
  assert.equal(computeVariantMetrics("B_AUTONOMOUS", [r]).fixedCohort.selectProductsAttempted.rate, 1);
});

test("P7.8: timeout, dependency and loop-governor reasons; AUTONOMOUS_LOOP_FAILURE only for B", () => {
  assert.equal(first(record("A_HYBRID", "E02", [turn({ terminalReason: "timeout" })])).category, "TIMEOUT");
  assert.equal(first(record("A_HYBRID", "E02", [turn({ terminalReason: "provider_unavailable" })])).category, "DEPENDENCY");
  assert.equal(first(record("A_HYBRID", "E02", [turn({ invocations: [inv("create_quote", 0, "failed", "failed", "quote_service_not_configured")] })])).category, "DEPENDENCY");
  assert.equal(first(record("B_AUTONOMOUS", "E02", [turn({ terminalReason: "no_progress" })])).category, "AUTONOMOUS_LOOP_FAILURE");
  assert.equal(first(record("A_HYBRID", "E02", [turn({ terminalReason: "no_progress" })])).category, "OTHER");
});

test("P7.8: a turn ended by unparseable model JSON (invalid_response) is a model output-format failure, never DEPENDENCY; and the call-level rate is reported", () => {
  const failed = turn({ invocations: [inv("get_product_details", 0)], terminalReason: "provider_unavailable", message: "" });
  failed.runtimeWarnings = ["agent_loop_provider_error:invalid_response", "agent_loop_structured_recovery_attempted:gathering", "agent_loop_provider_error:invalid_response"];
  failed.providerCalls = [
    { ...failed.providerCalls[0], outcome: "success" },
    { ...failed.providerCalls[0], callIndex: 1, outcome: "invalid_response", errorCode: "invalid_model_json" },
    { ...failed.providerCalls[0], callIndex: 2, outcome: "invalid_response", errorCode: "invalid_model_json" }
  ];
  const b = record("B_AUTONOMOUS", "E02", [failed]);
  const a = record("A_HYBRID", "E02", [failed]);
  assert.equal(first(b).category, "AUTONOMOUS_LOOP_FAILURE");
  assert.equal(first(a).category, "OTHER");
  const metrics = computeVariantMetrics("B_AUTONOMOUS", [b]);
  assert.equal(metrics.behavior.turnsEndedByInvalidResponse, 1);
  assert.equal(metrics.behavior.providerInvalidResponseCalls.numerator, 2);
  assert.equal(metrics.behavior.providerInvalidResponseCalls.denominator, 3);
  // a genuine dependency outage (no invalid_response warning) stays DEPENDENCY
  assert.equal(first(record("B_AUTONOMOUS", "E02", [turn({ terminalReason: "provider_unavailable" })])).category, "DEPENDENCY");
});

test("P7.8: durable selection corruption (unknown product / duplicate / non-positive quantity) is SELECTION_CORRUPTION", () => {
  assert.equal(selectionIsCorrupt([{ productId: "99", quantity: 1 }]), true);
  assert.equal(selectionIsCorrupt([{ productId: "31", quantity: 1 }, { productId: "31", quantity: 2 }]), true);
  assert.equal(selectionIsCorrupt([{ productId: "31", quantity: 0 }]), true);
  assert.equal(selectionIsCorrupt([{ productId: "31", quantity: 2 }, { productId: "32", quantity: 1 }]), false);
  assert.equal(first(record("B_AUTONOMOUS", "E02", [turn({ after: state([{ productId: "99", quantity: 1 }]) })])).category, "SELECTION_CORRUPTION");
});

test("P7.8-19: E14 t1 counts a create_quote REQUEST as progression for the taxonomy (Quote Service is BLOCKED locally); primary metric stays select_products", () => {
  const r = record("A_HYBRID", "E14", [turn({ invocations: [] }), turn({ ordinal: 1, invocations: [inv("create_quote", 0, "failed", "failed", "quote_service_not_configured")] })]);
  const t1 = first(r, 1);
  assert.equal(t1.category, "COMMIT_SUCCESS");
  assert.equal(t1.selectAttempted, false);
});

test("P7.8-18: E05 t1 is flagged as a harness limitation and the sensitivity metric excludes it", () => {
  const grounded = (ordinal: number, commit: boolean) => turn({ ordinal, invocations: commit ? [inv("get_product_details", 0), inv("select_products", 1)] : [inv("get_product_details", 0)], after: commit ? state([{ productId: "32", quantity: 1 }]) : state() });
  const r = record("A_HYBRID", "E05", [grounded(0, false), grounded(1, true)]);
  assert.equal(first(r, 1).harnessLimitation?.startsWith("E05_T1"), true);
  const m = computeVariantMetrics("A_HYBRID", [r]);
  assert.equal(m.primary.commitAfterGroundingRate.denominator, 2);
  assert.equal(m.primary.excludingHarnessLimitation.commitAfterGroundingRate.denominator, 1);
  assert.equal(m.primary.excludingHarnessLimitation.commitAfterGroundingRate.rate, 0);
});

test("P7.8: a run that threw is a HARNESS_FAILURE, counted separately and excluded from every rate denominator", () => {
  const base = record("B_AUTONOMOUS", "E02", []);
  const broken: AbRunRecord = { ...base, trace: null, harnessError: "boom" };
  const analyses = analyzeRun(broken);
  assert.equal(analyses[0].category, "HARNESS_FAILURE");
  assert.equal(analyses[0].executed, false);
  const m = computeVariantMetrics("B_AUTONOMOUS", [broken]);
  assert.equal(m.harnessFailures, 1);
  assert.equal(m.primary.explicitPurchaseTurns, 0);
  assert.equal(m.primary.commitAfterGroundingRate.rate, null);
});

// ---- L: negative controls ------------------------------------------------------

test("P7.8-L: informational turns - any commercial mutation request is OVER_MUTATION; a clean answer is INFORMATIONAL_OK", () => {
  const clean = first(record("B_AUTONOMOUS", "N01", [turn({ invocations: [inv("get_product_details", 0)], message: "Cuesta $89.990." })]));
  assert.equal(clean.category, "INFORMATIONAL_OK");
  for (const capability of ["select_products", "set_shipping_destination", "create_quote"]) {
    const dirty = first(record("B_AUTONOMOUS", "N02", [turn({ invocations: [inv("get_product_details", 0), inv(capability, 1, "blocked", "blocked")] })]));
    assert.equal(dirty.category, "OVER_MUTATION", capability);
  }
  // a read-only calculate_shipping is not one of the mutation set
  assert.equal(first(record("B_AUTONOMOUS", "N03", [turn({ invocations: [inv("calculate_shipping", 0)] })])).category, "INFORMATIONAL_OK");
});

test("P7.8-L: overMutationRate and its durable variant use the informational-turn denominator only", () => {
  const records = [
    record("B_AUTONOMOUS", "N01", [turn({ invocations: [] })], { run: 0 }),
    record("B_AUTONOMOUS", "N01", [turn({ invocations: [inv("select_products", 0)], after: state([{ productId: "31", quantity: 1 }]) })], { run: 1 }),
    record("B_AUTONOMOUS", "E02", [turn({ invocations: [inv("get_product_details", 0), inv("select_products", 1)], after: state([{ productId: "31", quantity: 1 }]) })])
  ];
  const m = computeVariantMetrics("B_AUTONOMOUS", records);
  assert.equal(m.negativeControls.informationalTurns, 2);
  assert.equal(m.negativeControls.overMutation.rate, 0.5);
  assert.equal(m.negativeControls.overMutationDurable.rate, 0.5);
  assert.deepEqual(m.negativeControls.mutationsByCapability, { select_products: 1 });
});

// ---- K: identical denominators ---------------------------------------------------

function pairedRuns(variant: AbVariantId, spec: { commit: boolean; ground: boolean; overMutate: boolean }, runs = 6): AbRunRecord[] {
  const out: AbRunRecord[] = [];
  for (let run = 0; run < runs; run += 1) {
    const invs = [...(spec.ground ? [inv("get_product_details", 0)] : []), ...(spec.commit ? [inv("select_products", spec.ground ? 1 : 0)] : [])];
    out.push(record(variant, "E02", [turn({ invocations: invs, after: spec.commit ? state([{ productId: "31", quantity: 1 }]) : state() })], { run }));
    out.push(record(variant, "N01", [turn({ invocations: spec.overMutate ? [inv("select_products", 0, "blocked", "blocked")] : [inv("get_product_details", 0)] })], { run }));
  }
  return out;
}

test("P7.8-K: comparison metrics use identical denominator definitions; the fixed cohort is variant-independent", () => {
  const a = computeVariantMetrics("A_HYBRID", pairedRuns("A_HYBRID", { commit: false, ground: true, overMutate: false }));
  const b = computeVariantMetrics("B_AUTONOMOUS", pairedRuns("B_AUTONOMOUS", { commit: true, ground: false, overMutate: false }));
  const comparison = compareVariants(a, b);
  // same cases were run => same explicit-purchase cohort and same informational cohort
  assert.equal(a.fixedCohort.explicitPurchaseTurns, b.fixedCohort.explicitPurchaseTurns);
  assert.equal(a.negativeControls.informationalTurns, b.negativeControls.informationalTurns);
  // the grounded subset depends on behavior (B skipped grounding) - which is exactly why the fixed cohort exists
  assert.equal(a.primary.groundedTurns, 6);
  assert.equal(b.primary.groundedTurns, 0);
  assert.equal(comparison.primary.commitAfterGroundingRate.B, null, "empty denominator is null, never a fabricated 0/1");
  assert.equal(comparison.fixedCohort.selectProductsCompletedRate.B, 1, "B commits without grounding: visible in the fixed cohort");
  assert.equal(comparison.fixedCohort.selectProductsCompletedRate.A, 0);
  assert.ok(comparison.denominatorDefinition.includes("fixed per-turn annotation"));
  for (const m of [a, b]) assert.ok(m.primary.commitAfterGroundingRate.numerator <= m.primary.commitAfterGroundingRate.denominator);
  assert.equal(comparison.architectureSignal.signal, "NO_CLEAR_WINNER", "an empty primary denominator can never support AUTONOMOUS_FAVORED");
});

// ---- signal rule ------------------------------------------------------------------

test("P7.8-31: AUTONOMOUS_FAVORED needs a material commit gain (primary, durable, fixed cohort) AND no safety violation", () => {
  const a = computeVariantMetrics("A_HYBRID", pairedRuns("A_HYBRID", { commit: false, ground: true, overMutate: false }));
  const b = computeVariantMetrics("B_AUTONOMOUS", pairedRuns("B_AUTONOMOUS", { commit: true, ground: true, overMutate: false }));
  assert.equal(compareVariants(a, b).architectureSignal.signal, "AUTONOMOUS_FAVORED");
});

test("P7.8-31: B that improves commit but over-mutates on informational questions is HYBRID_FAVORED (autonomous FAIL)", () => {
  const a = computeVariantMetrics("A_HYBRID", pairedRuns("A_HYBRID", { commit: false, ground: true, overMutate: false }));
  const b = computeVariantMetrics("B_AUTONOMOUS", pairedRuns("B_AUTONOMOUS", { commit: true, ground: true, overMutate: true }));
  const signal = compareVariants(a, b).architectureSignal;
  assert.equal(signal.signal, "HYBRID_FAVORED");
  assert.equal(signal.criteria.overMutationAcceptable, false);
});

test("P7.8-31: similar A and B is NO_CLEAR_WINNER", () => {
  const a = computeVariantMetrics("A_HYBRID", pairedRuns("A_HYBRID", { commit: false, ground: true, overMutate: false }));
  const b = computeVariantMetrics("B_AUTONOMOUS", pairedRuns("B_AUTONOMOUS", { commit: false, ground: true, overMutate: false }));
  assert.equal(compareVariants(a, b).architectureSignal.signal, "NO_CLEAR_WINNER");
});

test("P7.8-31: B materially worse on commit is HYBRID_FAVORED", () => {
  const a = computeVariantMetrics("A_HYBRID", pairedRuns("A_HYBRID", { commit: true, ground: true, overMutate: false }));
  const b = computeVariantMetrics("B_AUTONOMOUS", pairedRuns("B_AUTONOMOUS", { commit: false, ground: true, overMutate: false }));
  assert.equal(compareVariants(a, b).architectureSignal.signal, "HYBRID_FAVORED");
});

// ---- variants / prompt stats --------------------------------------------------------

test("P7.8-F/E: the only flags that differ between A and B are the three cognitive-layer switches; everything else is identical", () => {
  assert.deepEqual(diffVariantFlags(baseFlags).sort(), ["capabilityEligibilityInputEnabled", "commercialObjectiveReconciliationEnabled", "commercialProposalShadowEnabled"]);
  const b = resolveVariantFlags(baseFlags, "B_AUTONOMOUS");
  assert.equal(b.capabilityEligibilityShadowEnabled, baseFlags.capabilityEligibilityShadowEnabled, "P6 stays computed as shadow telemetry in B");
  assert.equal(b.openTurnExecutionEnabled, baseFlags.openTurnExecutionEnabled);
  assert.equal(b.harnessAlignedMessageModelEnabled, baseFlags.harnessAlignedMessageModelEnabled);
  assert.equal(AB_VARIANTS.B_AUTONOMOUS.cognition.eligibilityInfluencedCognition, false);
  assert.equal(AB_VARIANTS.A_HYBRID.cognition.eligibilityInfluencedCognition, true);
});

test("P7.8: computePromptStats separates policy lines from the tool catalog", () => {
  const prompt = ["rule 1", "rule 2", "Available tools:", "- a: x", "- b: y", "tail policy line"].join("\n");
  const stats = computePromptStats(prompt, 2);
  assert.equal(stats.policyLineCount, 3);
  assert.equal(stats.toolCatalogChars, "- a: x\n- b: y".length);
  assert.equal(stats.providerCallCount, 2);
});
