import { errorResponse } from "@/lib/api-response";
import { exportCopilotSessionResult, isMarketingCopilotClientError } from "@/lib/customer-intelligence/copilotClient";

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
  const allowed = new Set(["queryId", "format"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return errorResponse("unsupported_field", "Unsupported request field.", 400);
  }
  const queryId = typeof body.queryId === "string" ? body.queryId.trim() : "";
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(queryId) || body.format !== "xlsx") {
    return errorResponse("invalid_export_request", "queryId and format=xlsx are required.", 400);
  }

  try {
    const upstream = await exportCopilotSessionResult(sessionId, { queryId, format: "xlsx" });
    const headers = new Headers({ "content-type": upstream.contentType });
    if (upstream.contentDisposition) headers.set("content-disposition", upstream.contentDisposition);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (isMarketingCopilotClientError(error)) return errorResponse(error.code, error.message, error.status);
    return errorResponse("marketing_copilot_export_failed", "Marketing Copilot export failed.", 503);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
