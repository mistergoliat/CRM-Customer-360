import { createHash } from "node:crypto";
import type { AutonomousLoopAuditEvent, AutonomousLoopMode, AutonomousLoopStage, AutonomousLoopStatus } from "./types";

export const AUTONOMOUS_COMMERCIAL_LOOP_VERSION = "brain.commercial.autonomous-loop.v1" as const;

export const AUTONOMOUS_LOOP_MODES = ["observe", "simulate", "execute_fake"] as const satisfies readonly AutonomousLoopMode[];

export const AUTONOMOUS_LOOP_STATUSES = [
  "completed",
  "blocked",
  "waiting",
  "cancelled",
  "expired",
  "requires_human",
  "delivered",
  "retry_scheduled",
  "dead_letter",
  "invalid",
  "failed"
] as const satisfies readonly AutonomousLoopStatus[];

export const AUTONOMOUS_LOOP_STAGES = [
  "context",
  "operational_loop",
  "decision",
  "action",
  "sandbox",
  "execution_gate",
  "outbox",
  "worker",
  "transport",
  "delivery_reconciliation",
  "follow_up_scheduling",
  "follow_up_replanning",
  "audit",
  "complete"
] as const satisfies readonly AutonomousLoopStage[];

export const AUTONOMOUS_LOOP_AUDIT_EVENT_TYPES = [
  "loop_started",
  "loop_completed",
  "duplicate_inbound_detected",
  "operational_loop_completed",
  "decision_selected",
  "action_built",
  "sandbox_evaluated",
  "execution_gate_evaluated",
  "outbox_created",
  "outbox_processed",
  "delivery_reconciled",
  "follow_up_evaluated",
  "follow_up_mutated",
  "runtime_state_applied",
  "loop_failed"
] as const;

function buildStableDigest(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildAutonomousLoopRunId(input: {
  tenantId: string;
  correlationId: string;
  messageId: string;
  now: string;
}): string {
  return `autonomous-loop:${buildStableDigest(input).slice(0, 24)}`;
}

export function buildAutonomousAuditEventId(input: {
  runId: string;
  stage: AutonomousLoopStage;
  eventType: string;
  entityId: string | null;
  status: string;
  createdAt: string;
}): string {
  return `autonomous-audit:${buildStableDigest(input).slice(0, 24)}`;
}

export function buildOutboxRecordId(input: {
  runId: string;
  actionId: string;
  commandId: string;
  idempotencyKey: string;
}): string {
  return `autonomous-outbox:${buildStableDigest(input).slice(0, 24)}`;
}

export function buildDeliveryReconciliationId(input: {
  runId: string;
  outboxRowId: number | string | null;
  status: string;
  completedAt: string;
}): string {
  return `autonomous-delivery:${buildStableDigest(input).slice(0, 24)}`;
}

export function sanitizeAutonomousLoopText(value: unknown, limit = 200): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : String(value);
  const normalized = text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:\+?\d[\d\s-]{6,}\d)\b/g, "[redacted]")
    .replace(/(authorization|api[-_]?key|token|secret|password|cookie)\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized.slice(0, limit) : null;
}

export function maskAutonomousLoopWaId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length <= 4) return `${digits.slice(0, 1)}${"*".repeat(Math.max(0, digits.length - 2))}${digits.slice(-1)}`;
  return `${digits.slice(0, 3)}${"*".repeat(Math.max(0, digits.length - 6))}${digits.slice(-3)}`;
}

export function cloneDeep<T>(value: T): T {
  return structuredClone(value);
}

export function isAutonomousLoopStage(value: string): value is AutonomousLoopStage {
  return (AUTONOMOUS_LOOP_STAGES as readonly string[]).includes(value);
}

export function isAutonomousLoopStatus(value: string): value is AutonomousLoopStatus {
  return (AUTONOMOUS_LOOP_STATUSES as readonly string[]).includes(value);
}

export function isAutonomousLoopMode(value: string): value is AutonomousLoopMode {
  return (AUTONOMOUS_LOOP_MODES as readonly string[]).includes(value);
}
