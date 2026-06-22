import {
  isRecoverableLeaseStatus,
  isReclaimableOutboxStatus,
  isTerminalOutboxStatus,
  maskRecipientForAudit,
  normalizeCommandText,
  normalizeIsoTimestamp
} from "./constants";
import type { OutboxCandidateEvaluation, OutboxWorkerConfig, OutboxWorkerPlanReason, OutboxMessageRecord } from "./types";

function pushReason(reasons: OutboxWorkerPlanReason[], reason: OutboxWorkerPlanReason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function buildBaseEvaluation(input: {
  now: string;
  record: OutboxMessageRecord;
  config: OutboxWorkerConfig;
}): OutboxCandidateEvaluation {
  const sanitizedStatus = input.record.status;
  const availableAt = normalizeIsoTimestamp(input.record.availableAt) ?? input.now;
  const expiresAt = normalizeIsoTimestamp(input.record.expiresAt);
  const leaseExpiresAt = normalizeIsoTimestamp(input.record.leaseExpiresAt);
  const attemptCount = Number.isFinite(input.record.attemptCount) ? Math.max(0, Math.floor(input.record.attemptCount)) : 0;
  const maxAttempts = Number.isFinite(input.record.maxAttempts) ? Math.max(0, Math.floor(input.record.maxAttempts)) : 0;
  const attemptsRemaining = Math.max(0, maxAttempts - attemptCount);

  return {
    decision: "skip",
    actionable: false,
    reasons: [],
    warnings: [],
    recordId: input.record.rowId,
    commandId: input.record.commandId,
    idempotencyKey: input.record.idempotencyKey,
    actionId: input.record.actionId,
    status: sanitizedStatus,
    channel: input.record.channel,
    commandType: input.record.commandType,
    recipientMasked: maskRecipientForAudit(input.record.recipient),
    availableAt,
    expiresAt,
    leaseExpiresAt,
    claimedBy: input.record.claimedBy,
    claimOwnedByWorker: false,
    leaseExpired: leaseExpiresAt !== null ? leaseExpiresAt <= input.now : false,
    claimRecoverable: false,
    attemptCount,
    maxAttempts,
    attemptsRemaining,
    sandbox: Boolean(input.record.metadata?.sandbox),
    transportEnabled: input.config.transportEnabled,
    workerEnabled: input.config.workerEnabled,
    workerId: input.config.workerId,
    now: input.now
  };
}

export function evaluateOutboxCandidate(input: {
  now: string;
  record: OutboxMessageRecord;
  config: OutboxWorkerConfig;
}): OutboxCandidateEvaluation {
  const evaluation = buildBaseEvaluation(input);
  const reasons = evaluation.reasons;
  const warnings = evaluation.warnings;
  const now = normalizeIsoTimestamp(input.now);

  if (!now) {
    pushReason(reasons, "worker_disabled");
    return {
      ...evaluation,
      decision: "invalid",
      actionable: false,
      warnings: [...warnings, "Invalid evaluation timestamp."]
    };
  }

  const commandId = normalizeCommandText(input.record.commandId);
  if (!input.config.workerEnabled) {
    pushReason(reasons, "worker_disabled");
    return { ...evaluation, decision: "skip", actionable: false, warnings };
  }

  if (!input.config.transportEnabled) {
    pushReason(reasons, "transport_disabled");
    return { ...evaluation, decision: "skip", actionable: false, warnings };
  }

  if (!commandId) {
    pushReason(reasons, "missing_command_id");
    return { ...evaluation, decision: "invalid", actionable: false, warnings };
  }

  if (!normalizeCommandText(input.record.idempotencyKey)) {
    pushReason(reasons, "missing_idempotency_key");
    return { ...evaluation, decision: "invalid", actionable: false, warnings };
  }

  if (!normalizeCommandText(input.record.actionId)) {
    pushReason(reasons, "missing_action_id");
    return { ...evaluation, decision: "invalid", actionable: false, warnings };
  }

  if (input.record.channel !== "whatsapp") {
    pushReason(reasons, "unsupported_channel");
    return { ...evaluation, decision: "invalid", actionable: false, warnings };
  }

  if (input.record.commandType !== "whatsapp_text") {
    pushReason(reasons, "unsupported_command_type");
    return { ...evaluation, decision: "invalid", actionable: false, warnings };
  }

  if (input.config.sandboxRequired && !input.record.metadata?.sandbox) {
    pushReason(reasons, "sandbox_required");
    return { ...evaluation, decision: "invalid", actionable: false, warnings };
  }

  if (!isReclaimableOutboxStatus(input.record.status) && !isRecoverableLeaseStatus(input.record.status) && !isTerminalOutboxStatus(input.record.status)) {
    pushReason(reasons, "status_not_reclaimable");
    return { ...evaluation, decision: "invalid", actionable: false, warnings };
  }

  if (isTerminalOutboxStatus(input.record.status)) {
    pushReason(reasons, "status_not_reclaimable");
    pushReason(reasons, "terminal_status");
    return { ...evaluation, decision: "skip", actionable: false, warnings };
  }

  if (evaluation.availableAt > now) {
    pushReason(reasons, "not_yet_available");
    return { ...evaluation, decision: "skip", actionable: false, warnings };
  }

  if (evaluation.expiresAt && now >= evaluation.expiresAt) {
    pushReason(reasons, "message_expired");
    return { ...evaluation, decision: "expire", actionable: false, warnings };
  }

  if (evaluation.maxAttempts > 0 && evaluation.attemptCount >= evaluation.maxAttempts) {
    pushReason(reasons, "attempts_exhausted");
    return { ...evaluation, decision: "dead_letter", actionable: false, warnings };
  }

  if (!normalizeCommandText(input.record.recipient)) {
    pushReason(reasons, "missing_recipient");
    return { ...evaluation, decision: "invalid", actionable: false, warnings };
  }

  if (!normalizeCommandText(input.record.messageText)) {
    pushReason(reasons, "missing_message");
    return { ...evaluation, decision: "invalid", actionable: false, warnings };
  }

  const leasedStatuses = isRecoverableLeaseStatus(input.record.status);
  const ownedByCurrentWorker = input.record.claimedBy === null || input.record.claimedBy === input.config.workerId;
  const leaseExpired = evaluation.leaseExpiresAt !== null ? evaluation.leaseExpiresAt <= now : false;
  const recoverableLease = leasedStatuses && leaseExpired && input.config.recoverExpiredLeases;

  if (leasedStatuses && !ownedByCurrentWorker && !recoverableLease) {
    pushReason(reasons, "wrong_worker_claim");
    return { ...evaluation, decision: "skip", actionable: false, warnings };
  }

  if (leasedStatuses && !recoverableLease && evaluation.leaseExpiresAt !== null && evaluation.leaseExpiresAt > now && input.record.claimedBy && input.record.claimedBy !== input.config.workerId) {
    pushReason(reasons, "active_lease");
    return { ...evaluation, decision: "skip", actionable: false, warnings };
  }

  if (leasedStatuses && leaseExpired && !input.config.recoverExpiredLeases && input.record.claimedBy && input.record.claimedBy !== input.config.workerId) {
    pushReason(reasons, "lease_not_recoverable");
    return { ...evaluation, decision: "skip", actionable: false, warnings };
  }

  const claimOwnedByWorker = ownedByCurrentWorker || recoverableLease;
  const claimRecoverable = leasedStatuses && leaseExpired && input.config.recoverExpiredLeases;

  return {
    ...evaluation,
    decision: "process",
    actionable: true,
    reasons,
    warnings,
    commandId,
    claimOwnedByWorker,
    claimRecoverable
  };
}
