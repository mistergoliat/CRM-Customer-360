import { requireOperator } from "@/lib/auth";
import { dbWriteDisabledResponse, isDbWriteEnabled } from "@/lib/write-access";
import { loadConfigurationById, updateDraftConfiguration, validateSalesAgentConfigurationDocument } from "@/lib/brain/commercial/sales-agent-configuration";
import { parseConfigurationId, rejectOversizedRequest, validationFailureResponse } from "../_lib/httpHelpers";
import { mapDomainErrorToResponse } from "../_lib/mapDomainError";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const id = parseConfigurationId((await context.params).id);
  if (id === null) return Response.json({ error: "invalid_id" }, { status: 400 });

  try {
    const record = await loadConfigurationById(id);
    if (!record) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(record);
  } catch (error) {
    return mapDomainErrorToResponse(error, id);
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;
  if (!isDbWriteEnabled()) return dbWriteDisabledResponse(409);

  const id = parseConfigurationId((await context.params).id);
  if (id === null) return Response.json({ error: "invalid_id" }, { status: 400 });

  const oversized = rejectOversizedRequest(request);
  if (oversized) return oversized;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const typedBody = body as { configuration?: unknown; name?: unknown; expectedUpdatedAt?: unknown };
  if (typeof typedBody.expectedUpdatedAt !== "string" || !typedBody.expectedUpdatedAt) {
    return Response.json({ error: "missing_expected_updated_at" }, { status: 400 });
  }

  const validation = validateSalesAgentConfigurationDocument(typedBody.configuration);
  if (!validation.valid) {
    return validationFailureResponse(validation);
  }

  try {
    const record = await updateDraftConfiguration({
      id,
      configuration: validation.configuration,
      name: typeof typedBody.name === "string" ? typedBody.name : undefined,
      expectedUpdatedAt: typedBody.expectedUpdatedAt
    });
    return Response.json(record);
  } catch (error) {
    return mapDomainErrorToResponse(error, id);
  }
}
