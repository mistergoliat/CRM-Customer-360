import { errorResponse } from "@/lib/api-response";
import { isMarketingCopilotClientError, resetCopilotSession } from "@/lib/customer-intelligence/copilotClient";

type Context = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(_request: Request, context: Context) {
  const { sessionId } = await context.params;
  if (!isUuid(sessionId)) return errorResponse("invalid_session_id", "sessionId must be a UUID.", 400);

  try {
    const upstream = await resetCopilotSession(sessionId);
    return Response.json(upstream.body, { status: upstream.status });
  } catch (error) {
    if (isMarketingCopilotClientError(error)) return errorResponse(error.code, error.message, error.status);
    return errorResponse("marketing_copilot_unavailable", "Marketing Copilot backend is unavailable.", 503);
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
