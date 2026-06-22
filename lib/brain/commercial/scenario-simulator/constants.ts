import { createHash } from "node:crypto";
import { maskAutonomousLoopWaId } from "../autonomous-loop";
import type { ScenarioExecutionModeValue } from "./types";

export const SCENARIO_SIMULATOR_VERSION = "brain.commercial.scenario-simulator.v1" as const;

export const SCENARIO_EXECUTION_MODES = ["observe", "simulate", "execute_fake"] as const satisfies readonly ScenarioExecutionModeValue[];

export const SCENARIO_ALLOWED_CATEGORIES = [
  "sales",
  "follow_up",
  "risk",
  "human_handoff",
  "transport",
  "idempotency",
  "lifecycle",
  "failure"
] as const;

export const SCENARIO_ALLOWED_RECIPIENTS = [
  "56911111111",
  "56922222222",
  "56933333333",
  "56944444444",
  "56955555555",
  "56966666666",
  "56977777777",
  "56988888888",
  "56999999999"
] as const;

export const SCENARIO_ALLOWED_PATHS = [
  "loop.status",
  "loop.finalStage",
  "action.status",
  "outbox.status",
  "delivery.status",
  "followUp.schedulingResult.decision",
  "followUp.mutationPlan.planType",
  "runtime.actions.count",
  "runtime.outbox.count",
  "runtime.audit.count",
  "sideEffects.realMessageSent",
  "sideEffects.metaCalled",
  "sideEffects.realDatabaseWritten",
  "sideEffects.realOutboxWritten",
  "sideEffects.schedulerTriggered",
  "report.result.status"
] as const;

function buildDigest(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildScenarioRunId(input: {
  scenarioId: string;
  stepCount: number;
  tenantId: string;
  initialStateHash: string;
}): string {
  return `scenario-run:${buildDigest(input).slice(0, 24)}`;
}

export function buildScenarioStepRunId(input: {
  runId: string;
  stepId: string;
  index: number;
  now: string;
}): string {
  return `scenario-step:${buildDigest(input).slice(0, 24)}`;
}

export function buildScenarioReportId(input: {
  runId: string;
  scenarioId: string;
  status: string;
  completedAt: string;
}): string {
  return `scenario-report:${buildDigest(input).slice(0, 24)}`;
}

export function buildScenarioExpectationResultId(input: {
  runId: string;
  stepId: string;
  expectationId: string;
  operator: string;
  path: string;
}): string {
  return `scenario-expectation:${buildDigest(input).slice(0, 24)}`;
}

export function normalizeScenarioDigits(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D+/g, "");
  return digits.length > 0 ? digits : null;
}

export function isScenarioRecipientAllowed(value: string | null | undefined): boolean {
  const digits = normalizeScenarioDigits(value);
  if (!digits) return false;
  return (SCENARIO_ALLOWED_RECIPIENTS as readonly string[]).includes(digits);
}

export function sanitizeScenarioText(value: unknown, limit = 180): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : String(value);
  const normalized = text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:\+?\d[\d\s-]{6,}\d)\b/g, "[redacted]")
    .replace(/(authorization|api[-_]?key|token|secret|password|cookie)\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized.slice(0, limit) : null;
}

export function containsForbiddenScenarioText(value: unknown): boolean {
  const text = sanitizeScenarioText(value, 500);
  if (!text) return false;
  return /Bearer\s+\[redacted\]|localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|token|secret|password|graph\.facebook|https?:\/\//i.test(text);
}

export function maskScenarioWaId(value: string | null | undefined): string | null {
  return maskAutonomousLoopWaId(value);
}

export function overrideScenarioMode<T extends { mode: ScenarioExecutionModeValue }>(
  value: T,
  mode: ScenarioExecutionModeValue
): T {
  return { ...value, mode } as T;
}
