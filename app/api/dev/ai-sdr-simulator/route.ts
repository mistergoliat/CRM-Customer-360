import { requireOperator } from "@/lib/auth";
import { createLocalAiSdrConversation, getLocalAiSdrOverview, runLocalAiSdrTurn } from "@/lib/brain/local-ai-sdr";
import { pickText } from "@/lib/brain/local-ai-sdr/utils";

function asText(value: unknown) {
  return pickText(value);
}

function parseAction(value: unknown) {
  return value === "create-conversation" || value === "turn" ? value : null;
}

function sanitizePayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

export async function GET(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const conversationId = asText(searchParams.get("conversationId"));
  const overview = await getLocalAiSdrOverview(conversationId);
  return Response.json(overview);
}

export async function POST(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const body = sanitizePayload(await request.json().catch(() => null));
  if (!body) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const action = parseAction(body.action);
  if (!action) {
    return Response.json({ error: "invalid_action" }, { status: 400 });
  }

  if (action === "create-conversation") {
    const result = await createLocalAiSdrConversation({
      waId: asText(body.waId),
      externalContactId: asText(body.externalContactId),
      customerId: asText(body.customerId),
      channelAccountId: asText(body.channelAccountId)
    });
    return Response.json(result, { status: 201 });
  }

  const messageText = asText(body.messageText);
  if (!messageText) {
    return Response.json({ error: "message_text_required" }, { status: 400 });
  }

  const result = await runLocalAiSdrTurn({
    conversationId: asText(body.conversationId),
    waId: asText(body.waId),
    externalContactId: asText(body.externalContactId),
    channelAccountId: asText(body.channelAccountId),
    messageText,
    messageId: asText(body.messageId),
    idempotencyKey: asText(body.idempotencyKey),
    currentTime: asText(body.currentTime) ?? undefined
  });
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
