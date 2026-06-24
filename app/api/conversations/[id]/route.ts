import { requireOperator } from "@/lib/auth";
import { getConversationById } from "@/lib/domains/conversations";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const result = await getConversationById(id);
  if (!result) {
    return Response.json({ error: "conversation_not_found" }, { status: 404 });
  }

  return Response.json(result);
}
