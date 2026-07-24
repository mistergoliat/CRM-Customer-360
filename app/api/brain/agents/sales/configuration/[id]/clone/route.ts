import { requireOperator } from "@/lib/auth";
import { dbWriteDisabledResponse, isDbWriteEnabled } from "@/lib/write-access";
import { SALES_AGENT_CONFIGURATION_HUB_ACTOR, createDraftConfiguration, loadConfigurationById } from "@/lib/brain/commercial/sales-agent-configuration";
import { parseConfigurationId, rejectOversizedRequest } from "../../_lib/httpHelpers";
import { mapDomainErrorToResponse } from "../../_lib/mapDomainError";

type Context = { params: Promise<{ id: string }> };

/**
 * Rollback in this MVP is "clone the old version, review, publish" (never a
 * destructive overwrite) - this endpoint is that clone step. Reuses
 * createDraftConfiguration with parentConfigurationId set, so lineage is
 * queryable via the record itself and audited under the existing
 * `sales_agent_configuration.created` action (decision 4 - no separate
 * "cloned" action).
 */
export async function POST(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;
  if (!isDbWriteEnabled()) return dbWriteDisabledResponse(409);

  const id = parseConfigurationId((await context.params).id);
  if (id === null) return Response.json({ error: "invalid_id" }, { status: 400 });

  const oversized = rejectOversizedRequest(request);
  if (oversized) return oversized;
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const nameOverride = typeof (body as { name?: unknown }).name === "string" ? (body as { name: string }).name.trim() : "";

  try {
    const source = await loadConfigurationById(id);
    if (!source) return Response.json({ error: "not_found" }, { status: 404 });

    const record = await createDraftConfiguration({
      name: nameOverride || `${source.name} (copia)`,
      configuration: source.configuration,
      createdBy: SALES_AGENT_CONFIGURATION_HUB_ACTOR,
      parentConfigurationId: source.id
    });
    return Response.json(record, { status: 201 });
  } catch (error) {
    return mapDomainErrorToResponse(error, id);
  }
}
