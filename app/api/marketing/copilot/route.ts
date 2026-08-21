import { errorResponse } from "@/lib/api-response";
import { askCopilotQuestion, isMarketingCopilotClientError, isValidQuestion } from "@/lib/customer-intelligence/copilotClient";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be JSON.", 400);
  }

  if (!isRecord(body)) {
    return errorResponse("invalid_request", "Request body must be an object.", 400);
  }
  const allowed = new Set(["question", "featureSnapshotId"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return errorResponse("unsupported_field", "Unsupported request field.", 400);
  }

  if (!isValidQuestion(body.question)) {
    return errorResponse("invalid_question", "Question is required and must be at most 4000 characters.", 400);
  }
  const featureSnapshotId = body.featureSnapshotId === undefined || body.featureSnapshotId === null ? undefined : String(body.featureSnapshotId);

  try {
    const upstream = await askCopilotQuestion({ question: body.question.trim(), featureSnapshotId });
    return Response.json(upstream.body, { status: upstream.status });
  } catch (error) {
    if (isMarketingCopilotClientError(error)) {
      return errorResponse(error.code, error.message, error.status);
    }
    return errorResponse("marketing_copilot_unavailable", "Marketing Copilot backend is unavailable.", 503);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
