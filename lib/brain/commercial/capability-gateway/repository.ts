import { randomUUID } from "node:crypto";
import { safeExecute } from "@/lib/db";
import type { CapabilityAvailabilityStatus, CapabilityEvidence, CapabilityGatewayExecutionStatus } from "./types";

function toMysqlDatetime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 23).replace("T", " ");
}

export type InsertCapabilityExecutionInput = {
  correlationId: string;
  capabilityName: string;
  capabilityVersion: string;
  availabilityStatus: CapabilityAvailabilityStatus;
  executionStatus: CapabilityGatewayExecutionStatus;
  retryCount: number;
  retryable: boolean;
  errorCode: string | null;
  requestSummary: Record<string, unknown>;
  responseSummary: Record<string, unknown> | null;
  evidence: CapabilityEvidence[];
  commercialEventId?: string | null;
  decisionId?: string | null;
  actionId?: string | null;
  actionRowId?: number | null;
  opportunityId?: number | null;
  conversationId?: number | null;
  requestId?: string | null;
  startedAt: string;
  completedAt: string;
};

export async function insertCapabilityExecution(
  input: InsertCapabilityExecutionInput
): Promise<{ ok: boolean; publicId: string | null; error: string | null }> {
  const publicId = randomUUID();
  const result = await safeExecute(
    `
      INSERT INTO crm_capability_executions (
        public_id, correlation_id, capability_name, capability_version,
        availability_status, execution_status, retry_count, retryable, error_code,
        request_summary_json, response_summary_json, evidence_json,
        commercial_event_id, decision_id, action_id, action_row_id,
        opportunity_id, conversation_id, request_id,
        started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      publicId,
      input.correlationId,
      input.capabilityName,
      input.capabilityVersion,
      input.availabilityStatus,
      input.executionStatus,
      input.retryCount,
      input.retryable ? 1 : 0,
      input.errorCode,
      JSON.stringify(input.requestSummary),
      input.responseSummary ? JSON.stringify(input.responseSummary) : null,
      JSON.stringify(input.evidence),
      input.commercialEventId ?? null,
      input.decisionId ?? null,
      input.actionId ?? null,
      input.actionRowId ?? null,
      input.opportunityId ?? null,
      input.conversationId ?? null,
      input.requestId ?? null,
      toMysqlDatetime(input.startedAt),
      toMysqlDatetime(input.completedAt)
    ]
  );

  if (!result.ok) return { ok: false, publicId: null, error: result.error };
  return { ok: true, publicId, error: null };
}
