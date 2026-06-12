import { requireOperator } from "@/lib/auth";
import { getSystemHealth } from "@/lib/system";

export async function GET(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;
  const health = await getSystemHealth();
  return Response.json(health);
}
