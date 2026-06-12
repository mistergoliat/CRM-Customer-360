import { requireOperator } from "@/lib/auth";
import { getChatContext } from "@/lib/chats";

type Context = {
  params: Promise<{ caseId: string }>;
};

export async function GET(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { caseId } = await context.params;
  const result = await getChatContext(caseId);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 500 });
  }
  if (!result.row) {
    return Response.json({ error: "Caso no encontrado" }, { status: 404 });
  }

  return Response.json(result.row);
}
