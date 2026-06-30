import { hasTable, safeQueryRows } from "@/lib/db";

export type AgentRuntimeMetrics = {
  totalTurns: number;
  autonomousResolutionRate: number | null;
  humanTransferRate: number | null;
  toolSuccessRate: number | null;
  actionSuccessRate: number | null;
  groundingFailureRate: number | null;
  averageIterationsPerTurn: number | null;
};

type ToolCallRow = { toolName: string; status: string };

function parseToolCalls(value: unknown): ToolCallRow[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const DURABLE_WRITE_TOOLS = new Set(["create_or_update_opportunity", "create_follow_up_action", "request_human_handoff"]);

/**
 * Computes the metrics the product brief asks to track (positive_csat_rate
 * and recontact/abandonment require operator/CSAT data this MVP does not yet
 * collect, so they are intentionally left out rather than faked). All rates
 * are computed from crm_agent_turn, the durable record of what actually
 * happened -- not from ai_* traces.
 */
export async function computeAgentRuntimeMetrics(since?: string): Promise<AgentRuntimeMetrics> {
  if (!(await hasTable("crm_agent_turn"))) {
    return {
      totalTurns: 0,
      autonomousResolutionRate: null,
      humanTransferRate: null,
      toolSuccessRate: null,
      actionSuccessRate: null,
      groundingFailureRate: null,
      averageIterationsPerTurn: null
    };
  }

  const params: string[] = [];
  let whereClause = "";
  if (since) {
    whereClause = "WHERE started_at >= ?";
    params.push(since);
  }

  const result = await safeQueryRows<{ final_decision: string; iterations: number; grounded: number; tool_calls_json: unknown }>(
    `SELECT final_decision, iterations, grounded, tool_calls_json FROM crm_agent_turn ${whereClause}`,
    params
  );
  if (!result.ok || result.rows.length === 0) {
    return {
      totalTurns: 0,
      autonomousResolutionRate: null,
      humanTransferRate: null,
      toolSuccessRate: null,
      actionSuccessRate: null,
      groundingFailureRate: null,
      averageIterationsPerTurn: null
    };
  }

  const totalTurns = result.rows.length;
  let handoffCount = 0;
  let groundingFailures = 0;
  let totalIterations = 0;
  let toolCallTotal = 0;
  let toolCallOk = 0;
  let durableActionTotal = 0;
  let durableActionOk = 0;

  for (const row of result.rows) {
    if (row.final_decision === "handoff") handoffCount += 1;
    if (!row.grounded) groundingFailures += 1;
    totalIterations += Number(row.iterations) || 0;

    for (const call of parseToolCalls(row.tool_calls_json)) {
      toolCallTotal += 1;
      if (call.status === "ok") toolCallOk += 1;
      if (DURABLE_WRITE_TOOLS.has(call.toolName)) {
        durableActionTotal += 1;
        if (call.status === "ok") durableActionOk += 1;
      }
    }
  }

  return {
    totalTurns,
    autonomousResolutionRate: (totalTurns - handoffCount) / totalTurns,
    humanTransferRate: handoffCount / totalTurns,
    toolSuccessRate: toolCallTotal > 0 ? toolCallOk / toolCallTotal : null,
    actionSuccessRate: durableActionTotal > 0 ? durableActionOk / durableActionTotal : null,
    groundingFailureRate: groundingFailures / totalTurns,
    averageIterationsPerTurn: totalIterations / totalTurns
  };
}
