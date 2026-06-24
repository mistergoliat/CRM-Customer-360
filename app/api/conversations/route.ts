import { requireOperator } from "@/lib/auth";
import { listConversations } from "@/lib/domains/conversations";

export async function GET(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get("page") || 1);
  const q = searchParams.get("q") || "";
  const result = await listConversations({ page, q });
  return Response.json(result);
}
