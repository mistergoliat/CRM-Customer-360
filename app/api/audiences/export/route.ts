import { errorResponse } from "@/lib/api-response";
import { requireOperator } from "@/lib/auth";
import { exportAudience, isAudienceClientError } from "@/lib/customer-intelligence/audienceClient";
import {
  AUDIENCE_EXPORT_FIELDS,
  AUDIENCE_EXPORT_FORMATS,
  DEFAULT_AUDIENCE_EXPORT_FIELDS,
  audienceExportRequiresPii,
  isPlausibleAudienceDefinition,
  type AudienceExportField,
  type AudienceExportFormat
} from "@/lib/marketing/customerIntelligenceAudience";

const EXPORT_FIELD_SET = new Set<string>(AUDIENCE_EXPORT_FIELDS);
const EXPORT_FORMAT_SET = new Set<string>(AUDIENCE_EXPORT_FORMATS);

export async function POST(request: Request) {
  // Authorization note (A03.1 Phase 17): this repo has a single operator-session tier today, no
  // granular per-user export/PII scopes. The narrowest safe gate available is: same operator
  // session as every other CRM action, plus a strict server-side field allowlist that never
  // trusts client-supplied field names. Tightening this to a real per-user PII export permission
  // is deferred - document as a known limitation, not solved here.
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", "Request body must be JSON.", 400);
  }
  if (!isRecord(body)) return errorResponse("invalid_request", "Request body must be an object.", 400);

  const allowed = new Set(["definition", "format", "fields"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return errorResponse("unsupported_field", "Unsupported request field.", 400);
  }

  if (!isPlausibleAudienceDefinition(body.definition)) {
    return errorResponse("invalid_definition", "definition must be a valid AudienceDefinitionV1.", 400);
  }

  if (typeof body.format !== "string" || !EXPORT_FORMAT_SET.has(body.format)) {
    return errorResponse("invalid_format", "format must be CSV or XLSX.", 400);
  }
  const format = body.format as AudienceExportFormat;

  const fieldsResult = normalizeFields(body.fields);
  if (!fieldsResult.ok) return errorResponse("invalid_fields", fieldsResult.message, 400);

  try {
    const upstream = await exportAudience({
      definition: body.definition,
      format,
      fields: fieldsResult.value,
      requiresPii: audienceExportRequiresPii(fieldsResult.value)
    });

    const headers = new Headers({ "content-type": upstream.contentType });
    if (upstream.contentDisposition) headers.set("content-disposition", upstream.contentDisposition);
    if (upstream.contentLength) headers.set("content-length", upstream.contentLength);
    if (upstream.matchedCount) headers.set("x-audience-export-matched-count", upstream.matchedCount);
    if (upstream.unknownCount) headers.set("x-audience-export-unknown-count", upstream.unknownCount);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (isAudienceClientError(error)) return errorResponse(error.code, error.message, error.status);
    return errorResponse("audience_export_failed", "Audience export failed.", 503);
  }
}

function normalizeFields(value: unknown): { ok: true; value: readonly AudienceExportField[] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: DEFAULT_AUDIENCE_EXPORT_FIELDS };
  if (!Array.isArray(value) || value.length === 0) return { ok: false, message: "fields must be a non-empty array." };
  const fields: AudienceExportField[] = [];
  for (const field of value) {
    if (typeof field !== "string" || !EXPORT_FIELD_SET.has(field)) {
      return { ok: false, message: `Unsupported export field: ${String(field)}.` };
    }
    if (!fields.includes(field as AudienceExportField)) fields.push(field as AudienceExportField);
  }
  return { ok: true, value: fields };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
