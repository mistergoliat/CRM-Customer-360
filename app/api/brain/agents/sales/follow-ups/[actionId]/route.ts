import { requireOperator } from "@/lib/auth";
import { getFollowUpDetail } from "@/lib/domains/follow-up-observability/detailService";
import { badRequest } from "../_lib/httpHelpers";

const MAX_ACTION_ID_LENGTH = 191; // matches crm_agent_actions.action_id column width

export async function GET(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { actionId: rawActionId } = await params;
  const actionId = decodeURIComponent(rawActionId ?? "").trim();
  if (!actionId || actionId.length > MAX_ACTION_ID_LENGTH) return badRequest("invalid_action_id");

  const { detail, warnings } = await getFollowUpDetail(actionId);
  if (!detail) return Response.json({ error: "not_found" }, { status: 404 });

  return Response.json({ detail, warnings });
}
