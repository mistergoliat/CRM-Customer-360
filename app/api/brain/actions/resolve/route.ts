import { requireAiOrchestrationAccess } from "@/lib/auth";
import { resolveBrainAction } from "@/lib/brain/actions/actionRouter";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAiOrchestrationAccess(request);
  if (!auth.ok) return auth.response;

  const startedAt = Date.now();
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(await resolveBrainAction(null, startedAt), { status: 400 });
  }

  const response = await resolveBrainAction(body, startedAt);
  return Response.json(response, { status: response.ok ? 200 : 400 });
}
