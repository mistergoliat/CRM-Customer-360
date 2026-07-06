import { requireOperator } from "@/lib/auth";
import { isDbWriteEnabled, dbWriteDisabledResponse } from "@/lib/write-access";
import { sendConversationManualReply } from "@/lib/domains/conversations/manual-reply";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;
  if (!isDbWriteEnabled()) return dbWriteDisabledResponse(403);

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const text = typeof record.text === "string" ? record.text : "";
  const operatorName = typeof record.operatorName === "string" ? record.operatorName : null;

  const result = await sendConversationManualReply({ conversationPublicId: id, text, operatorName });

  if (!result.ok) {
    const statusCode =
      result.code === "conversation_not_found"
        ? 404
        : result.code === "conversation_closed" || result.code === "window_closed"
          ? 409
          : 400;
    return Response.json({ error: result.code, message: result.message }, { status: statusCode });
  }

  // 502 when the message was persisted but Meta rejected the send (e.g. session window closed).
  return Response.json(result, { status: result.status === "sent" ? 200 : 502 });
}
