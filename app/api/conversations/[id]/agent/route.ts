import { requireOperator } from "@/lib/auth";
import { loadNativeConversationDetailByPublicId } from "@/lib/brain/native-whatsapp";
import { buildAgentOperationalView } from "@/lib/brain/commercial/agent-runtime/operationalSummary";

type Context = {
  params: Promise<{ id: string }>;
};

/**
 * Read-only operational view of the commercial agent for one conversation:
 * durable state (goal, known facts, pending/completed actions) plus a short,
 * factual per-turn summary derived from tool calls -- never raw model
 * chain-of-thought.
 */
export async function GET(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const detail = await loadNativeConversationDetailByPublicId(id);
  if (!detail) {
    return Response.json({ error: "conversation_not_found" }, { status: 404 });
  }

  const view = await buildAgentOperationalView(Number(detail.conversation.id));
  return Response.json({
    conversationId: id,
    goal: view.state?.customerGoal ?? null,
    conversationState: view.state?.conversationState ?? null,
    toolset: view.state?.toolset ?? null,
    humanOwnerActive: view.state?.humanOwnerActive ?? false,
    handoffMode: view.state?.handoffMode ?? null,
    knownFacts: view.state?.knownFacts ?? [],
    missingInformation: view.state?.missingInformation ?? [],
    pendingActions: view.state?.pendingActions ?? [],
    completedActions: view.state?.completedActions ?? [],
    unresolvedQuestions: view.state?.unresolvedQuestions ?? [],
    turnCount: view.state?.turnCount ?? 0,
    turns: view.turns
  });
}
