import { requireOperator } from "@/lib/auth";
import { getFollowUpSummary } from "@/lib/domains/follow-up-observability/summaryService";
import { badRequest, parseRange } from "../_lib/httpHelpers";

export async function GET(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const rangeResult = parseRange(searchParams.get("range"));
  if (!rangeResult.ok) return badRequest("invalid_range");

  const { summary, warnings } = await getFollowUpSummary(rangeResult.value ?? "24h");
  return Response.json({ summary, warnings });
}
