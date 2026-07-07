import { requireOperator } from "@/lib/auth";
import { loadNativeConversationDetailByPublicId } from "@/lib/brain/native-whatsapp/service";
import { loadConversationThread } from "@/lib/domains/conversations/thread";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

/** Paginated older-message loading for the workspace timeline ("cargar anteriores"). */
export async function GET(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const url = new URL(request.url);
  const before = url.searchParams.get("before");
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

  const detail = await loadNativeConversationDetailByPublicId(id);
  if (!detail) {
    return Response.json({ error: "conversation_not_found" }, { status: 404 });
  }

  const thread = await loadConversationThread(detail.conversation.id, { before, limit });
  return Response.json({ messages: thread.messages, error: thread.error, truncated: thread.truncated });
}
