import { hasTable, safeQueryRows } from "@/lib/db";
import { loadOrInitAgentConversationState } from "./state";
import type { AgentConversationState } from "./types";

export type AgentOperationalTurnSummary = {
  turnId: string;
  startedAt: string;
  completedAt: string | null;
  finalDecision: string;
  lines: string[];
};

export type AgentOperationalView = {
  state: AgentConversationState | null;
  turns: AgentOperationalTurnSummary[];
};

const TOOL_NARRATION: Record<string, (input: Record<string, unknown>) => string> = {
  get_customer_context: () => "Revisó el contexto del cliente.",
  search_products: (input) => `Consultó catálogo${typeof input.query === "string" ? ` ("${input.query}")` : ""}.`,
  get_product_detail: () => "Revisó el detalle de un producto.",
  get_related_products: () => "Comparó alternativas relacionadas.",
  create_or_update_opportunity: () => "Creó o actualizó una oportunidad comercial.",
  create_follow_up_action: () => "Agendó un seguimiento.",
  request_human_handoff: () => "Marcó el caso para una persona del equipo."
};

function narrateToolCall(toolName: string, input: Record<string, unknown>, status: string) {
  const narrate = TOOL_NARRATION[toolName];
  const base = narrate ? narrate(input) : `Usó la herramienta ${toolName}.`;
  return status === "ok" ? base : `${base} (no se pudo completar)`;
}

/**
 * Operator-facing summary, not chain-of-thought: short, factual lines about
 * what the agent did, derived from the durable tool-call record, never from
 * the model's raw "thought" text.
 */
export async function buildAgentOperationalView(conversationId: number, turnLimit = 10): Promise<AgentOperationalView> {
  const { state } = await loadOrInitAgentConversationState(conversationId);

  if (!(await hasTable("crm_agent_turn"))) {
    return { state, turns: [] };
  }

  const rows = await safeQueryRows<Record<string, unknown>>(
    "SELECT turn_id, started_at, completed_at, final_decision, tool_calls_json FROM crm_agent_turn WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
    [conversationId, turnLimit]
  );
  if (!rows.ok) {
    return { state, turns: [] };
  }

  const turns: AgentOperationalTurnSummary[] = rows.rows.map((row) => {
    let toolCalls: Array<{ toolName: string; input: Record<string, unknown>; status: string }> = [];
    try {
      const parsed = typeof row.tool_calls_json === "string" ? JSON.parse(row.tool_calls_json) : row.tool_calls_json;
      if (Array.isArray(parsed)) toolCalls = parsed;
    } catch {
      toolCalls = [];
    }
    return {
      turnId: String(row.turn_id),
      startedAt: String(row.started_at),
      completedAt: row.completed_at ? String(row.completed_at) : null,
      finalDecision: String(row.final_decision),
      lines: toolCalls.map((call) => narrateToolCall(call.toolName, call.input ?? {}, call.status))
    };
  });

  return { state, turns };
}
