import { errorResponse } from "@/lib/api-response";
import { isMarketingCopilotClientError } from "@/lib/customer-intelligence/copilotClient";

export function parseFeatureSnapshotId(request: Request): { ok: true; featureSnapshotId?: string } | { ok: false; response: Response } {
  const url = new URL(request.url);
  const allowed = new Set(["featureSnapshotId"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) return { ok: false, response: errorResponse("unsupported_query_param", "Unsupported query param.", 400) };
  }
  const raw = url.searchParams.get("featureSnapshotId")?.trim();
  if (!raw) return { ok: true };
  if (!/^[0-9]+$/.test(raw)) return { ok: false, response: errorResponse("invalid_feature_snapshot_id", "featureSnapshotId must be numeric.", 400) };
  return { ok: true, featureSnapshotId: raw };
}

export async function readDashboardIntersectionBody(request: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].length > 0) return { ok: false, response: errorResponse("unsupported_query_param", "Unsupported query param.", 400) };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: errorResponse("invalid_json", "Request body must be JSON.", 400) };
  }
  if (!isRecord(body)) return { ok: false, response: errorResponse("invalid_request", "Request body must be an object.", 400) };

  const allowed = new Set(["contractVersion", "featureSnapshotId", "filters"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return { ok: false, response: errorResponse("unsupported_field", "Unsupported request field.", 400) };
  }

  if (body.featureSnapshotId !== undefined && body.featureSnapshotId !== null) {
    const featureSnapshotId = String(body.featureSnapshotId).trim();
    if (!/^[0-9]+$/.test(featureSnapshotId)) return { ok: false, response: errorResponse("invalid_feature_snapshot_id", "featureSnapshotId must be numeric.", 400) };
    return { ok: true, body: { ...body, featureSnapshotId } };
  }
  return { ok: true, body };
}

export function proxyError(error: unknown) {
  if (isMarketingCopilotClientError(error)) return errorResponse(error.code, error.message, error.status);
  return errorResponse("marketing_customer_intelligence_unavailable", "Customer Intelligence backend is unavailable.", 503);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
