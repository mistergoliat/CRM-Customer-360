import { errorResponse } from "@/lib/api-response";
import { requireOperator } from "@/lib/auth";
import { evaluateAudience, isAudienceClientError } from "@/lib/customer-intelligence/audienceClient";
import { DEFAULT_AUDIENCE_PREVIEW_LIMIT, MAX_AUDIENCE_PREVIEW_LIMIT, isPlausibleAudienceDefinition } from "@/lib/marketing/customerIntelligenceAudience";

export async function POST(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be JSON.", 400);
  }
  if (!isRecord(body)) return errorResponse("invalid_request", "Request body must be an object.", 400);

  const allowed = new Set(["definition", "previewLimit"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return errorResponse("unsupported_field", "Unsupported request field.", 400);
  }

  if (!isPlausibleAudienceDefinition(body.definition)) {
    return errorResponse("invalid_definition", "definition must be a valid AudienceDefinitionV1.", 400);
  }

  const previewLimit = normalizePreviewLimit(body.previewLimit);
  if (!previewLimit.ok) return errorResponse("invalid_preview_limit", previewLimit.message, 400);

  try {
    const upstream = await evaluateAudience({ definition: body.definition, previewLimit: previewLimit.value });
    return Response.json(upstream.body, { status: upstream.status });
  } catch (error) {
    if (isAudienceClientError(error)) return errorResponse(error.code, error.message, error.status);
    return errorResponse("audience_evaluate_failed", "Audience evaluation failed.", 503);
  }
}

function normalizePreviewLimit(value: unknown): { ok: true; value: number } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: DEFAULT_AUDIENCE_PREVIEW_LIMIT };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_AUDIENCE_PREVIEW_LIMIT) {
    return { ok: false, message: `previewLimit must be an integer between 1 and ${MAX_AUDIENCE_PREVIEW_LIMIT}.` };
  }
  return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
