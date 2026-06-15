import { requireAiOrchestrationAccess } from "@/lib/auth";
import { runAgent } from "@/lib/brain/agents/runAgent";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireAiOrchestrationAccess(request);
  if (!auth.ok) return auth.response;

  const startedAt = Date.now();
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        ok: false,
        agentName: "knowledge",
        agentVersion: "brain.agent.knowledge.v1",
        outputSchema: "brain.agent.output.v1",
        decision: "blocked",
        message: "Request body must be valid JSON.",
        toolRequests: [],
        confidence: 0,
        safetyFlags: ["invalid_json"],
        validationErrors: [
          {
            code: "INVALID_INPUT",
            message: "Request body must be valid JSON.",
            retryable: true
          }
        ],
        warnings: [],
        contextPacksUsed: [],
        metadata: {
          version: "brain.agent.runtime.v1",
          generatedAt: new Date().toISOString(),
          processingMs: Date.now() - startedAt,
          dryRun: true,
          debug: false,
          modelName: "disabled",
          modelVersion: "brain.model.disabled.v1",
          logStatus: "skipped"
        }
      },
      { status: 400 }
    );
  }

  const response = await runAgent(body, startedAt);
  return Response.json(response, { status: response.ok ? 200 : 400 });
}
