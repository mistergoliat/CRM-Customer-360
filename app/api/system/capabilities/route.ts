import { requireOperator } from "@/lib/auth";
import { getSystemCapabilities } from "@/lib/domains/runtime/capability-registry";

export async function GET(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const capabilities = await getSystemCapabilities();
  return Response.json(capabilities);
}
