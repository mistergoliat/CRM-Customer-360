import { requireOperator } from "@/lib/auth";
import { safeQueryRows } from "@/lib/db";
import { loadNativeConversationDetailByPublicId } from "@/lib/brain/native-whatsapp/service";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

const NARRATION: Record<string, (actionType: string, draftMessage: string | null) => string> = {
  send_whatsapp_reply: (_, m) => m ? `Envió: "${m.slice(0, 60)}${m.length > 60 ? "…" : ""}"` : "Envió respuesta.",
  request_more_context: (_, m) => m ? `Preguntó: "${m.slice(0, 60)}${m.length > 60 ? "…" : ""}"` : "Solicitó más información.",
  schedule_followup: () => "Programó un seguimiento.",
  take_over_case: () => "Transfirió el caso a un operador.",
  pause_ai: () => "Pausó la automatización.",
  create_internal_task: () => "Creó tarea interna.",
  mark_lost_candidate: () => "Marcó como candidato perdido.",
  prepare_quote_draft: () => "Preparó borrador de cotización.",
  no_action: () => "Sin acción autónoma en este turno."
};

function narrate(actionType: string, draftMessage: string | null): string {
  return (NARRATION[actionType] ?? ((type: string) => `Ejecutó acción: ${type}`))(actionType, draftMessage);
}

export async function GET(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  const detail = await loadNativeConversationDetailByPublicId(id);
  if (!detail) {
    return Response.json({ error: "conversation_not_found" }, { status: 404 });
  }

  const conversationId = detail.conversation.id;

  // Load all agent actions for this conversation (via opportunity FK)
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

  const actions = actionsResult.ok ? actionsResult.rows : [];

  // Load executions for these action IDs
  const actionIds = actions.map((a) => a.action_id);
  let executions: Array<{ execution_id: string; action_id: string; status: string; attempt_number: number; completed_at: string | null; error_code: string | null }> = [];
  if (actionIds.length > 0) {
    const execResult = await safeQueryRows<{ execution_id: string; action_id: string; status: string; attempt_number: number; completed_at: string | null; error_code: string | null }>(
      `SELECT execution_id, action_id, status, attempt_number, completed_at, error_code
        FROM crm_action_executions
        WHERE action_id IN (${actionIds.map(() => "?").join(",")})
        ORDER BY created_at DESC`,
      actionIds
    );
    executions = execResult.ok ? execResult.rows : [];
  }

  // Load outcomes
  let outcomes: Array<{ action_id: string; outcome_type: string; occurred_at: string; provider_message_id: string | null }> = [];
  if (actionIds.length > 0) {
    const outcomeResult = await safeQueryRows<{ action_id: string; outcome_type: string; occurred_at: string; provider_message_id: string | null }>(
      `SELECT action_id, outcome_type, occurred_at, provider_message_id
        FROM crm_action_outcomes
        WHERE action_id IN (${actionIds.map(() => "?").join(",")})
        ORDER BY occurred_at DESC`,
      actionIds
    );
    outcomes = outcomeResult.ok ? outcomeResult.rows : [];
  }

  // Load latest decision
  const decisionResult = await safeQueryRows<{ next_status: string | null; next_stage: string | null; rationale: string | null; created_at: string }>(
    `SELECT d.next_status, d.next_stage, d.rationale, d.created_at
      FROM crm_agent_decisions d
      INNER JOIN crm_opportunities o ON o.id = d.opportunity_id
      WHERE o.conversation_case_id = ?
      ORDER BY d.created_at DESC LIMIT 1`,
    [conversationId]
  );
  const lastDecision = decisionResult.ok ? decisionResult.rows[0] ?? null : null;

  // Build operator-facing summary (no chain-of-thought, factual actions only)
  const summary = actions.map((a) => ({
    actionId: a.action_id,
    actionType: a.action_type,
    status: a.status,
    narration: narrate(a.action_type, a.draft_message ?? a.final_message),
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

  const pending = actions.filter((a) => a.status === "proposed" || a.status === "planned");
  const completed = actions.filter((a) => a.status === "executed" || a.status === "failed" || a.status === "cancelled");

  return Response.json({
    conversationId: detail.conversation.public_id,
    opportunity: detail.opportunity
      ? {
          status: detail.opportunity.status,
          stage: detail.opportunity.stage,
          currentSummary: detail.opportunity.currentSummary,
          nextActionType: detail.opportunity.nextActionType,
          nextActionDueAt: detail.opportunity.nextActionDueAt,
          humanOwnerActive: detail.opportunity.humanOwnerActive,
          aiBlocked: detail.opportunity.aiBlocked
        }
      : null,
    lastDecision: lastDecision
      ? {
          nextStatus: lastDecision.next_status,
          nextStage: lastDecision.next_stage,
          rationale: lastDecision.rationale,
          createdAt: lastDecision.created_at
        }
      : null,
    pendingActions: pending.length,
    completedActions: completed.length,
    actions: summary,
    warnings: detail.conversation.human_owner_active ? ["human_owner_active"] : []
  });
}
