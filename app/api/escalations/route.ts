import { requireOperator } from "@/lib/auth";
import { listOpenEscalations } from "@/lib/brain/commercial/request-escalations";

export const dynamic = "force-dynamic";

/** Minimal HUB visibility: the open escalation queue, oldest first. */
export async function GET(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const targetType = url.searchParams.get("targetType") ?? undefined;
  const targetId = url.searchParams.get("targetId") ?? undefined;

  const escalations = await listOpenEscalations({ targetType, targetId });
  return Response.json({ escalations, total: escalations.length });
}
