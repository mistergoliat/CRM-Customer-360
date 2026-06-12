import { requireOperator } from "@/lib/auth";
import { getChatMessages } from "@/lib/chats";

type Context = {
  params: Promise<{ caseId: string }>;
};

export async function GET(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { caseId } = await context.params;
  const result = await getChatMessages(caseId);
  if (!result.ok) {
    const status = result.source === "missing" ? 404 : 500;
    return Response.json({ error: result.error }, { status });
  }

  return Response.json({
    source: result.source,
    rows: result.rows
  });
}
