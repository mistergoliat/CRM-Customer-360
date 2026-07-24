import { requireOperator } from "@/lib/auth";
import { dbWriteDisabledResponse, isDbWriteEnabled } from "@/lib/write-access";
import { archiveDraftConfiguration } from "@/lib/brain/commercial/sales-agent-configuration";
import { parseConfigurationId } from "../../_lib/httpHelpers";
import { mapDomainErrorToResponse } from "../../_lib/mapDomainError";

type Context = { params: Promise<{ id: string }> };

/**
 * ACS-R1-05.1-T02.3C, decision 8 (review-corrected): the Hub can only
 * archive a draft. archiveDraftConfiguration()'s single atomic UPDATE
 * (WHERE status = 'draft') enforces this itself - never a route-level
 * read-then-check-then-write, which left a window for a concurrent publish
 * to turn the row published between the check and the call. The previously-
 * published row is only ever archived by publishDraftConfiguration's own
 * transactional flow when a new version is published - never from here.
 */
export async function POST(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;
  if (!isDbWriteEnabled()) return dbWriteDisabledResponse(409);

  const id = parseConfigurationId((await context.params).id);
  if (id === null) return Response.json({ error: "invalid_id" }, { status: 400 });

  try {
    const record = await archiveDraftConfiguration(id);
    return Response.json(record);
  } catch (error) {
    return mapDomainErrorToResponse(error, id);
  }
}
