import { requireAiOrchestrationAccess } from "@/lib/auth";
import { normalizeBrainContextResolveRequest } from "@/lib/brain/context/legacyAdapters";
import { resolveBackendBrainContext } from "@/lib/brain/context/resolveContext";

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
        partial_context: false,
        errors: [
          {
            code: "INVALID_INPUT",
            message: "Request body must be valid JSON.",
            retryable: true
          }
        ],
        warnings: []
      },
      { status: 400 }
    );
  }

  const normalized = normalizeBrainContextResolveRequest(body);
  if (!normalized.ok) {
    return Response.json(
      {
        ok: false,
        partial_context: false,
        errors: normalized.errors,
        warnings: []
      },
      { status: 400 }
    );
  }

  const response = await resolveBackendBrainContext(normalized.value, startedAt);
  return Response.json(response, { status: response.ok ? 200 : 503 });
}
