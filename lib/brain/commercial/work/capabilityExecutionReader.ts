import { queryRows } from "@/lib/db";
import type { CommercialCapabilityExecutionProjection } from "./types";

export type LoadRecentCommercialCapabilityExecutionsInput = {
  opportunityId?: number | null;
  conversationId?: number | null;
  capabilityNames?: readonly string[];
  limit?: number;
};

function parseJson(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value !== "string") return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return asText(value);
}

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "bigint") return value !== 0n;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  return false;
}

export async function loadRecentCommercialCapabilityExecutions(
  input: LoadRecentCommercialCapabilityExecutionsInput
): Promise<CommercialCapabilityExecutionProjection[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (typeof input.opportunityId === "number") {
    where.push("opportunity_id = ?");
    params.push(input.opportunityId);
  }
  if (typeof input.conversationId === "number") {
    where.push("conversation_id = ?");
    params.push(input.conversationId);
  }
  const capabilityNames = [...new Set((input.capabilityNames ?? []).filter((name) => typeof name === "string" && name.trim()))];
  if (capabilityNames.length > 0) {
    where.push(`capability_name IN (${capabilityNames.map(() => "?").join(",")})`);
    params.push(...capabilityNames);
  }

  if (where.length === 0) return [];

  params.push(Math.max(1, Math.min(input.limit ?? 20, 100)));
  const rows = await queryRows<Record<string, unknown>>(
    `SELECT id, public_id, capability_name, execution_status, retryable, error_code, response_summary_json, completed_at
      FROM crm_capability_executions
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(completed_at, updated_at, created_at) DESC, id DESC
      LIMIT ?`,
    params
  );

  return rows.map((row) => ({
    id: asText(row.id) ?? undefined,
    publicId: asText(row.public_id) ?? "",
    capabilityName: asText(row.capability_name) ?? "",
    executionStatus: (asText(row.execution_status) ?? "failed") as CommercialCapabilityExecutionProjection["executionStatus"],
    retryable: asBool(row.retryable),
    errorCode: asText(row.error_code),
    responseSummaryJson: parseJson(row.response_summary_json),
    completedAt: asIso(row.completed_at)
  }));
}
