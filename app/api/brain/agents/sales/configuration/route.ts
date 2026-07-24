import { requireOperator } from "@/lib/auth";
import { dbWriteDisabledResponse, isDbWriteEnabled } from "@/lib/write-access";
import {
  SALES_AGENT_CONFIGURATION_HUB_ACTOR,
  SALES_AGENT_CONFIGURATION_STATUSES,
  createDraftConfiguration,
  listPesasChileConfigurations,
  validateSalesAgentConfigurationDocument,
  type SalesAgentConfigurationStatus
} from "@/lib/brain/commercial/sales-agent-configuration";
import { parseListLimit, rejectOversizedRequest, validationFailureResponse } from "./_lib/httpHelpers";
import { mapDomainErrorToResponse } from "./_lib/mapDomainError";

function isValidStatus(value: string): value is SalesAgentConfigurationStatus {
  return (SALES_AGENT_CONFIGURATION_STATUSES as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  const status = statusParam ? statusParam.split(",").filter(isValidStatus) : undefined;

  const limitResult = parseListLimit(searchParams.get("limit"));
  if (!limitResult.ok) {
    return Response.json({ error: "invalid_limit" }, { status: 400 });
  }

  try {
    const configurations = await listPesasChileConfigurations({ status, limit: limitResult.limit });
    return Response.json({ configurations });
  } catch (error) {
    return mapDomainErrorToResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;
  if (!isDbWriteEnabled()) return dbWriteDisabledResponse(409);

  const oversized = rejectOversizedRequest(request);
  if (oversized) return oversized;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const name = typeof (body as { name?: unknown }).name === "string" ? ((body as { name: string }).name.trim()) : "";
  if (!name) {
    return Response.json({ error: "missing_name", field: "name" }, { status: 400 });
  }

  const validation = validateSalesAgentConfigurationDocument((body as { configuration?: unknown }).configuration);
  if (!validation.valid) {
    return validationFailureResponse(validation);
  }

  try {
    const record = await createDraftConfiguration({
      name,
      configuration: validation.configuration,
      createdBy: SALES_AGENT_CONFIGURATION_HUB_ACTOR
    });
    return Response.json(record, { status: 201 });
  } catch (error) {
    return mapDomainErrorToResponse(error);
  }
}
