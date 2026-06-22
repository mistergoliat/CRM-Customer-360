import { createHash } from "node:crypto";
import { maskWaId, normalizeWaIdDigits } from "../../commercial/autonomy-sandbox";
import type { OutboxWorkerAuditEventType, OutboxWorkerPlanReason, OutboxWorkerPlanType } from "./types";

export const OUTBOX_WORKER_VERSION = "brain.messaging.outbox-worker.v1" as const;

export const OUTBOX_WORKER_PLAN_TYPES = [
  "no_change",
  "mark_processing",
  "mark_delivered",
  "schedule_retry",
  "mark_failed",
  "move_to_dead_letter",
  "expire_message",
  "release_claim"
] as const satisfies readonly OutboxWorkerPlanType[];

export const OUTBOX_WORKER_AUDIT_EVENT_TYPES = [
  "outbox_processing_started",
  "outbox_delivered",
  "outbox_retry_scheduled",
  "outbox_failed",
  "outbox_dead_lettered",
  "outbox_expired",
  "outbox_claim_released"
] as const satisfies readonly OutboxWorkerAuditEventType[];

export const OUTBOX_WORKER_PLAN_REASONS = [
  "worker_disabled",
  "transport_disabled",
  "sandbox_required",
  "missing_command_id",
  "missing_idempotency_key",
  "missing_action_id",
  "unsupported_channel",
  "unsupported_command_type",
  "status_not_reclaimable",
  "terminal_status",
  "not_yet_available",
  "message_expired",
  "attempts_exhausted",
  "missing_recipient",
  "missing_message",
  "wrong_worker_claim",
  "lease_not_recoverable",
  "active_lease",
  "processing_plan_failure",
  "final_plan_failure",
  "transport_accepted",
  "transport_duplicate_accepted",
  "transport_temporary_failure",
  "transport_rate_limited",
  "transport_timeout",
  "transport_permanent_failure",
  "retry_exhausted",
  "duplicate_plan_key",
  "duplicate_idempotency_key",
  "repository_failure",
  "expired",
  "idempotent_plan_reused"
] as const satisfies readonly OutboxWorkerPlanReason[];

export const OUTBOX_WORKER_TERMINAL_STATUSES = ["delivered", "dead_letter", "cancelled"] as const;
export const OUTBOX_WORKER_RECLAIMABLE_STATUSES = ["pending", "retry_scheduled"] as const;
export const OUTBOX_WORKER_RECOVERABLE_LEASE_STATUSES = ["claimed", "processing"] as const;

export const OUTBOX_WORKER_PERMANENT_FAILURE_CODES = [
  "invalid_recipient",
  "invalid_payload",
  "authentication_error",
  "permission_error",
  "policy_rejected",
  "provider_duplicate"
] as const;

export const OUTBOX_WORKER_RETRYABLE_FAILURE_CODES = [
  "network_error",
  "timeout",
  "rate_limited",
  "provider_unavailable",
  "unknown",
  "none"
] as const;

export function buildStableDigest(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildOutboxWorkerPlanId(input: {
  rowId: number | string;
  commandId: string;
  attemptCount: number;
  planType: OutboxWorkerPlanType;
  createdAt: string;
}): string {
  const digest = buildStableDigest(input);
  return `outbox-worker-plan:${digest.slice(0, 24)}`;
}

export function buildOutboxWorkerPlanKey(input: {
  rowId: number | string;
  commandId: string;
  attemptCount: number;
  planType: OutboxWorkerPlanType;
  createdAt: string;
}): string {
  const digest = buildStableDigest(input);
  return `outbox-worker:${input.commandId}:${input.planType}:${digest.slice(0, 24)}`;
}

export function buildOutboxAuditEventId(input: {
  rowId: number | string;
  commandId: string;
  attemptCount: number;
  planType: OutboxWorkerPlanType;
  eventType: OutboxWorkerAuditEventType;
  createdAt: string;
}): string {
  const digest = buildStableDigest(input);
  return `outbox-audit:${input.commandId}:${input.eventType}:${digest.slice(0, 24)}`;
}

export function buildFakeProviderMessageId(input: {
  commandId: string;
}): string {
  return `fake-provider:${input.commandId}`;
}

export function sanitizeOutboxWorkerErrorMessage(value: unknown, limit = 180): string | null {
  if (typeof value !== "string") return null;
  const compact = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, "Bearer [redacted]")
    .replace(/\b(token|secret|password|authorization)\b[:=]\s*[^\s]+/gi, "$1=[redacted]")
    .replace(/\b\d{6,}\b/g, "[redacted]")
    .trim();
  if (!compact) return null;
  return compact.length > limit ? `${compact.slice(0, limit - 3)}...` : compact;
}

export function maskRecipientForAudit(value: string | null | undefined): string | null {
  return maskWaId(normalizeWaIdDigits(value));
}

export function normalizeCommandText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeIsoTimestamp(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function addSecondsToIso(value: string, seconds: number): string {
  const parsed = new Date(value);
  return new Date(parsed.getTime() + seconds * 1000).toISOString();
}

export function minIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

export function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

export function isTerminalOutboxStatus(status: string) {
  return (OUTBOX_WORKER_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isRecoverableLeaseStatus(status: string) {
  return (OUTBOX_WORKER_RECOVERABLE_LEASE_STATUSES as readonly string[]).includes(status);
}

export function isReclaimableOutboxStatus(status: string) {
  return (OUTBOX_WORKER_RECLAIMABLE_STATUSES as readonly string[]).includes(status);
}

export function isRetryableTransportErrorCode(code: string) {
  return (OUTBOX_WORKER_RETRYABLE_FAILURE_CODES as readonly string[]).includes(code);
}

export function isPermanentTransportErrorCode(code: string) {
  return (OUTBOX_WORKER_PERMANENT_FAILURE_CODES as readonly string[]).includes(code);
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}
