import { requireOperator } from "@/lib/auth";
import { dbWriteDisabledResponse, isDbWriteEnabled } from "@/lib/write-access";
import { archiveConfiguration, loadConfigurationById } from "@/lib/brain/commercial/sales-agent-configuration";
import { parseConfigurationId } from "../../_lib/httpHelpers";
import { mapDomainErrorToResponse } from "../../_lib/mapDomainError";

type Context = { params: Promise<{ id: string }> };

/**
 * ACS-R1-05.1-T02.3C, decision 8: the Hub can only archive a draft -
 * archiveConfiguration() itself (T02.3A) allows archiving a published row
 * too (used elsewhere/reserved), so this endpoint pre-checks status and
 * rejects anything that is not currently a draft before calling it. The
 * previously-published row is only ever archived by publishDraftConfiguration's
 * own transactional flow when a new version is published - never from here.
 */
export async function POST(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;
  if (!isDbWriteEnabled()) return dbWriteDisabledResponse(409);

  const id = parseConfigurationId((await context.params).id);
  if (id === null) return Response.json({ error: "invalid_id" }, { status: 400 });

  try {
    const existing = await loadConfigurationById(id);
    if (!existing) return Response.json({ error: "not_found" }, { status: 404 });
    if (existing.status !== "draft") {
      return Response.json({ error: "not_draft" }, { status: 409 });
    }

    const record = await archiveConfiguration(id);
    return Response.json(record);
  } catch (error) {
    return mapDomainErrorToResponse(error, id);
  }
}
