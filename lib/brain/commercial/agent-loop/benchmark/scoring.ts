import type { AgentLoopResult, AgentStepUseTool } from "../agentStepTypes";
import type { AgentLoopToolName } from "../runAgentToolLoop";
import type { BenchmarkCaseScore, BenchmarkGroundTruth } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asToolName(value: string): AgentLoopToolName {
  return value as AgentLoopToolName;
}

/**
 * LLM-R1-T05, Part A ground truth. Structural only - never a text-similarity
 * check on loop.finalMessage (per the task's own instruction). Reads
 * exclusively loop.steps/loop.terminalReason/loop.llmCalls, all already
 * produced by the real, unmodified runAgentToolLoop/T02 observability.
 */
export function scoreCase(caseId: string, runIndex: number, loop: AgentLoopResult, groundTruth: BenchmarkGroundTruth): BenchmarkCaseScore {
  const notes: string[] = [];

  const toolSteps = loop.steps.filter((record): record is typeof record & { step: AgentStepUseTool } => record.step.type === "use_tool");
  const toolsUsed = [...new Set(toolSteps.map((record) => record.step.tool))].map(asToolName);
  const completedTools = new Set(toolSteps.filter((record) => record.observation?.status === "completed").map((record) => record.step.tool));

  const missingRequiredTools = groundTruth.requiredTools.filter((tool) => !completedTools.has(tool));
  const requiredToolsCompleted = missingRequiredTools.length === 0;

  const invokedForbiddenTools = groundTruth.forbiddenTools.filter((tool) => toolsUsed.includes(tool));
  const forbiddenToolInvoked = invokedForbiddenTools.length > 0;
  if (forbiddenToolInvoked) notes.push(`forbidden tool(s) invoked: ${invokedForbiddenTools.join(", ")}`);

  let toolArgumentsCorrect = true;

  if (groundTruth.selectedProductId !== undefined || groundTruth.quantity !== undefined) {
    const selectCall = [...toolSteps].reverse().find((record) => record.step.tool === "select_products" && record.observation?.status === "completed");
    if (!selectCall) {
      toolArgumentsCorrect = false;
      notes.push("expected a completed select_products call but none was found");
    } else {
      const items = Array.isArray(selectCall.step.arguments.items) ? (selectCall.step.arguments.items as Array<Record<string, unknown>>) : [];
      const matches = items.some((item) => {
        const productMatches = groundTruth.selectedProductId == null || String(item.productId) === groundTruth.selectedProductId;
        const quantityMatches = groundTruth.quantity == null || item.quantity === groundTruth.quantity;
        return productMatches && quantityMatches;
      });
      if (!matches) {
        toolArgumentsCorrect = false;
        notes.push(`select_products arguments did not match expected productId=${groundTruth.selectedProductId ?? "any"} quantity=${groundTruth.quantity ?? "any"} (got items=${JSON.stringify(items)})`);
      }
    }
  }

  if (groundTruth.expectedDestinationCommuneId !== undefined) {
    const destinationCall = [...toolSteps].reverse().find((record) => record.step.tool === "set_shipping_destination" && record.observation?.status === "completed");
    const data = destinationCall && isRecord(destinationCall.observation?.data) ? destinationCall.observation.data : null;
    const resolvedStatus = data?.status === "resolved";
    const communeId = resolvedStatus && isRecord(data.destination) ? data.destination.communeId : null;

    if (groundTruth.expectedDestinationCommuneId === null) {
      if (resolvedStatus) {
        toolArgumentsCorrect = false;
        notes.push(`expected an ambiguous/unresolved destination but set_shipping_destination resolved to communeId=${communeId}`);
      }
    } else if (communeId !== groundTruth.expectedDestinationCommuneId) {
      toolArgumentsCorrect = false;
      notes.push(`expected destination communeId=${groundTruth.expectedDestinationCommuneId}, got ${communeId ?? "none (status=" + (data?.status ?? "no_call") + ")"}`);
    }
  }

  const terminalReasonCorrect = loop.terminalReason === groundTruth.expectedTerminalReason;
  if (!terminalReasonCorrect) notes.push(`expected terminalReason=${groundTruth.expectedTerminalReason}, got ${loop.terminalReason}`);

  const controlledToolFailureObserved = toolSteps.some((record) => record.observation?.status === "failed" || record.observation?.status === "blocked");
  const structuredFailureObserved = loop.llmCalls.some((call) => call.outcome === "invalid_response");

  if (groundTruth.expectsControlledToolFailure === true && !controlledToolFailureObserved) {
    notes.push("expected a controlled tool failure (failed/blocked observation) that was not observed");
  }
  if (groundTruth.expectsStructuredFailure === true && !structuredFailureObserved) {
    notes.push("expected a structured provider failure (invalid_response) that was not observed");
  }

  const expectedSignalsPresent =
    (groundTruth.expectsControlledToolFailure !== true || controlledToolFailureObserved) &&
    (groundTruth.expectsStructuredFailure !== true || structuredFailureObserved);

  const overallPass = requiredToolsCompleted && !forbiddenToolInvoked && toolArgumentsCorrect && terminalReasonCorrect && expectedSignalsPresent;

  return {
    caseId,
    runIndex,
    toolsUsed,
    requiredToolsCompleted,
    missingRequiredTools,
    forbiddenToolInvoked,
    invokedForbiddenTools,
    toolArgumentsCorrect,
    terminalReasonCorrect,
    controlledToolFailureObserved,
    structuredFailureObserved,
    overallPass,
    notes
  };
}
