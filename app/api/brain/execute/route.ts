import { requireAiOrchestrationAccess } from "@/lib/auth";
import { resolveBrainExecution } from "@/lib/brain/messaging/responseExecutor";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAiOrchestrationAccess(request);
  if (!auth.ok) return auth.response;

  const startedAt = Date.now();
  let body: unknown = null;

  try {
    body = await request.json();
  } catch {
    body = null;
  }

  return Response.json(await resolveBrainExecution(body, startedAt));
}
