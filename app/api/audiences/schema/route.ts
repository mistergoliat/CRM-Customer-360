import { errorResponse } from "@/lib/api-response";
import { requireOperator } from "@/lib/auth";
import { getAudienceSchema, isAudienceClientError } from "@/lib/customer-intelligence/audienceClient";

export async function GET(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  try {
    const upstream = await getAudienceSchema();
    return Response.json(upstream.body, { status: upstream.status });
  } catch (error) {
    if (isAudienceClientError(error)) return errorResponse(error.code, error.message, error.status);
    return errorResponse("audience_schema_failed", "Audience schema request failed.", 503);
  }
}
