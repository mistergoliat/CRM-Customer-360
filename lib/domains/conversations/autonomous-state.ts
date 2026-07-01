import { safeQueryRows } from "@/lib/db";

/**
 * Shared read of a conversation's autonomous state (actions + executions +
 * outcomes + latest decision), keyed by conversation id.
 *
 * Single source consumed by both `GET /api/conversations/[id]/autonomous` and the
 * conversation workspace page, so the operator-facing narration never diverges.
 * No chain-of-thought is exposed — only factual, governed actions.
 */

const NARRATION: Record<string, (actionType: string, draftMessage: string | null) => string> = {
  send_whatsapp_reply: (_, m) => (m ? `Envió: "${m.slice(0, 60)}${m.length > 60 ? "…" : ""}"` : "Envió respuesta."),
  request_more_context: (_, m) => (m ? `Preguntó: "${m.slice(0, 60)}${m.length > 60 ? "…" : ""}"` : "Solicitó más información."),
  schedule_followup: () => "Programó un seguimiento.",
  take_over_case: () => "Transfirió el caso a un operador.",
  pause_ai: () => "Pausó la automatización.",
  create_internal_task: () => "Creó tarea interna.",
  mark_lost_candidate: () => "Marcó como candidato perdido.",
  prepare_quote_draft: () => "Preparó borrador de cotización.",
  no_action: () => "Sin acción autónoma en este turno."
};

export function narrateAction(actionType: string, draftMessage: string | null): string {
  return (NARRATION[actionType] ?? ((type: string) => `Ejecutó acción: ${type}`))(actionType, draftMessage);
}

export type ConversationActionExecution = {
  executionId: string;
  status: string;
  attemptNumber: number;
  completedAt: string | null;
  errorCode: string | null;
};

export type ConversationActionOutcome = {
  outcomeType: string;
  occurredAt: string;
  providerMessageId: string | null;
};

export type ConversationActionSummary = {
  actionId: string;
  actionType: string;
  status: string;
  narration: string;
  riskLevel: string;
  scheduledFor: string | null;
  createdAt: string;
  executions: ConversationActionExecution[];
  outcomes: ConversationActionOutcome[];
};

export type ConversationAutonomousDecision = {
  nextStatus: string | null;
  nextStage: string | null;
  rationale: string | null;
  createdAt: string;
};

export type ConversationAutonomousState = {
  actions: ConversationActionSummary[];
  pendingActions: number;
  completedActions: number;
  lastDecision: ConversationAutonomousDecision | null;
  error: string | null;
};

export async function loadConversationAutonomousState(conversationId: number): Promise<ConversationAutonomousState> {
  const actionsResult = await safeQueryRows<{
    action_id: string;
    action_type: string;
    status: string;
    risk_level: string;
    draft_message: string | null;
    final_message: string | null;
    scheduled_for: string | null;
    created_at: string;
    updated_at: string;
    outbox_message_id: number | null;
  }>(
    `SELECT a.action_id, a.action_type, a.status, a.risk_level,
            a.draft_message, a.final_message, a.scheduled_for,
            a.created_at, a.updated_at, a.outbox_message_id
      FROM crm_agent_actions a
      WHERE a.conversation_case_id = ?
      ORDER BY a.created_at DESC LIMIT 20`,
    [conversationId]
  );

  if (!actionsResult.ok) {
    return { actions: [], pendingActions: 0, completedActions: 0, lastDecision: null, error: actionsResult.error };
  }

  const actions = actionsResult.rows;
  const actionIds = actions.map((a) => a.action_id);

  let executions: Array<{ execution_id: string; action_id: string; status: string; attempt_number: number; completed_at: string | null; error_code: string | null }> = [];
  let outcomes: Array<{ action_id: string; outcome_type: string; occurred_at: string; provider_message_id: string | null }> = [];

  if (actionIds.length > 0) {
    const placeholders = actionIds.map(() => "?").join(",");
    const [execResult, outcomeResult] = await Promise.all([
      safeQueryRows<{ execution_id: string; action_id: string; status: string; attempt_number: number; completed_at: string | null; error_code: string | null }>(
        `SELECT execution_id, action_id, status, attempt_number, completed_at, error_code
          FROM crm_action_executions
          WHERE action_id IN (${placeholders})
          ORDER BY created_at DESC`,
        actionIds
      ),
      safeQueryRows<{ action_id: string; outcome_type: string; occurred_at: string; provider_message_id: string | null }>(
        `SELECT action_id, outcome_type, occurred_at, provider_message_id
          FROM crm_action_outcomes
          WHERE action_id IN (${placeholders})
          ORDER BY occurred_at DESC`,
        actionIds
      )
    ]);
    executions = execResult.ok ? execResult.rows : [];
    outcomes = outcomeResult.ok ? outcomeResult.rows : [];
  }

  const decisionResult = await safeQueryRows<{ next_status: string | null; next_stage: string | null; rationale: string | null; created_at: string }>(
    `SELECT d.next_status, d.next_stage, d.rationale, d.created_at
      FROM crm_agent_decisions d
      INNER JOIN crm_opportunities o ON o.id = d.opportunity_id
      WHERE o.conversation_case_id = ?
      ORDER BY d.created_at DESC LIMIT 1`,
    [conversationId]
  );
  const lastDecisionRow = decisionResult.ok ? decisionResult.rows[0] ?? null : null;

  const summary: ConversationActionSummary[] = actions.map((a) => ({
    actionId: a.action_id,
    actionType: a.action_type,
    status: a.status,
    narration: narrateAction(a.action_type, a.draft_message ?? a.final_message),
    riskLevel: a.risk_level,
    scheduledFor: a.scheduled_for,
    createdAt: a.created_at,
    executions: executions.filter((e) => e.action_id === a.action_id).map((e) => ({
      executionId: e.execution_id,
      status: e.status,
      attemptNumber: e.attempt_number,
      completedAt: e.completed_at,
      errorCode: e.error_code
    })),
    outcomes: outcomes.filter((o) => o.action_id === a.action_id).map((o) => ({
      outcomeType: o.outcome_type,
      occurredAt: o.occurred_at,
      providerMessageId: o.provider_message_id
    }))
  }));

  const pendingActions = actions.filter((a) => a.status === "proposed" || a.status === "planned").length;
  const completedActions = actions.filter((a) => a.status === "executed" || a.status === "failed" || a.status === "cancelled").length;

  return {
    actions: summary,
    pendingActions,
    completedActions,
    lastDecision: lastDecisionRow
      ? {
          nextStatus: lastDecisionRow.next_status,
          nextStage: lastDecisionRow.next_stage,
          rationale: lastDecisionRow.rationale,
          createdAt: lastDecisionRow.created_at
        }
      : null,
    error: null
  };
}
