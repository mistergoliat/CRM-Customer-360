import { EXECUTION_GATE_SUPPORTED_COMMAND_TYPE, EXECUTION_GATE_SUPPORTED_CHANNEL } from "./constants";
import type { CanonicalOutboxCommand, ExecutionGateInput } from "./types";
import { normalizeWaIdDigits } from "../autonomy-sandbox";
import { buildCanonicalOutboxDedupeKey } from "../../messaging/canonicalOutboxWriter";

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

  // commandId stays a readable, human-debuggable reference (logged in
  // meta_payload_json); it is NOT the dedupe identity. idempotencyKey is the
  // canonical dedupe_key, built by the same shared function outbox.ts uses
  // (ACS-R1-05-T04.1, P1-4) so the same actionId+idempotencyKey+recipient+
  // content+channel always produces the same key, regardless of adapter.
  const commandId = `outbox:action:${input.action.actionId}:${idempotencyKey}`;
  const dedupeKey = buildCanonicalOutboxDedupeKey({
    channel: EXECUTION_GATE_SUPPORTED_CHANNEL,
    actionId: input.action.actionId,
    idempotencyKey,
    recipient,
    content: messageText
  });

  return {
    commandId,
    idempotencyKey: dedupeKey,
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
