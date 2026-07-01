import { requireOperator } from "@/lib/auth";
import { isDbWriteEnabled, dbWriteDisabledResponse } from "@/lib/write-access";
import { applyConversationControl, type ConversationControlAction } from "@/lib/domains/conversations/control";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

const VALID_ACTIONS: ConversationControlAction[] = ["take", "release", "pause", "close", "reopen"];

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
  const action = typeof record.action === "string" ? (record.action as ConversationControlAction) : null;
  const operatorName = typeof record.operatorName === "string" ? record.operatorName : null;

  if (!action || !VALID_ACTIONS.includes(action)) {
    return Response.json({ error: "invalid_action", validActions: VALID_ACTIONS }, { status: 400 });
  }

  const result = await applyConversationControl({ conversationPublicId: id, action, operatorName });

  if (!result.ok) {
    const statusCode = result.code === "conversation_not_found" ? 404 : result.code === "load_failed" ? 500 : 409;
    return Response.json({ error: result.code, message: result.message }, { status: statusCode });
  }

  return Response.json(result);
}
