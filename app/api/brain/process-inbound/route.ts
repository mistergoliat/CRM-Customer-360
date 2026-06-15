import { requireAiOrchestrationAccess } from "@/lib/auth";
import { processInbound } from "@/lib/brain/processInbound";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAiOrchestrationAccess(request);
  if (!auth.ok) return auth.response;

  const startedAt = Date.now();
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(await processInbound(null, startedAt));
  }

  return Response.json(await processInbound(body, startedAt));
}
