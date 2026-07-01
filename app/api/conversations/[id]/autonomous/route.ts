import { requireOperator } from "@/lib/auth";
import { loadNativeConversationDetailByPublicId } from "@/lib/brain/native-whatsapp/service";
import { loadConversationAutonomousState } from "@/lib/domains/conversations/autonomous-state";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  const detail = await loadNativeConversationDetailByPublicId(id);
  if (!detail) {
    return Response.json({ error: "conversation_not_found" }, { status: 404 });
  }

  const state = await loadConversationAutonomousState(detail.conversation.id);

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
    lastDecision: state.lastDecision,
    pendingActions: state.pendingActions,
    completedActions: state.completedActions,
    actions: state.actions,
    warnings: detail.conversation.human_owner_active ? ["human_owner_active"] : []
  });
}
