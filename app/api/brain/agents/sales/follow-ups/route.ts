import { requireOperator } from "@/lib/auth";
import { listFollowUps } from "@/lib/domains/follow-up-observability/listService";
import { badRequest, parseCriticality, parseFreeText, parseLimit, parsePage, parsePositiveInt, parseRange, parseStatusList } from "./_lib/httpHelpers";

export async function GET(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);

  const range = parseRange(searchParams.get("range"));
  if (!range.ok) return badRequest("invalid_range");

  const status = parseStatusList(searchParams.get("status"));
  if (!status.ok) return badRequest("invalid_status");

  const reason = parseFreeText(searchParams.get("reason"));
  if (!reason.ok) return badRequest("invalid_reason");

  const opportunityId = parsePositiveInt(searchParams.get("opportunityId"));
  if (!opportunityId.ok) return badRequest("invalid_opportunity_id");

  const conversationCaseId = parsePositiveInt(searchParams.get("conversationCaseId"));
  if (!conversationCaseId.ok) return badRequest("invalid_conversation_case_id");

  const actionId = parseFreeText(searchParams.get("actionId"));
  if (!actionId.ok) return badRequest("invalid_action_id");

  const criticality = parseCriticality(searchParams.get("criticality"));
  if (!criticality.ok) return badRequest("invalid_criticality");

  const page = parsePage(searchParams.get("page"));
  if (!page.ok) return badRequest("invalid_page");

  const limit = parseLimit(searchParams.get("limit"));
  if (!limit.ok) return badRequest("invalid_limit");

  const result = await listFollowUps({
    range: range.value,
    status: status.value,
    reason: reason.value,
    opportunityId: opportunityId.value,
    conversationCaseId: conversationCaseId.value,
    actionId: actionId.value,
    criticality: criticality.value,
    page: page.value,
    limit: limit.value
  });

  return Response.json({ items: result.items, pagination: result.pagination, warnings: result.warnings });
}
