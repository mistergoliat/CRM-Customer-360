import { errorResponse } from "@/lib/api-response";
import { createCopilotSession, isMarketingCopilotClientError } from "@/lib/customer-intelligence/copilotClient";

export async function POST(request: Request) {
  const parsed = await readOptionalObject(request);
  if (!parsed.ok) return parsed.response;

  const allowed = new Set(["featureSnapshotId"]);
  for (const key of Object.keys(parsed.body)) {
    if (!allowed.has(key)) return errorResponse("unsupported_field", "Unsupported request field.", 400);
  }
  const featureSnapshotId = parsed.body.featureSnapshotId === undefined || parsed.body.featureSnapshotId === null ? undefined : String(parsed.body.featureSnapshotId).trim();
  if (featureSnapshotId && !/^[0-9]+$/.test(featureSnapshotId)) {
    return errorResponse("invalid_feature_snapshot_id", "featureSnapshotId must be numeric.", 400);
  }

  try {
    const upstream = await createCopilotSession({ featureSnapshotId });
    return Response.json(upstream.body, { status: upstream.status });
  } catch (error) {
    return proxyError(error);
  }
}

async function readOptionalObject(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const text = await request.text();
  if (text.trim().length === 0) return { ok: true, body: {} };
  try {
    const body = JSON.parse(text) as unknown;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return { ok: false, response: errorResponse("invalid_request", "Request body must be an object.", 400) };
    }
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, response: errorResponse("invalid_json", "Request body must be JSON.", 400) };
  }
}

function proxyError(error: unknown) {
  if (isMarketingCopilotClientError(error)) return errorResponse(error.code, error.message, error.status);
  return errorResponse("marketing_copilot_unavailable", "Marketing Copilot backend is unavailable.", 503);
}
