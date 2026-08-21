import { errorResponse } from "@/lib/api-response";
import { isMarketingCopilotClientError, isValidQuestion, sendCopilotMessage } from "@/lib/customer-intelligence/copilotClient";

type Context = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: Context) {
  const { sessionId } = await context.params;
  if (!isUuid(sessionId)) return errorResponse("invalid_session_id", "sessionId must be a UUID.", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be JSON.", 400);
  }
  if (!isRecord(body)) return errorResponse("invalid_request", "Request body must be an object.", 400);
  const allowed = new Set(["question"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return errorResponse("unsupported_field", "Unsupported request field.", 400);
  }
  if (!isValidQuestion(body.question)) return errorResponse("invalid_question", "Question is required and must be at most 4000 characters.", 400);

  try {
    const upstream = await sendCopilotMessage(sessionId, body.question.trim());
    return Response.json(upstream.body, { status: upstream.status });
  } catch (error) {
    return proxyError(error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function proxyError(error: unknown) {
  if (isMarketingCopilotClientError(error)) return errorResponse(error.code, error.message, error.status);
  return errorResponse("marketing_copilot_unavailable", "Marketing Copilot backend is unavailable.", 503);
}
