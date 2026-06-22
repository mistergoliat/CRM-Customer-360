import { EXECUTION_GATE_SUPPORTED_COMMAND_TYPE, EXECUTION_GATE_SUPPORTED_CHANNEL } from "./constants";
import type { CanonicalOutboxCommand, ExecutionGateInput } from "./types";
import { normalizeWaIdDigits } from "../autonomy-sandbox";

function asText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type BuildOutboxCommandInput = {
  action: ExecutionGateInput["action"];
  evaluatedAt: string;
};

export function buildOutboxCommand(input: BuildOutboxCommandInput): CanonicalOutboxCommand {
  const recipient = normalizeWaIdDigits(input.action.waId);
  const messageText = asText(input.action.finalMessage) ?? asText(input.action.draftMessage);
  const idempotencyKey = asText(input.action.idempotencyKey);

  if (!recipient) {
    throw new Error("missing recipient for outbox command");
  }
  if (!messageText) {
    throw new Error("missing message for outbox command");
  }
  if (!idempotencyKey) {
    throw new Error("missing idempotency key for outbox command");
  }

  const commandId = `outbox:action:${input.action.actionId}:${idempotencyKey}`;

  return {
    commandId,
    idempotencyKey: commandId,
    actionId: input.action.actionId,
    opportunityId: input.action.opportunityId,
    decisionId: input.action.decisionId,
    conversationCaseId: input.action.conversationCaseId,
    channel: EXECUTION_GATE_SUPPORTED_CHANNEL,
    commandType: EXECUTION_GATE_SUPPORTED_COMMAND_TYPE,
    recipient,
    messageText,
    metadata: {
      source: "ai_sdr",
      sandbox: true,
      riskLevel: input.action.riskLevel,
      approvalRequirement: input.action.approvalRequirement,
      lifecycleVersion: input.action.lifecycleVersion ?? null,
      policyVersion: input.action.policyVersion ?? null,
      runtimeVersion: input.action.runtimeVersion ?? null
    },
    createdAt: input.evaluatedAt
  };
}
