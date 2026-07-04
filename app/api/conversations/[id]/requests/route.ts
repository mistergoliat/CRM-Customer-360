import { requireOperator } from "@/lib/auth";
import { loadConversationRequestsView } from "@/lib/brain/commercial/multi-request";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

/** Read-only: the per-request work state of one conversation for the HUB. */
export async function GET(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const view = await loadConversationRequestsView({ conversationPublicId: id });
  if (!view) return Response.json({ error: "conversation_not_found" }, { status: 404 });

  return Response.json(view);
}
