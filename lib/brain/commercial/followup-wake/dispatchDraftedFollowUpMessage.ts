// SALES-AGENT-R3-A05. Generalizes objectiveAwareFollowUp.ts's own
// bypass-the-LLM template-dispatch pattern
// (docs/architecture/SALES-AGENT-R3-A00-target-architecture.md Phase 2.G)
// for the follow-up rows R2's objective-aware payload shape does not cover -
// today, every schedule_followup row the native shadow/operational-loop
// runtime produces (runCommercialExecutionBridge.ts#resolveFollowUpSchedulingContext,
// the currently-enabled-by-default commercial runtime per docs/ACTIVE_RELEASE.md).
//
// That row already carries a durable, previously-decided draft_message
// (buildAgentActionFromNextAction.ts sets draftMessage: nextAction.draftMessage
// at schedule time) - this function's only job is to dispatch it through the
// canonical outbound path, the same way objectiveAwareFollowUp.ts's own
// buildSendAction/executeActionThroughGate call does for R2. It never calls
// an LLM and never replays the draft as if the customer had said it.

import { createHash } from "node:crypto";
import { persistAgentAction, type CrmAgentAction } from "@/lib/brain/commercial/action-queue";
import { buildSandboxAutonomyConfig, evaluateAgentActionForSandbox, normalizeWaIdDigits } from "@/lib/brain/commercial/autonomy-sandbox";
import { executeActionThroughGate, SqlExecutionUnitOfWork } from "@/lib/brain/commercial/execution-gate";

/** Preserves the exact fallback text the legacy re-entry path used before this task, for behavior parity. */
export const FOLLOW_UP_DRAFT_MESSAGE_FALLBACK = "Hola, ¿en qué puedo ayudarte?";

export type DispatchDraftedFollowUpMessageInput = {
  actionPublicId: string;
  attemptNumber: number;
  opportunityId: number | null;
  conversationId: number;
  waId: string;
  draftMessage: string | null;
  caseStatus: string | null;
  humanOwnerActive: boolean;
  aiEnabled: boolean;
  now: string;
};

/**
 * Deliberately narrow - callers (runFollowupTick.ts, objectiveAwareFollowUp.ts's
 * own sibling result shape) only ever branch on status/reason today; the
 * full CrmAgentAction/PersistAgentActionResult/ExecutionGateResult this
 * function computes internally are not carried in the return value, since
 * nothing downstream reads them (avoids an unused-field surface, and the
 * heavy fixture weight that would otherwise fall on every test of this
 * function). outboxId is the one piece worth surfacing - cheap, and useful
 * for a caller that wants to correlate the dispatched message later.
 */
export type DispatchDraftedFollowUpMessageResult =
  | { status: "sent"; outboxId: number | null }
  | { status: "blocked"; reason: string };

function buildSendAction(input: DispatchDraftedFollowUpMessageInput): CrmAgentAction {
  const message = input.draftMessage ?? FOLLOW_UP_DRAFT_MESSAGE_FALLBACK;
  const seed = { kind: "followup_wake_send", actionPublicId: input.actionPublicId, attempt: input.attemptNumber };
  const digest = createHash("sha256").update(JSON.stringify(seed)).digest("hex");
  return {
    id: null,
    actionId: `crm-agent-action-${digest.slice(0, 24)}`,
    idempotencyKey: `followup-wake-send:${digest}`,
    opportunityId: input.opportunityId,
    decisionId: null,
    decisionRowId: null,
    conversationCaseId: input.conversationId,
    messageId: null,
    waId: input.waId,
    channel: "whatsapp",
    actionType: "send_whatsapp_reply",
    status: "planned",
    riskLevel: "low",
    approvalRequirement: "none",
    draftPayload: {
      kind: "followup_wake_send",
      schemaVersion: "1.0",
      scheduleActionId: input.actionPublicId,
      attempt: input.attemptNumber
    },
    finalPayload: null,
    executionPayload: null,
    draftMessage: message,
    finalMessage: null,
    scheduledFor: null,
    expiresAt: null,
    attemptNumber: 1,
    maxAttempts: 1,
    followUpSequenceKey: null,
    followUpConfigurationSource: null,
    followUpConfigurationId: null,
    followUpConfigurationVersion: null,
    followUpConfigurationHash: null,
    blockReasons: [],
    cancelReason: null,
    failureReason: null,
    policyStatus: "allowed",
    policyNotes: ["followup_wake_drafted_dispatch"],
    source: "system",
    createdBy: "system",
    approvedBy: null,
    approvedAt: null,
    executedAt: null,
    cancelledAt: null,
    outboxMessageId: null,
    lifecycleVersion: "brain.commercial.action-lifecycle.v1",
    policyVersion: "followup-wake.v1",
    runtimeVersion: "sales-agent-r3-a05",
    createdAt: input.now,
    updatedAt: null
  };
}

/**
 * Dispatches a follow-up row's already-drafted message through the same
 * canonical, governed outbound path R2's objective-aware follow-up already
 * uses (persistAgentAction -> sandbox evaluation -> executeActionThroughGate
 * -> canonical outbox) - never a direct send, never a second outbox writer.
 * Throws only on a genuine unexpected/technical failure (mirrors this
 * module's caller contract, runFollowupTick.ts's try/catch around the old
 * cycleRunner call).
 */
export async function dispatchDraftedFollowUpMessage(
  input: DispatchDraftedFollowUpMessageInput
): Promise<DispatchDraftedFollowUpMessageResult> {
  const sendAction = buildSendAction(input);
  const persistence = await persistAgentAction({
    action: sendAction,
    currentTime: input.now,
    featureFlags: { queueEnabled: true, persistenceEnabled: true }
  });
  if (!(persistence.status === "inserted" || persistence.status === "updated_existing" || persistence.status === "duplicate_ignored")) {
    throw new Error(`followup_wake_send_persistence_failed:${persistence.error ?? persistence.status}`);
  }

  const waId = normalizeWaIdDigits(persistence.action.waId);
  const sandboxEvaluation = evaluateAgentActionForSandbox(
    persistence.action,
    {
      now: input.now,
      caseId: String(input.conversationId),
      caseStatus: input.caseStatus,
      lifecycleStatus: input.caseStatus,
      humanOwnerActive: input.humanOwnerActive,
      aiBlocked: !input.aiEnabled,
      requiresHuman: false,
      policyStatus: "allowed",
      conflictingActionExists: false
    },
    buildSandboxAutonomyConfig({
      sandboxEnabled: true,
      autonomousReplyEnabled: true,
      whitelistedWaIds: waId ? [waId] : [],
      allowedActionTypes: ["send_whatsapp_reply"],
      maxRiskLevel: "low"
    })
  );

  const executionGate = await executeActionThroughGate(
    {
      now: input.now,
      action: persistence.action,
      config: { executionGateEnabled: true, outboxBridgeEnabled: true, sandboxModeRequired: true },
      context: {
        caseId: String(input.conversationId),
        caseStatus: input.caseStatus,
        lifecycleStatus: input.caseStatus,
        humanOwnerActive: input.humanOwnerActive,
        aiBlocked: !input.aiEnabled,
        requiresHuman: false,
        policyStatus: "allowed",
        conflictingActionExists: false
      },
      sandboxEvaluation
    },
    { unitOfWork: new SqlExecutionUnitOfWork() }
  );

  if (executionGate.allowed || executionGate.status === "duplicate") {
    return { status: "sent", outboxId: executionGate.repositoryResult.outboxRowId };
  }
  return { status: "blocked", reason: executionGate.blockReasons[0] ?? executionGate.status };
}
