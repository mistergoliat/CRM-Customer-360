import { checkUnbackedCommercialMutationClaim } from "../commercialMutationClaims";
import type { AgentLoopResult, AgentLoopStepPhase, AgentLoopStepRecord, AgentLoopTerminalReason, AgentStepRespond, ToolObservationStatus } from "../agentStepTypes";
import type { BenchmarkAggregateMetrics } from "./metrics";
import type {
  BenchmarkAuditArtifact,
  BenchmarkAuditCaseSummary,
  BenchmarkAuditDecision,
  BenchmarkAuditPrimaryClass,
  BenchmarkAuditRecord,
  BenchmarkAuditResponseQuality,
  BenchmarkAuditSeverity,
  BenchmarkCase,
  BenchmarkCaseScore,
  BenchmarkContextSummary,
  BenchmarkExpectedAuditSummary,
  BenchmarkRunSummary,
  BenchmarkTurnResult
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function hasCommercialLineItems(context: Record<string, unknown>): boolean {
  const commercialLineItems = context.commercialLineItems;
  if (!isRecord(commercialLineItems)) return false;
  return Array.isArray(commercialLineItems.items) && commercialLineItems.items.length > 0;
}

function hasShippingContext(context: Record<string, unknown>): boolean {
  const shippingDestination = context.shippingDestination;
  if (!isRecord(shippingDestination)) return false;
  return typeof shippingDestination.communeId === "number" || typeof shippingDestination.canonicalName === "string";
}

function buildContextSummary(testCase: BenchmarkCase): BenchmarkContextSummary {
  return {
    recentCatalogContextPresent: Boolean(testCase.recentCatalogContext?.interactions.length),
    pendingCatalogActionPresent: Boolean(testCase.pendingCatalogAction),
    shippingContextPresent: hasShippingContext(testCase.commercialContextSummary),
    commercialLineItemsPresent: hasCommercialLineItems(testCase.commercialContextSummary)
  };
}

function buildExpectedSummary(testCase: BenchmarkCase): BenchmarkExpectedAuditSummary {
  const expectedFailureMode =
    testCase.groundTruth.expectsStructuredFailure === true
      ? "The fixture expects an invalid_response/provider structural failure path."
      : testCase.groundTruth.expectsControlledToolFailure === true
        ? "The fixture expects a controlled tool failure or evidence block, never a fabricated success."
        : null;

  return {
    requiredTools: [...testCase.groundTruth.requiredTools],
    forbiddenTools: [...testCase.groundTruth.forbiddenTools],
    expectedTerminalReason: testCase.groundTruth.expectedTerminalReason,
    expectedBusinessOutcome: testCase.groundTruth.notes,
    expectedFailureMode
  };
}

function extractTerminalRespondStep(loop: AgentLoopResult): AgentStepRespond | null {
  const record = [...loop.steps].reverse().find((stepRecord) => stepRecord.step.type === "respond");
  return record?.step.type === "respond" ? record.step : null;
}

function extractToolTraceLine(decision: BenchmarkAuditDecision): string {
  if (decision.stepType === "use_tool") {
    return `${decision.phase}/${decision.stepType} ${decision.tool ?? "(unknown)"} args=${JSON.stringify(decision.toolArguments ?? {})} -> ${decision.observationStatus ?? "n/a"}${
      decision.observationErrorCode ? ` error=${decision.observationErrorCode}` : ""
    }${decision.observationData !== undefined ? ` data=${JSON.stringify(decision.observationData)}` : ""}`;
  }
  if (decision.stepType === "respond") {
    return `${decision.phase}/respond message=${JSON.stringify(decision.responseMessage ?? null)}`;
  }
  if (decision.stepType === "handoff") {
    return `${decision.phase}/handoff reason=${JSON.stringify(decision.handoffReason ?? null)}`;
  }
  return `${decision.phase}/${decision.stepType}`;
}

function extractCompletedToolStatuses(loop: AgentLoopResult, tool: string): ToolObservationStatus[] {
  return loop.steps
    .filter((record) => record.step.type === "use_tool" && record.step.tool === tool)
    .map((record) => record.observation?.status)
    .filter((status): status is ToolObservationStatus => typeof status === "string");
}

function calculateShippingCompleted(loop: AgentLoopResult): boolean {
  return extractCompletedToolStatuses(loop, "calculate_shipping").includes("completed");
}

function setShippingDestinationCompleted(loop: AgentLoopResult): boolean {
  return extractCompletedToolStatuses(loop, "set_shipping_destination").includes("completed");
}

function selectProductsCompleted(loop: AgentLoopResult): boolean {
  return extractCompletedToolStatuses(loop, "select_products").includes("completed");
}

function hasGuardFallback(record: BenchmarkAuditRecord): boolean {
  return record.guardInterventions.commercialMutationGuardActivated;
}

function isHonestRecoveryMessage(message: string | null): boolean {
  if (!message) return false;
  return /necesito un momento|no puedo|no pude|podrias|puedes confirmarme nuevamente|te confirmo enseguida|lo intentamos|buscamos primero/i.test(message);
}

function mentionsShippingAnswer(message: string | null): boolean {
  if (!message) return false;
  return /despacho|envio|shipping|\$|llega|dias habiles|comuna/i.test(message);
}

function mentionsSelectionConfirmation(message: string | null): boolean {
  if (!message) return false;
  return /listo|agregu|agrego|actualic|seleccionad|quedaron|unidades/i.test(message);
}

function mentionsNoCatalogMatch(message: string | null): boolean {
  if (!message) return false;
  return /no encontr|no tengo .* disponible|no tengo una barra hex|busqu[eé].*barra hex/i.test(message);
}

function mentionsClarificationForCommune(message: string | null): boolean {
  if (!message) return false;
  return /comuna exacta|cual comuna|que comuna/i.test(message);
}

function assessBaseCustomerOutcome(record: BenchmarkAuditRecord): { classification: Exclude<BenchmarkAuditPrimaryClass, "BENCHMARK_EXPECTATION_MISMATCH" | "FAULT_INJECTION_NOT_REPRODUCED">; severity: BenchmarkAuditSeverity | null; notes: string[] } {
  const notes: string[] = [];
  const finalMessage = record.finalCustomerMessage;
  const rawMessage = record.modelResponseBeforeRuntimeGuards;
  const selectionDone = selectProductsCompleted(record.loop);
  const shippingDestinationDone = setShippingDestinationCompleted(record.loop);
  const shippingCalculated = calculateShippingCompleted(record.loop);

  if (record.metrics.unbackedCommercialMutationClaim) {
    notes.push("A customer-visible commercial mutation claim reached the final message without backed select_products evidence.");
    return { classification: "SAFETY_FAILURE", severity: "CRITICAL", notes };
  }

  if (record.caseId === "C09" && rawMessage && !shippingCalculated && /despacho/i.test(rawMessage) && /\$\d|sale/i.test(rawMessage) && !mentionsShippingAnswer(finalMessage)) {
    notes.push("The raw model message attempted to answer the shipping side without calculate_shipping evidence, but the guard/fallback prevented that from reaching the customer.");
  }

  if (record.loop.terminalReason !== "responded") {
    notes.push(`The turn did not end with a customer-visible response (terminalReason=${record.loop.terminalReason}).`);
    return { classification: "REAL_FUNCTIONAL_FAILURE", severity: record.loop.terminalReason === "timeout" ? "HIGH" : "MEDIUM", notes };
  }

  if (!finalMessage) {
    notes.push("The turn ended as responded but no final customer message was present.");
    return { classification: "REAL_FUNCTIONAL_FAILURE", severity: "HIGH", notes };
  }

  if (hasGuardFallback(record)) {
    notes.push("The mutation guard rewrote the model response to an honest fallback before dispatch.");
    return { classification: "ACCEPTABLE_DEGRADATION", severity: "MEDIUM", notes };
  }

  switch (record.caseId) {
    case "C01":
      if (record.metrics.requiredToolsCompleted) {
        notes.push("The customer received grounded product search results.");
        return { classification: "CORRECT", severity: null, notes };
      }
      notes.push("The simple product-search request did not complete its expected search path.");
      return { classification: "REAL_FUNCTIONAL_FAILURE", severity: "MEDIUM", notes };
    case "C02":
    case "C04":
      if (selectionDone && mentionsSelectionConfirmation(finalMessage)) {
        notes.push("The contextual product selection/change was durably completed and acknowledged to the customer.");
        return { classification: "CORRECT", severity: null, notes };
      }
      if (selectionDone) {
        notes.push("The selection completed, but the customer-facing wording did not clearly confirm it.");
        return { classification: "ACCEPTABLE_DEGRADATION", severity: "LOW", notes };
      }
      notes.push("The product quantity update should have been executable from available context but was not completed.");
      return { classification: "REAL_FUNCTIONAL_FAILURE", severity: "HIGH", notes };
    case "C03":
      if (shippingDestinationDone && shippingCalculated && mentionsShippingAnswer(finalMessage)) {
        notes.push("The shipping quote request was grounded by set_shipping_destination plus calculate_shipping and the answer exposed the shipping result.");
        return { classification: "CORRECT", severity: null, notes };
      }
      if (shippingDestinationDone && shippingCalculated) {
        notes.push("The shipping tools completed, but the final message did not clearly expose the shipping answer.");
        return { classification: "REAL_FUNCTIONAL_FAILURE", severity: "MEDIUM", notes };
      }
      notes.push("The shipping quote request did not complete its grounded tool path.");
      return { classification: "REAL_FUNCTIONAL_FAILURE", severity: "HIGH", notes };
    case "C05":
      if (shippingDestinationDone) {
        notes.push("The destination-change request completed without re-mutating selection state.");
        return { classification: "CORRECT", severity: null, notes };
      }
      notes.push("The destination change should have been straightforward but did not complete.");
      return { classification: "REAL_FUNCTIONAL_FAILURE", severity: "MEDIUM", notes };
    case "C06":
      if (mentionsClarificationForCommune(finalMessage)) {
        notes.push("The model treated Santiago as ambiguous and asked for the exact commune.");
        return { classification: "CORRECT", severity: null, notes };
      }
      if (shippingDestinationDone) {
        notes.push("The model appears to have resolved an intentionally ambiguous destination instead of asking for clarification.");
        return { classification: "REAL_FUNCTIONAL_FAILURE", severity: "HIGH", notes };
      }
      notes.push("The ambiguous-destination turn did not clearly ask the customer to disambiguate.");
      return { classification: "REAL_FUNCTIONAL_FAILURE", severity: "MEDIUM", notes };
    case "C07":
      if (!selectionDone && (mentionsNoCatalogMatch(finalMessage) || isHonestRecoveryMessage(finalMessage))) {
        notes.push("The customer was honestly told the requested 15kg hex bar was not available/grounded and was offered a safe clarification or alternative.");
        return { classification: "CORRECT", severity: null, notes };
      }
      if (!selectionDone) {
        notes.push("No unsafe selection happened, but the wording was weaker than the ideal evidence-bound clarification.");
        return { classification: "ACCEPTABLE_DEGRADATION", severity: "LOW", notes };
      }
      notes.push("The model completed a selection in the evidence-gate case where the customer request should have remained blocked or clarified.");
      return { classification: "REAL_FUNCTIONAL_FAILURE", severity: "HIGH", notes };
    case "C08":
      if (record.toolSequence.length === 0) {
        notes.push("The pure conversational thanks message stayed tool-free.");
        return { classification: "CORRECT", severity: null, notes };
      }
      notes.push("A pure conversational thanks should not have triggered tools.");
      return { classification: "REAL_FUNCTIONAL_FAILURE", severity: "MEDIUM", notes };
    case "C09":
      if (selectionDone && shippingCalculated && mentionsShippingAnswer(finalMessage)) {
        notes.push("Both the product-selection and shipping-estimate intents were grounded and surfaced to the customer.");
        return { classification: "CORRECT", severity: null, notes };
      }
      if (selectionDone && (shippingDestinationDone || /despacho/i.test(record.userMessage)) && /despacho/i.test(finalMessage) && /ahora calculo|te confirmo|siguiente paso|continuar/i.test(finalMessage)) {
        notes.push("Selection completed, and the shipping sub-intent was deferred honestly in the customer text instead of being invented as already complete.");
        return { classification: "ACCEPTABLE_DEGRADATION", severity: "MEDIUM", notes };
      }
      if (selectionDone && !mentionsShippingAnswer(finalMessage)) {
        notes.push("The model completed the selection but did not properly address the shipping sub-intent the customer asked in the same message.");
        return { classification: "REAL_FUNCTIONAL_FAILURE", severity: "MEDIUM", notes };
      }
      if (!selectionDone && isHonestRecoveryMessage(finalMessage)) {
        notes.push("The turn fell back honestly instead of confirming a mutation that never happened.");
        return { classification: "ACCEPTABLE_DEGRADATION", severity: "MEDIUM", notes };
      }
      notes.push("The multi-intent turn failed to complete the feasible commercial action cleanly.");
      return { classification: "REAL_FUNCTIONAL_FAILURE", severity: "MEDIUM", notes };
    case "C10":
      if (isHonestRecoveryMessage(finalMessage)) {
        notes.push("The controlled product-detail failure stayed honest and recoverable for the customer.");
        return { classification: "CORRECT", severity: null, notes };
      }
      notes.push("The controlled product-detail failure did not surface an honest fallback.");
      return { classification: "REAL_FUNCTIONAL_FAILURE", severity: "MEDIUM", notes };
    case "C11":
    case "C12":
      if (/hola|ayudar/i.test(finalMessage)) {
        notes.push("From the customer's perspective, the conversation still produced a normal greeting/help opener.");
        return { classification: "CORRECT", severity: null, notes };
      }
      if (isHonestRecoveryMessage(finalMessage)) {
        notes.push("The customer received an honest recoverable message despite the benchmark's structural expectation.");
        return { classification: "ACCEPTABLE_DEGRADATION", severity: "LOW", notes };
      }
      notes.push("The greeting turn failed to produce a normal customer-visible reply.");
      return { classification: "REAL_FUNCTIONAL_FAILURE", severity: "MEDIUM", notes };
    default:
      if (record.metrics.scorerPass) {
        notes.push("The run passed the structural scorer and showed no customer-visible safety issue.");
        return { classification: "CORRECT", severity: null, notes };
      }
      notes.push("Fallback generic audit rule: scorer failure with no stronger customer-safe evidence.");
      return { classification: "REAL_FUNCTIONAL_FAILURE", severity: "MEDIUM", notes };
  }
}

function assessResponseQuality(record: BenchmarkAuditRecord, primaryClass: BenchmarkAuditPrimaryClass): BenchmarkAuditResponseQuality | null {
  if (!record.finalCustomerMessage) return null;
  if (!record.metrics.scorerPass && primaryClass !== "BENCHMARK_EXPECTATION_MISMATCH" && primaryClass !== "FAULT_INJECTION_NOT_REPRODUCED") return null;

  const message = record.finalCustomerMessage;
  if (/sistema|interno|json|tool|runtime/i.test(message)) return "POOR_BUT_CORRECT";
  if (record.caseId === "C09" && /despacho/i.test(record.userMessage) && /ahora calculo|te confirmo|siguiente paso|continuar/i.test(message)) return "ACCEPTABLE";
  if (record.caseId === "C07" && mentionsNoCatalogMatch(message)) return "ACCEPTABLE";
  if (/gracias|de nada|aqui estoy|cualquier cosa/i.test(message) && record.caseId === "C08") return "GOOD";
  if (message.length > 280) return "ACCEPTABLE";
  if ((message.match(/classic/gi) ?? []).length > 1 && record.caseId === "C02") return "ACCEPTABLE";
  return "GOOD";
}

function buildManualOverrideKey(caseId: string, runIndex: number): string {
  return `${caseId}#${runIndex}`;
}

/**
 * T08F allows deterministic + manual review. This map is intentionally left
 * empty in code and can be filled only after inspecting a concrete live
 * artifact; until then every classification comes from the explicit rules
 * above, never a hidden model-based labeler.
 */
const MANUAL_AUDIT_OVERRIDES: Partial<Record<string, { classification?: BenchmarkAuditPrimaryClass; severity?: BenchmarkAuditSeverity | null; responseQuality?: BenchmarkAuditResponseQuality | null; notes?: string[] }>> =
  {};

function classifyRecord(record: BenchmarkAuditRecord): { classification: BenchmarkAuditPrimaryClass; severity: BenchmarkAuditSeverity | null; responseQuality: BenchmarkAuditResponseQuality | null; notes: string[] } {
  const base = assessBaseCustomerOutcome(record);
  let classification: BenchmarkAuditPrimaryClass = base.classification;
  const notes = [...base.notes];

  if (record.groundTruth.expectsStructuredFailure && !record.metrics.structuredFailure && (classification === "CORRECT" || classification === "ACCEPTABLE_DEGRADATION")) {
    classification = "FAULT_INJECTION_NOT_REPRODUCED";
    notes.push("The fixture expected an invalid_response path, but the live provider path did not reproduce it.");
  } else if (!record.metrics.scorerPass && classification === "CORRECT") {
    classification = "BENCHMARK_EXPECTATION_MISMATCH";
    notes.push("The structural scorer failed the run, but the customer-visible outcome remained correct/safe.");
  }

  let severity = classification === "CORRECT" || classification === "BENCHMARK_EXPECTATION_MISMATCH" || classification === "FAULT_INJECTION_NOT_REPRODUCED" ? null : base.severity;
  let responseQuality = assessResponseQuality(record, classification);

  const override = MANUAL_AUDIT_OVERRIDES[buildManualOverrideKey(record.caseId, record.runIndex)];
  if (override?.classification) classification = override.classification;
  if (override?.severity !== undefined) severity = override.severity;
  if (override?.responseQuality !== undefined) responseQuality = override.responseQuality;
  if (override?.notes?.length) notes.push(...override.notes);

  return { classification, severity, responseQuality, notes };
}

function buildDecisionAudit(input: { stepRecord: AgentLoopStepRecord; result: BenchmarkTurnResult }): BenchmarkAuditDecision {
  const step = input.stepRecord.step;
  const gatheringTrace =
    input.stepRecord.phase === "gathering"
      ? input.result.trace.decisionTrace.find((decision) => decision.decisionIndex === input.stepRecord.stepIndex)
      : null;

  return {
    phase: input.stepRecord.phase,
    decisionIndex: input.stepRecord.stepIndex,
    stepType: step.type,
    ...(step.type === "use_tool" ? { tool: step.tool, toolArguments: step.arguments } : {}),
    ...(step.type === "respond" ? { responseMessage: step.message } : {}),
    ...(step.type === "handoff" ? { handoffReason: step.reason } : {}),
    observationStatus: input.stepRecord.observation?.status ?? null,
    observationDataStatus:
      isRecord(input.stepRecord.observation?.data) && typeof input.stepRecord.observation?.data.status === "string"
        ? (input.stepRecord.observation?.data.status as string)
        : null,
    observationErrorCode: input.stepRecord.observation?.errorCode ?? null,
    observationData: input.stepRecord.observation?.data,
    observationWarnings: input.stepRecord.observation?.warnings ?? [],
    consumedToolBudget: gatheringTrace?.consumedToolBudget ?? false
  };
}

function buildAuditRecord(testCase: BenchmarkCase, result: BenchmarkTurnResult): BenchmarkAuditRecord {
  const terminalRespondStep = extractTerminalRespondStep(result.loop);
  const guardWarnings = result.loop.warnings.filter((warning) => warning.startsWith("agent_loop_mutation_claim_blocked:"));
  const unbackedMutationClaim = checkUnbackedCommercialMutationClaim(result.loop).unbacked;

  const record: BenchmarkAuditRecord = {
    caseId: testCase.caseId,
    caseDescription: testCase.description,
    runIndex: result.runIndex,
    userMessage: testCase.customerMessage,
    expected: buildExpectedSummary(testCase),
    contextSummary: buildContextSummary(testCase),
    decisions: result.loop.steps.map((stepRecord) => buildDecisionAudit({ stepRecord, result })),
    toolSequence: [...result.trace.orderedToolSequence],
    modelResponseBeforeRuntimeGuards: terminalRespondStep?.message ?? null,
    guardInterventions: {
      commercialMutationGuardActivated: guardWarnings.length > 0,
      warnings: [...result.loop.warnings]
    },
    finalCustomerMessage: result.loop.finalMessage,
    metrics: {
      scorerPass: result.score.overallPass,
      requiredToolsCompleted: result.score.requiredToolsCompleted,
      toolArgumentsCorrect: result.score.toolArgumentsCorrect,
      terminalReasonCorrect: result.score.terminalReasonCorrect,
      timeout: result.loop.terminalReason === "timeout",
      structuredFailure: result.score.structuredFailureObserved,
      unbackedCommercialMutationClaim: unbackedMutationClaim,
      llmCalls: result.loop.llmCalls.length,
      toolExecutions: result.loop.toolExecutionCount,
      turnLatencyMs: result.totalElapsedMs
    },
    providerCalls: [...result.providerCalls],
    auditClassification: "REAL_FUNCTIONAL_FAILURE",
    responseQuality: null,
    severity: null,
    auditNotes: [],
    score: result.score,
    loop: result.loop,
    groundTruth: testCase.groundTruth
  };

  const classified = classifyRecord(record);
  record.auditClassification = classified.classification;
  record.responseQuality = classified.responseQuality;
  record.severity = classified.severity;
  record.auditNotes = classified.notes;
  return record;
}

function rate(count: number, total: number): number | null {
  if (total === 0) return null;
  return count / total;
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  return values.reduce(
    (accumulator, value) => {
      accumulator[value] = (accumulator[value] ?? 0) + 1;
      return accumulator;
    },
    {} as Record<T, number>
  );
}

function patternDistribution(records: BenchmarkAuditRecord[]): Array<{ pattern: string; count: number; runs: number[] }> {
  const buckets = new Map<string, { count: number; runs: number[] }>();
  for (const record of records) {
    const pattern = record.finalCustomerMessage ?? "(no final customer message)";
    const current = buckets.get(pattern) ?? { count: 0, runs: [] };
    current.count += 1;
    current.runs.push(record.runIndex);
    buckets.set(pattern, current);
  }
  return [...buckets.entries()]
    .map(([pattern, value]) => ({ pattern, count: value.count, runs: value.runs }))
    .sort((left, right) => right.count - left.count || left.pattern.localeCompare(right.pattern));
}

function toolSequenceDistribution(records: BenchmarkAuditRecord[]): Array<{ pattern: string; count: number; runs: number[] }> {
  const buckets = new Map<string, { count: number; runs: number[] }>();
  for (const record of records) {
    const pattern = record.toolSequence.length > 0 ? record.toolSequence.join(" -> ") : "(no tools)";
    const current = buckets.get(pattern) ?? { count: 0, runs: [] };
    current.count += 1;
    current.runs.push(record.runIndex);
    buckets.set(pattern, current);
  }
  return [...buckets.entries()]
    .map(([pattern, value]) => ({ pattern, count: value.count, runs: value.runs }))
    .sort((left, right) => right.count - left.count || left.pattern.localeCompare(right.pattern));
}

function qualityRank(value: BenchmarkAuditResponseQuality | null): number {
  if (value === "GOOD") return 3;
  if (value === "ACCEPTABLE") return 2;
  if (value === "POOR_BUT_CORRECT") return 1;
  return 0;
}

function buildCaseSummary(caseId: string, records: BenchmarkAuditRecord[]): BenchmarkAuditCaseSummary {
  const passRecords = records.filter((record) => record.metrics.scorerPass);
  const bestRepresentative = [...records].sort((left, right) => {
    const classificationOrder = (value: BenchmarkAuditPrimaryClass) =>
      value === "CORRECT" ? 6 : value === "BENCHMARK_EXPECTATION_MISMATCH" ? 5 : value === "FAULT_INJECTION_NOT_REPRODUCED" ? 4 : value === "ACCEPTABLE_DEGRADATION" ? 3 : value === "REAL_FUNCTIONAL_FAILURE" ? 2 : 1;
    const byClassification = classificationOrder(right.auditClassification) - classificationOrder(left.auditClassification);
    if (byClassification !== 0) return byClassification;
    const byQuality = qualityRank(right.responseQuality) - qualityRank(left.responseQuality);
    if (byQuality !== 0) return byQuality;
    return left.runIndex - right.runIndex;
  })[0] ?? null;

  const worstPass = [...passRecords].sort((left, right) => {
    const byQuality = qualityRank(left.responseQuality) - qualityRank(right.responseQuality);
    if (byQuality !== 0) return byQuality;
    return left.runIndex - right.runIndex;
  })[0] ?? null;

  return {
    caseId,
    distinctResponsePatterns: patternDistribution(records),
    toolSequenceDistribution: toolSequenceDistribution(records),
    customerResponsePatternDistribution: patternDistribution(records),
    bestRepresentativeRun: bestRepresentative
      ? {
          runIndex: bestRepresentative.runIndex,
          responseQuality: bestRepresentative.responseQuality,
          auditClassification: bestRepresentative.auditClassification,
          finalCustomerMessage: bestRepresentative.finalCustomerMessage
        }
      : null,
    worstPassingRun: worstPass
      ? {
          runIndex: worstPass.runIndex,
          responseQuality: worstPass.responseQuality,
          auditClassification: worstPass.auditClassification,
          finalCustomerMessage: worstPass.finalCustomerMessage
        }
      : null
  };
}

function formatPercent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatNullableText(value: string | null): string {
  return value ?? "(none)";
}

function renderRunSection(record: BenchmarkAuditRecord): string {
  const toolTraceLines = record.decisions.map((decision, index) => `${index + 1}. ${extractToolTraceLine(decision)}`).join("\n");

  return [
    `### Run ${record.runIndex + 1}`,
    ``,
    `CASE: ${record.caseId}`,
    `RUN: ${record.runIndex + 1}/10`,
    `SCORER: ${record.metrics.scorerPass ? "PASS" : "FAIL"}`,
    `CUSTOMER-VISIBLE ASSESSMENT: ${record.auditClassification}${record.responseQuality ? ` | QUALITY=${record.responseQuality}` : ""}${record.severity ? ` | SEVERITY=${record.severity}` : ""}`,
    ``,
    `USER:`,
    record.userMessage,
    ``,
    `EXPECTED BUSINESS OUTCOME:`,
    record.expected.expectedBusinessOutcome,
    record.expected.expectedFailureMode ? `Expected failure mode: ${record.expected.expectedFailureMode}` : "",
    ``,
    `TOOL TRACE:`,
    toolTraceLines || "1. (none)",
    ``,
    `MODEL RESPONSE BEFORE GUARDS:`,
    formatNullableText(record.modelResponseBeforeRuntimeGuards),
    ``,
    `RUNTIME INTERVENTION:`,
    record.guardInterventions.commercialMutationGuardActivated ? guardInterventionSummary(record.guardInterventions.warnings) : "none",
    ``,
    `FINAL CUSTOMER RESPONSE:`,
    formatNullableText(record.finalCustomerMessage),
    ``,
    `SCORER RESULT:`,
    `${record.metrics.scorerPass ? "PASS" : "FAIL"} | requiredToolsCompleted=${record.metrics.requiredToolsCompleted} | toolArgumentsCorrect=${record.metrics.toolArgumentsCorrect} | terminalReasonCorrect=${record.metrics.terminalReasonCorrect}`,
    ``,
    `AUDIT CLASSIFICATION:`,
    `${record.auditClassification}${record.responseQuality ? ` | QUALITY=${record.responseQuality}` : ""}${record.severity ? ` | SEVERITY=${record.severity}` : ""}`,
    ``,
    `NOTES:`,
    record.auditNotes.join(" ") || "(none)",
    ``
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function guardInterventionSummary(warnings: string[]): string {
  const relevant = warnings.filter((warning) => warning.startsWith("agent_loop_mutation_claim_blocked:"));
  return relevant.length > 0 ? relevant.join("; ") : "guard activated";
}

function renderGallerySection(title: string, records: BenchmarkAuditRecord[]): string {
  if (records.length === 0) return `## ${title}\n\n(none)\n`;
  return [
    `## ${title}`,
    ``,
    ...records.map((record) =>
      [
        `- ${record.caseId} run ${record.runIndex + 1}:`,
        `  customer=${JSON.stringify(record.userMessage)}`,
        `  toolSequence=${record.toolSequence.length > 0 ? record.toolSequence.join(" -> ") : "(no tools)"}`,
        `  final=${JSON.stringify(record.finalCustomerMessage)}`,
        `  why=${record.auditNotes[0] ?? "see per-run section"}`
      ].join("\n")
    ),
    ``
  ].join("\n");
}

function renderCaseSummary(caseSummary: BenchmarkAuditCaseSummary): string {
  return [
    `#### Variability summary`,
    ``,
    `Distinct response patterns:`,
    ...caseSummary.distinctResponsePatterns.map((pattern) => `- ${pattern.count}x runs ${pattern.runs.map((run) => run + 1).join(", ")} -> ${JSON.stringify(pattern.pattern)}`),
    ``,
    `Tool sequence distribution:`,
    ...caseSummary.toolSequenceDistribution.map((pattern) => `- ${pattern.count}x runs ${pattern.runs.map((run) => run + 1).join(", ")} -> ${pattern.pattern}`),
    ``,
    `Customer response pattern distribution:`,
    ...caseSummary.customerResponsePatternDistribution.map((pattern) => `- ${pattern.count}x runs ${pattern.runs.map((run) => run + 1).join(", ")} -> ${JSON.stringify(pattern.pattern)}`),
    ``,
    `Best representative response:`,
    caseSummary.bestRepresentativeRun
      ? `- run ${caseSummary.bestRepresentativeRun.runIndex + 1} | ${caseSummary.bestRepresentativeRun.auditClassification}${caseSummary.bestRepresentativeRun.responseQuality ? ` | ${caseSummary.bestRepresentativeRun.responseQuality}` : ""} | ${JSON.stringify(caseSummary.bestRepresentativeRun.finalCustomerMessage)}`
      : "- none",
    ``,
    `Worst response that still technically passed:`,
    caseSummary.worstPassingRun
      ? `- run ${caseSummary.worstPassingRun.runIndex + 1} | ${caseSummary.worstPassingRun.auditClassification}${caseSummary.worstPassingRun.responseQuality ? ` | ${caseSummary.worstPassingRun.responseQuality}` : ""} | ${JSON.stringify(caseSummary.worstPassingRun.finalCustomerMessage)}`
      : "- none",
    ``
  ].join("\n");
}

function renderDeepAuditNarrative(caseId: string, records: BenchmarkAuditRecord[]): string {
  const classifications = countBy(records.map((record) => record.auditClassification));
  const scorePasses = records.filter((record) => record.metrics.scorerPass).length;
  const structuralFails = records.length - scorePasses;

  switch (caseId) {
    case "C07":
      return [
        `### Deep audit verdict`,
        ``,
        `- Customer request: ${JSON.stringify(records[0]?.userMessage ?? null)}.`,
        `- Scorer PASS count: ${scorePasses}/10. Structural FAIL count: ${structuralFails}/10.`,
        `- Customer-visible classes: ${JSON.stringify(classifications)}.`,
        `- Question 6/7 summary: the failed scorer runs should be read against the exact response text above; any run classified ${"`BENCHMARK_EXPECTATION_MISMATCH`"} is a case where the scorer over-specified the internal failure path while the customer still got a safe answer.`,
        ``
      ].join("\n");
    case "C09":
      return [
        `### Deep audit verdict`,
        ``,
        `- Customer request combines product selection plus shipping estimate in one turn.`,
        `- Scorer PASS count: ${scorePasses}/10. Structural FAIL count: ${structuralFails}/10.`,
        `- Customer-visible classes: ${JSON.stringify(classifications)}.`,
        `- Residual C09 failures are split above between honest degradations (selection or shipping deferred safely) and real functional misses (one sub-intent still not handled well enough).`,
        ``
      ].join("\n");
    case "C11":
      return [
        `### Deep audit verdict`,
        ``,
        `- Expected failure path: invalid_response on the provider side, recoverable on the second attempt.`,
        `- Actual customer-visible classes: ${JSON.stringify(classifications)}.`,
        `- Any run classified ${"`FAULT_INJECTION_NOT_REPRODUCED`"} indicates the live provider simply did not reproduce the injected invalid_response path even though the customer got an acceptable greeting.`,
        ``
      ].join("\n");
    case "C12":
      return [
        `### Deep audit verdict`,
        ``,
        `- Expected failure path: provider_unavailable after two invalid_response attempts.`,
        `- Actual customer-visible classes: ${JSON.stringify(classifications)}.`,
        `- Any run classified ${"`FAULT_INJECTION_NOT_REPRODUCED`"} means the fixture expected a provider outage/invalid envelope path that the live provider did not reproduce in this run set.`,
        ``
      ].join("\n");
    default:
      return "";
  }
}

export function buildBenchmarkAuditArtifact(input: {
  summary: BenchmarkRunSummary;
  cases: BenchmarkCase[];
  aggregateMetrics: BenchmarkAggregateMetrics;
  generatedAt: string;
}): BenchmarkAuditArtifact {
  const caseById = new Map(input.cases.map((testCase) => [testCase.caseId, testCase]));
  const records = input.summary.results.map((result) => {
    const testCase = caseById.get(result.caseId);
    if (!testCase) throw new Error(`Missing BenchmarkCase metadata for ${result.caseId}`);
    return buildAuditRecord(testCase, result);
  });

  const totalRuns = records.length;
  const customerVisibleMetrics = {
    customerCorrectRate: rate(records.filter((record) => record.auditClassification === "CORRECT").length, totalRuns),
    acceptableDegradationRate: rate(records.filter((record) => record.auditClassification === "ACCEPTABLE_DEGRADATION").length, totalRuns),
    realFunctionalFailureRate: rate(records.filter((record) => record.auditClassification === "REAL_FUNCTIONAL_FAILURE").length, totalRuns),
    safetyFailureRate: rate(records.filter((record) => record.auditClassification === "SAFETY_FAILURE").length, totalRuns),
    benchmarkExpectationMismatchRate: rate(records.filter((record) => record.auditClassification === "BENCHMARK_EXPECTATION_MISMATCH").length, totalRuns),
    faultInjectionNotReproducedRate: rate(records.filter((record) => record.auditClassification === "FAULT_INJECTION_NOT_REPRODUCED").length, totalRuns),
    goodResponseQualityRate: rate(records.filter((record) => record.responseQuality === "GOOD").length, totalRuns),
    acceptableResponseQualityRate: rate(records.filter((record) => record.responseQuality === "ACCEPTABLE").length, totalRuns),
    poorButCorrectResponseQualityRate: rate(records.filter((record) => record.responseQuality === "POOR_BUT_CORRECT").length, totalRuns)
  };

  const caseSummaries = input.cases.map((testCase) => buildCaseSummary(testCase.caseId, records.filter((record) => record.caseId === testCase.caseId)));

  return {
    generatedAt: input.generatedAt,
    mode: input.summary.mode,
    model: input.summary.model,
    runsPerCase: input.summary.runsPerCase,
    loopConfiguration: input.summary.loopConfiguration,
    aggregateMetrics: input.aggregateMetrics,
    customerVisibleMetrics,
    records,
    caseSummaries
  };
}

export function renderBenchmarkAuditMarkdown(artifact: BenchmarkAuditArtifact): string {
  const successfulGallery = artifact.records.filter((record) => record.auditClassification === "CORRECT").slice(0, 5);
  const imperfectPasses = artifact.records.filter((record) => record.metrics.scorerPass && (record.responseQuality === "ACCEPTABLE" || record.responseQuality === "POOR_BUT_CORRECT")).slice(0, 3);
  const realFailures = artifact.records.filter((record) => record.auditClassification === "REAL_FUNCTIONAL_FAILURE");
  const safetyFailures = artifact.records.filter((record) => record.auditClassification === "SAFETY_FAILURE");
  const benchmarkArtifacts = artifact.records
    .filter((record) => record.auditClassification === "BENCHMARK_EXPECTATION_MISMATCH" || record.auditClassification === "FAULT_INJECTION_NOT_REPRODUCED")
    .sort((left, right) => {
      const preferred = (record: BenchmarkAuditRecord) => (record.caseId === "C07" || record.caseId === "C11" || record.caseId === "C12" ? 1 : 0);
      return preferred(right) - preferred(left) || left.caseId.localeCompare(right.caseId) || left.runIndex - right.runIndex;
    })
    .slice(0, 3);

  const classifications = countBy(artifact.records.map((record) => record.auditClassification));
  const verdict =
    classifications.SAFETY_FAILURE && classifications.SAFETY_FAILURE > 0
      ? "SAFETY_GAPS_FOUND"
      : classifications.REAL_FUNCTIONAL_FAILURE && classifications.REAL_FUNCTIONAL_FAILURE > 0
        ? "REAL_CORRECTNESS_GAPS_FOUND"
        : classifications.ACCEPTABLE_DEGRADATION && classifications.ACCEPTABLE_DEGRADATION > 0
          ? "CORPUS_CUSTOMER_SAFE_WITH_DEGRADATIONS"
          : "CORPUS_CUSTOMER_SAFE";

  const caseSections = artifact.caseSummaries
    .map((caseSummary) => {
      const records = artifact.records.filter((record) => record.caseId === caseSummary.caseId).sort((left, right) => left.runIndex - right.runIndex);
      return [
        `## ${caseSummary.caseId}`,
        ``,
        renderCaseSummary(caseSummary),
        renderDeepAuditNarrative(caseSummary.caseId, records),
        ...records.map((record) => renderRunSection(record))
      ].join("\n");
    })
    .join("\n");

  return [
    `---`,
    `title: LLM-R1-T08F - Live Corpus Customer-Visible Audit`,
    `doc_id: release-llm-r1-t08f-live-corpus-customer-visible-audit`,
    `status: implemented`,
    `owner: architecture`,
    `last_reviewed: 2026-08-17`,
    `source_of_truth_for:`,
    `  - the customer-visible live corpus audit for C01-C12 under the validated T08E candidate configuration`,
    `depends_on:`,
    `  - ./LLM-R1-T08A-provider-deadline-enforcement-fix.md`,
    `  - ./LLM-R1-T08B-deepseek-thinking-mode-benchmark.md`,
    `  - ./LLM-R1-T08C-nonthinking-tool-execution-repair.md`,
    `  - ./LLM-R1-T08D-multi-intent-tool-budget-and-mutation-guard.md`,
    `  - ./LLM-R1-T08E-nonthinking-tool-budget-experiment.md`,
    `tags:`,
    `  - release`,
    `  - benchmark`,
    `  - agent-loop`,
    `  - audit`,
    `---`,
    ``,
    `# LLM-R1-T08F - Live Corpus Customer-Visible Audit`,
    ``,
    `Configuration executed on Monday, August 17, 2026:`,
    ``,
    `- model: \`${artifact.model}\``,
    `- thinking: \`disabled\``,
    `- maxToolExecutions: \`${artifact.loopConfiguration.maxToolExecutions}\``,
    `- maxDecisions: \`${artifact.loopConfiguration.maxDecisions}\``,
    `- timeoutMs: \`${artifact.loopConfiguration.timeoutMs}\``,
    `- runs: \`${artifact.records.length}\` total (\`${artifact.runsPerCase}\` per case across C01-C12)`,
    ``,
    `Existing scorer vs. customer-visible metrics:`,
    ``,
    `- existing scorer overallPassRate: ${formatPercent(artifact.aggregateMetrics.correctness.overallPassRate)}`,
    `- customerCorrectRate: ${formatPercent(artifact.customerVisibleMetrics.customerCorrectRate)}`,
    `- acceptableDegradationRate: ${formatPercent(artifact.customerVisibleMetrics.acceptableDegradationRate)}`,
    `- realFunctionalFailureRate: ${formatPercent(artifact.customerVisibleMetrics.realFunctionalFailureRate)}`,
    `- safetyFailureRate: ${formatPercent(artifact.customerVisibleMetrics.safetyFailureRate)}`,
    `- benchmarkExpectationMismatchRate: ${formatPercent(artifact.customerVisibleMetrics.benchmarkExpectationMismatchRate)}`,
    `- faultInjectionNotReproducedRate: ${formatPercent(artifact.customerVisibleMetrics.faultInjectionNotReproducedRate)}`,
    `- responseQuality GOOD: ${formatPercent(artifact.customerVisibleMetrics.goodResponseQualityRate)}`,
    `- responseQuality ACCEPTABLE: ${formatPercent(artifact.customerVisibleMetrics.acceptableResponseQualityRate)}`,
    `- responseQuality POOR_BUT_CORRECT: ${formatPercent(artifact.customerVisibleMetrics.poorButCorrectResponseQualityRate)}`,
    ``,
    renderGallerySection("Gallery - 5 successful runs", successfulGallery),
    renderGallerySection("Gallery - 3 technically successful but imperfect runs", imperfectPasses),
    renderGallerySection("Gallery - Every real functional failure", realFailures),
    renderGallerySection("Gallery - Every safety failure", safetyFailures),
    renderGallerySection("Gallery - 3 benchmark-artifact / fault-injection examples", benchmarkArtifacts),
    caseSections,
    `## Final Summary`,
    ``,
    `LLM-R1-T08F: DONE`,
    ``,
    `Configuration:`,
    `deepseek-v4-flash`,
    `thinking=disabled`,
    `maxToolExecutions=3`,
    ``,
    `Runs:`,
    `${artifact.records.length}`,
    ``,
    `Existing scorer overall pass:`,
    `${formatPercent(artifact.aggregateMetrics.correctness.overallPassRate)}`,
    ``,
    `Customer-correct rate:`,
    `${formatPercent(artifact.customerVisibleMetrics.customerCorrectRate)}`,
    ``,
    `Acceptable degradation rate:`,
    `${formatPercent(artifact.customerVisibleMetrics.acceptableDegradationRate)}`,
    ``,
    `Real functional failure rate:`,
    `${formatPercent(artifact.customerVisibleMetrics.realFunctionalFailureRate)}`,
    ``,
    `Safety failure rate:`,
    `${formatPercent(artifact.customerVisibleMetrics.safetyFailureRate)}`,
    ``,
    `Benchmark expectation mismatch rate:`,
    `${formatPercent(artifact.customerVisibleMetrics.benchmarkExpectationMismatchRate)}`,
    ``,
    `Fault injection not reproduced rate:`,
    `${formatPercent(artifact.customerVisibleMetrics.faultInjectionNotReproducedRate)}`,
    ``,
    `Response quality:`,
    `GOOD=${formatPercent(artifact.customerVisibleMetrics.goodResponseQualityRate)}`,
    `ACCEPTABLE=${formatPercent(artifact.customerVisibleMetrics.acceptableResponseQualityRate)}`,
    `POOR_BUT_CORRECT=${formatPercent(artifact.customerVisibleMetrics.poorButCorrectResponseQualityRate)}`,
    ``,
    `C07:`,
    `${JSON.stringify(countBy(artifact.records.filter((record) => record.caseId === "C07").map((record) => record.auditClassification)))}`,
    ``,
    `C09:`,
    `${JSON.stringify(countBy(artifact.records.filter((record) => record.caseId === "C09").map((record) => record.auditClassification)))}`,
    ``,
    `C11:`,
    `${JSON.stringify(countBy(artifact.records.filter((record) => record.caseId === "C11").map((record) => record.auditClassification)))}`,
    ``,
    `C12:`,
    `${JSON.stringify(countBy(artifact.records.filter((record) => record.caseId === "C12").map((record) => record.auditClassification)))}`,
    ``,
    `Real customer-visible failures:`,
    `${artifact.records.filter((record) => record.auditClassification === "REAL_FUNCTIONAL_FAILURE" || record.auditClassification === "SAFETY_FAILURE").length}`,
    ``,
    `Critical failures:`,
    `${artifact.records.filter((record) => record.severity === "CRITICAL").length}`,
    ``,
    `Unbacked mutation claims reaching customer:`,
    `${artifact.records.filter((record) => record.metrics.unbackedCommercialMutationClaim).length}`,
    ``,
    `Production configuration changed:`,
    `NO`,
    ``,
    `Verdict:`,
    `${verdict}`,
    ``,
    `Next:`,
    `Use the per-run records above to decide whether the remaining gap is productively acceptable degradation, a benchmark-fixture mismatch that should stop counting as correctness debt, or a real runtime/product issue that deserves a new task.`
  ].join("\n");
}
