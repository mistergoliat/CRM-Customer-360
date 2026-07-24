import { requireOperator } from "@/lib/auth";
import { dbWriteDisabledResponse, isDbWriteEnabled } from "@/lib/write-access";
import { publishDraftConfiguration } from "@/lib/brain/commercial/sales-agent-configuration";
import { parseConfigurationId } from "../../_lib/httpHelpers";
import { mapDomainErrorToResponse } from "../../_lib/mapDomainError";

type Context = { params: Promise<{ id: string }> };

/** Publish itself is publish.ts's existing T02.3A transactional flow (lock + archive-previous + publish + audit) - untouched here. */
export async function POST(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;
  if (!isDbWriteEnabled()) return dbWriteDisabledResponse(409);

  const id = parseConfigurationId((await context.params).id);
  if (id === null) return Response.json({ error: "invalid_id" }, { status: 400 });

  try {
    const record = await publishDraftConfiguration({ id });
    return Response.json(record);
  } catch (error) {
    return mapDomainErrorToResponse(error, id);
  }
}
