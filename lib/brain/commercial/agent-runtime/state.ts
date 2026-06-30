import { safeQueryRows, queryRows, hasTable } from "@/lib/db";
import type {
  AgentConversationState,
  AgentConversationStateInit,
  AgentCompletedAction,
  AgentConstraint,
  AgentHypothesis,
  AgentKnownFact,
  AgentMissingInformation,
  AgentPendingAction,
  AgentToolset
} from "./types";

const TABLE = "crm_agent_conversation_state";

function toMysqlDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 23).replace("T", " ") : date.toISOString().slice(0, 23).replace("T", " ");
}

function parseJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asToolset(value: unknown): AgentToolset {
  const text = typeof value === "string" ? value : "sales";
  return (["sales", "orders", "maintenance", "post_sales", "customer_service"] as const).includes(text as AgentToolset)
    ? (text as AgentToolset)
    : "sales";
}

function rowToState(row: Record<string, unknown>): AgentConversationState {
  return {
    conversationId: Number(row.conversation_id),
    opportunityId: asNumber(row.opportunity_id),
    customerGoal: typeof row.customer_goal === "string" ? row.customer_goal : null,
    conversationState: (typeof row.conversation_state === "string" ? row.conversation_state : "active") as AgentConversationState["conversationState"],
    knownFacts: parseJsonArray<AgentKnownFact>(row.known_facts_json),
    missingInformation: parseJsonArray<AgentMissingInformation>(row.missing_information_json),
    activeHypotheses: parseJsonArray<AgentHypothesis>(row.active_hypotheses_json),
    constraints: parseJsonArray<AgentConstraint>(row.constraints_json),
    recommendedNextStep: typeof row.recommended_next_step === "string" ? row.recommended_next_step : null,
    pendingActions: parseJsonArray<AgentPendingAction>(row.pending_actions_json),
    completedActions: parseJsonArray<AgentCompletedAction>(row.completed_actions_json),
    unresolvedQuestions: parseJsonArray<string>(row.unresolved_questions_json),
    confidence: asNumber(row.confidence) ?? 0,
    toolset: asToolset(row.toolset),
    humanOwnerActive: Boolean(asNumber(row.human_owner_active)),
    handoffMode: (row.handoff_mode as AgentConversationState["handoffMode"]) ?? null,
    turnCount: asNumber(row.turn_count) ?? 0,
    lastTurnCorrelationId: typeof row.last_turn_correlation_id === "string" ? row.last_turn_correlation_id : null,
    version: asNumber(row.version) ?? 1
  };
}

function emptyState(conversationId: number, init: AgentConversationStateInit = {}): AgentConversationState {
  return {
    conversationId,
    opportunityId: init.opportunityId ?? null,
    customerGoal: init.customerGoal ?? null,
    conversationState: init.conversationState ?? "active",
    knownFacts: init.knownFacts ?? [],
    missingInformation: init.missingInformation ?? [],
    activeHypotheses: init.activeHypotheses ?? [],
    constraints: init.constraints ?? [],
    recommendedNextStep: init.recommendedNextStep ?? null,
    pendingActions: init.pendingActions ?? [],
    completedActions: init.completedActions ?? [],
    unresolvedQuestions: init.unresolvedQuestions ?? [],
    confidence: init.confidence ?? 0,
    toolset: init.toolset ?? "sales",
    humanOwnerActive: init.humanOwnerActive ?? false,
    handoffMode: init.handoffMode ?? null,
    turnCount: 0,
    lastTurnCorrelationId: null,
    version: 1
  };
}

/** Loads existing durable state for a conversation, or builds a fresh in-memory one. Never writes. */
export async function loadOrInitAgentConversationState(
  conversationId: number,
  init: AgentConversationStateInit = {}
): Promise<{ state: AgentConversationState; existed: boolean }> {
  if (!(await hasTable(TABLE))) {
    return { state: emptyState(conversationId, init), existed: false };
  }
  const result = await safeQueryRows<Record<string, unknown>>(`SELECT * FROM ${TABLE} WHERE conversation_id = ? LIMIT 1`, [conversationId]);
  if (result.ok && result.rows[0]) {
    return { state: rowToState(result.rows[0]), existed: true };
  }
  return { state: emptyState(conversationId, init), existed: false };
}

/** Persists the full state, upserting by conversation_id. Append-only in spirit: turn_count only increases. */
export async function saveAgentConversationState(state: AgentConversationState, currentTime: string | Date): Promise<{ ok: boolean; warning: string | null }> {
  if (!(await hasTable(TABLE))) {
    return { ok: false, warning: `${TABLE} unavailable` };
  }
  const now = toMysqlDateTime(currentTime);
  await queryRows(
    `
      INSERT INTO ${TABLE} (
        conversation_id, opportunity_id, customer_goal, conversation_state,
        known_facts_json, missing_information_json, active_hypotheses_json, constraints_json,
        recommended_next_step, pending_actions_json, completed_actions_json, unresolved_questions_json,
        confidence, toolset, human_owner_active, handoff_mode, turn_count, last_turn_correlation_id,
        version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        opportunity_id = VALUES(opportunity_id),
        customer_goal = VALUES(customer_goal),
        conversation_state = VALUES(conversation_state),
        known_facts_json = VALUES(known_facts_json),
        missing_information_json = VALUES(missing_information_json),
        active_hypotheses_json = VALUES(active_hypotheses_json),
        constraints_json = VALUES(constraints_json),
        recommended_next_step = VALUES(recommended_next_step),
        pending_actions_json = VALUES(pending_actions_json),
        completed_actions_json = VALUES(completed_actions_json),
        unresolved_questions_json = VALUES(unresolved_questions_json),
        confidence = VALUES(confidence),
        toolset = VALUES(toolset),
        human_owner_active = VALUES(human_owner_active),
        handoff_mode = VALUES(handoff_mode),
        turn_count = VALUES(turn_count),
        last_turn_correlation_id = VALUES(last_turn_correlation_id),
        version = version + 1,
        updated_at = VALUES(updated_at)
    `,
    [
      state.conversationId,
      state.opportunityId,
      state.customerGoal,
      state.conversationState,
      JSON.stringify(state.knownFacts),
      JSON.stringify(state.missingInformation),
      JSON.stringify(state.activeHypotheses),
      JSON.stringify(state.constraints),
      state.recommendedNextStep,
      JSON.stringify(state.pendingActions),
      JSON.stringify(state.completedActions),
      JSON.stringify(state.unresolvedQuestions),
      state.confidence,
      state.toolset,
      state.humanOwnerActive ? 1 : 0,
      state.handoffMode,
      state.turnCount,
      state.lastTurnCorrelationId,
      state.version,
      now,
      now
    ]
  );
  return { ok: true, warning: null };
}

export async function recordAgentTurn(input: {
  turnId: string;
  conversationId: number;
  inboundMessageId: number | string | null;
  correlationId: string;
  iterations: number;
  toolCalls: unknown;
  finalDecision: string;
  responseText: string | null;
  grounded: boolean;
  evaluation: unknown;
  modelName: string;
  startedAt: string;
  completedAt: string;
}): Promise<{ ok: boolean; warning: string | null }> {
  if (!(await hasTable("crm_agent_turn"))) {
    return { ok: false, warning: "crm_agent_turn unavailable" };
  }
  await queryRows(
    `
      INSERT INTO crm_agent_turn (
        turn_id, conversation_id, inbound_message_id, correlation_id, iterations,
        tool_calls_json, final_decision, response_text, grounded, evaluation_json,
        model_name, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        iterations = VALUES(iterations),
        tool_calls_json = VALUES(tool_calls_json),
        final_decision = VALUES(final_decision),
        response_text = VALUES(response_text),
        grounded = VALUES(grounded),
        evaluation_json = VALUES(evaluation_json),
        completed_at = VALUES(completed_at)
    `,
    [
      input.turnId,
      input.conversationId,
      input.inboundMessageId === null ? null : String(input.inboundMessageId),
      input.correlationId,
      input.iterations,
      JSON.stringify(input.toolCalls),
      input.finalDecision,
      input.responseText,
      input.grounded ? 1 : 0,
      input.evaluation === null || input.evaluation === undefined ? null : JSON.stringify(input.evaluation),
      input.modelName,
      toMysqlDateTime(input.startedAt),
      toMysqlDateTime(input.completedAt)
    ]
  );
  return { ok: true, warning: null };
}
