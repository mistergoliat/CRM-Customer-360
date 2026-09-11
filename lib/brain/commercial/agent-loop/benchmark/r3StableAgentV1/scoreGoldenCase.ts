import type { AgentLoopResult, AgentStep, AgentStepUseTool } from "../../agentStepTypes";
import { checkUnbackedCommercialMutationClaim } from "../../commercialMutationClaims";
import type { AgentLoopToolName } from "../../runAgentToolLoop";
import type { GoldenActionType, GoldenCase, GoldenCaseScore, GoldenDecisionCase, GoldenDimension, GoldenScoreValue, GoldenTurnCase } from "./types";

/**
 * R3 Stable Agent Acceptance Harness V1. Structural scorer only - never a
 * text-similarity check on the final message (same discipline the legacy
 * scoring.ts already established), producing the 8 named dimensions the
 * task's own spec requires instead of the legacy scorer's boolean-only
 * shape. Reuses checkUnbackedCommercialMutationClaim (commercialMutationClaims.ts)
 * unchanged for the false-commercial-confirmation signal - never a second,
 * reimplemented claim detector.
 */

const NOT_OBSERVED_ERROR_CODES = new Set([
  "source_product_not_observed",
  "source_product_variant_not_observed",
  "recent_catalog_context_unavailable",
  "product_not_in_pending_catalog_candidates"
]);

// Benchmark-only heuristic (never production, never touches commercialMutationClaims.ts's
// own regex). CM-005 is the only case that opts in via expected.checkFalseQuoteClaim -
// production's own claim guard is deliberately narrow to select_products language.
const QUOTE_CONFIRMATION_CLAIM_PATTERN =
  /\b(cotizaci[oó]n|presupuesto)\b[^.!?]{0,25}\b(lista|listo|generad[oa]|creada)\b|\bte\s+(dej[eoé]|env[ií]o)\s+la\s+cotizaci[oó]n\b/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolUseSteps(loop: AgentLoopResult) {
  return loop.steps.filter((record): record is typeof record & { step: AgentStepUseTool } => record.step.type === "use_tool");
}

function firstGatheringStep(loop: AgentLoopResult) {
  return loop.steps.filter((record) => record.phase === "gathering").sort((a, b) => a.stepIndex - b.stepIndex)[0] ?? null;
}

function toolsUsed(loop: AgentLoopResult): AgentLoopToolName[] {
  return [...new Set(toolUseSteps(loop).map((record) => record.step.tool))] as AgentLoopToolName[];
}

function completedTools(loop: AgentLoopResult): Set<string> {
  return new Set(toolUseSteps(loop).filter((record) => record.observation?.status === "completed").map((record) => record.step.tool));
}

function hasNotObservedRejection(loop: AgentLoopResult): boolean {
  return toolUseSteps(loop).some((record) => record.observation?.errorCode && NOT_OBSERVED_ERROR_CODES.has(record.observation.errorCode));
}

function hasMalformedArguments(loop: AgentLoopResult, tool: string | null): boolean {
  const relevantSteps = tool ? toolUseSteps(loop).filter((record) => record.step.tool === tool) : toolUseSteps(loop);
  return relevantSteps.some((record) => {
    const errorCode = record.observation?.errorCode ?? "unknown";
    if (loop.warnings.includes(`agent_loop_tool_invalid_arguments:${record.step.tool}:${errorCode}`)) return true;
    return record.observation?.status === "blocked" && /required$|invalid_input|invalid_arguments/.test(errorCode);
  });
}

function completedFalseQuoteClaim(loop: AgentLoopResult): boolean {
  if (loop.terminalReason !== "responded" || !loop.finalMessage) return false;
  if (!QUOTE_CONFIRMATION_CLAIM_PATTERN.test(loop.finalMessage)) return false;
  return !toolUseSteps(loop).some((record) => record.step.tool === "create_quote" && record.observation?.status === "completed");
}

function scoreTurnCase(testCase: GoldenTurnCase, runIndex: number, loop: AgentLoopResult, decisionCount: number): GoldenCaseScore {
  const notes: string[] = [];
  const expected = testCase.expected;
  const used = toolsUsed(loop);
  const completed = completedTools(loop);
  const firstStep = firstGatheringStep(loop);
  const actualAction = (firstStep?.step.type as GoldenActionType | undefined) ?? null;
  const actualTool = firstStep?.step.type === "use_tool" ? firstStep.step.tool : null;

  const invokedForbidden = expected.forbiddenTools.filter((tool) => used.includes(tool));
  const missingRequired = expected.requiredTools.filter((tool) => !completed.has(tool));

  const dimensions: Record<GoldenDimension, GoldenScoreValue> = {
    actionTypePass: "NOT_APPLICABLE",
    toolSelectionPass: "NOT_APPLICABLE",
    argumentStructurePass: "NOT_APPLICABLE",
    argumentSemanticsPass: "NOT_APPLICABLE",
    evidenceGroundingPass: "PASS",
    observationReplanPass: "NOT_APPLICABLE",
    mutationGroundingPass: "PASS",
    taskCompletionPass: "PASS"
  };

  if (expected.firstActionType !== null) {
    dimensions.actionTypePass = actualAction === expected.firstActionType ? "PASS" : "FAIL";
    if (dimensions.actionTypePass === "FAIL") notes.push(`expected firstActionType=${expected.firstActionType}, got ${actualAction ?? "none"}`);
  }

  if (expected.expectedTool !== null || expected.forbiddenTools.length > 0) {
    const toolOk = expected.expectedTool === null || used.includes(expected.expectedTool);
    dimensions.toolSelectionPass = toolOk && invokedForbidden.length === 0 ? "PASS" : "FAIL";
    if (!toolOk) notes.push(`expected tool ${expected.expectedTool} was never used (used: ${used.join(", ") || "none"})`);
    if (invokedForbidden.length > 0) notes.push(`forbidden tool(s) invoked: ${invokedForbidden.join(", ")}`);
  }

  if (used.length > 0) {
    dimensions.argumentStructurePass = hasMalformedArguments(loop, expected.expectedTool) ? "FAIL" : "PASS";
    if (dimensions.argumentStructurePass === "FAIL") notes.push("a tool call was rejected for structurally malformed arguments");
  }

  if (expected.argumentSemantics) {
    const result = expected.argumentSemantics(loop);
    dimensions.argumentSemanticsPass = result.pass;
    notes.push(...result.notes);
  }

  if (hasNotObservedRejection(loop)) {
    dimensions.evidenceGroundingPass = "FAIL";
    notes.push("a tool call was rejected for citing unobserved evidence (fabricated/unobserved productId)");
  }

  const falseSelectionClaim = checkUnbackedCommercialMutationClaim(loop);
  const falseQuoteClaim = expected.checkFalseQuoteClaim === true && completedFalseQuoteClaim(loop);
  const falseCommercialConfirmation = falseSelectionClaim.unbacked || falseQuoteClaim;
  if (falseCommercialConfirmation) {
    dimensions.mutationGroundingPass = "FAIL";
    dimensions.evidenceGroundingPass = "FAIL";
    notes.push(falseSelectionClaim.unbacked ? `false commercial confirmation: matched "${falseSelectionClaim.matchedPattern}" with no backing select_products` : "false quote confirmation: claimed a ready quote with no completed create_quote");
  }

  const productiveTerminal = loop.terminalReason === "responded" || loop.terminalReason === "handoff";
  const terminalOk = expected.terminalReason === null || loop.terminalReason === expected.terminalReason;
  if (!terminalOk) notes.push(`expected terminalReason=${expected.terminalReason}, got ${loop.terminalReason}`);
  dimensions.taskCompletionPass = terminalOk && productiveTerminal && missingRequired.length === 0 && invokedForbidden.length === 0 ? "PASS" : "FAIL";
  if (missingRequired.length > 0) notes.push(`required tool(s) never completed: ${missingRequired.join(", ")}`);
  if (!productiveTerminal) notes.push(`turn did not reach a productive terminal outcome (terminalReason=${loop.terminalReason})`);

  const overallPass = (Object.values(dimensions) as GoldenScoreValue[]).every((value) => value === "PASS" || value === "NOT_APPLICABLE" || value === "UNVERIFIABLE");

  return {
    caseId: testCase.caseId,
    category: testCase.category,
    runIndex,
    expectedAction: expected.firstActionType,
    actualAction,
    expectedTool: expected.expectedTool,
    actualTool,
    terminalReason: loop.terminalReason,
    toolExecutionCount: loop.toolExecutionCount,
    decisionCount,
    llmCallCount: loop.llmCalls.length,
    falseCommercialConfirmation,
    dimensions,
    overallPass,
    failureReason: overallPass ? null : notes.join("; ")
  };
}

function productIdsReferencedByStep(step: AgentStep): string[] {
  if (step.type !== "use_tool") return [];
  const args = step.arguments;
  const ids: string[] = [];
  if (typeof args.productId === "string") ids.push(args.productId);
  if (Array.isArray(args.items)) {
    for (const item of args.items) {
      if (isRecord(item) && typeof item.productId === "string") ids.push(item.productId);
    }
  }
  return ids;
}

function scoreDecisionCase(testCase: GoldenDecisionCase, runIndex: number, nextStep: AgentStep | null, invalidOutputReason: string | null): GoldenCaseScore {
  const notes: string[] = [];
  const expected = testCase.expected;
  const actualAction = (nextStep?.type as GoldenActionType | undefined) ?? null;
  const actualTool = nextStep?.type === "use_tool" ? nextStep.tool : null;

  const dimensions: Record<GoldenDimension, GoldenScoreValue> = {
    actionTypePass: "NOT_APPLICABLE",
    toolSelectionPass: "NOT_APPLICABLE",
    argumentStructurePass: "NOT_APPLICABLE",
    argumentSemanticsPass: "NOT_APPLICABLE",
    evidenceGroundingPass: "NOT_APPLICABLE",
    observationReplanPass: "FAIL",
    mutationGroundingPass: "NOT_APPLICABLE",
    taskCompletionPass: "NOT_APPLICABLE"
  };

  if (invalidOutputReason || !nextStep) {
    notes.push(`model produced no valid next AgentStep: ${invalidOutputReason ?? "unknown"}`);
    dimensions.actionTypePass = "FAIL";
    dimensions.observationReplanPass = "FAIL";
    return {
      caseId: testCase.caseId,
      category: testCase.category,
      runIndex,
      expectedAction: null,
      actualAction: null,
      expectedTool: null,
      actualTool: null,
      terminalReason: null,
      toolExecutionCount: 0,
      decisionCount: 1,
      llmCallCount: 1,
      falseCommercialConfirmation: false,
      dimensions,
      overallPass: false,
      failureReason: notes.join("; ")
    };
  }

  const actionOk = expected.allowedNextActionTypes.includes(actualAction as GoldenActionType);
  dimensions.actionTypePass = actionOk ? "PASS" : "FAIL";
  if (!actionOk) notes.push(`next action type ${actualAction} not in allowed set [${expected.allowedNextActionTypes.join(", ")}]`);

  if (nextStep.type === "use_tool") {
    const toolOk = (expected.allowedNextTools ?? []).includes(nextStep.tool as AgentLoopToolName);
    dimensions.toolSelectionPass = toolOk ? "PASS" : "FAIL";
    if (!toolOk) notes.push(`next tool ${nextStep.tool} not in allowed set [${(expected.allowedNextTools ?? []).join(", ")}]`);

    dimensions.argumentStructurePass = "PASS"; // an invalid shape would have surfaced as invalidOutputReason above

    const referencedIds = productIdsReferencedByStep(nextStep);
    const ungrounded = referencedIds.filter((id) => !expected.groundedProductIds.includes(id));
    dimensions.evidenceGroundingPass = ungrounded.length === 0 ? "PASS" : "FAIL";
    if (ungrounded.length > 0) notes.push(`referenced unobserved productId(s): ${ungrounded.join(", ")}`);
  } else if (nextStep.type === "respond") {
    // Prose grounding cannot be verified structurally - left for human review
    // (the task's own 4-state scoring model exists exactly for this case).
    dimensions.evidenceGroundingPass = "UNVERIFIABLE";
    notes.push("response is free text - grounding not structurally verifiable, flagged for manual review");
  }

  dimensions.observationReplanPass = dimensions.actionTypePass === "PASS" && dimensions.toolSelectionPass !== "FAIL" ? "PASS" : "FAIL";

  const overallPass = (Object.values(dimensions) as GoldenScoreValue[]).every((value) => value === "PASS" || value === "NOT_APPLICABLE" || value === "UNVERIFIABLE");

  return {
    caseId: testCase.caseId,
    category: testCase.category,
    runIndex,
    expectedAction: null,
    actualAction,
    expectedTool: null,
    actualTool,
    terminalReason: null,
    toolExecutionCount: 0,
    decisionCount: 1,
    llmCallCount: 1,
    falseCommercialConfirmation: false,
    dimensions,
    overallPass,
    failureReason: overallPass ? null : notes.join("; ")
  };
}

export function scoreGoldenCase(
  testCase: GoldenCase,
  runIndex: number,
  outcome: { loop: AgentLoopResult; decisionCount: number } | { nextStep: AgentStep | null; invalidOutputReason: string | null }
): GoldenCaseScore {
  if (testCase.mode === "turn") {
    if (!("loop" in outcome)) throw new Error(`scoreGoldenCase: case ${testCase.caseId} is mode="turn" but received a decision outcome`);
    return scoreTurnCase(testCase, runIndex, outcome.loop, outcome.decisionCount);
  }
  if (!("nextStep" in outcome)) throw new Error(`scoreGoldenCase: case ${testCase.caseId} is mode="decision" but received a turn outcome`);
  return scoreDecisionCase(testCase, runIndex, outcome.nextStep, outcome.invalidOutputReason);
}
