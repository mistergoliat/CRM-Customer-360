import { requireOperator } from "@/lib/auth";
import { validateSalesAgentConfigurationDocument } from "@/lib/brain/commercial/sales-agent-configuration";
import { rejectOversizedRequest } from "../_lib/httpHelpers";

/**
 * ACS-R1-05.1-T02.3C, decision 10: validates the CURRENT form content sent
 * in the body - never reloads or re-checks a stored row by id. No DB
 * access at all, so no write gate and no audit row (decision 5 - a pure
 * check never mutates state).
 */
export async function POST(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const oversized = rejectOversizedRequest(request);
  if (oversized) return oversized;

  const body = await request.json().catch(() => null);
  const validation = validateSalesAgentConfigurationDocument((body as { configuration?: unknown } | null)?.configuration);

  if (!validation.valid) {
    return Response.json(
      { valid: false, code: validation.code, field: validation.field, reason: validation.reason },
      { status: validation.code === "payload_too_large" ? 413 : 400 }
    );
  }

  return Response.json({ valid: true, configuration: validation.configuration });
}
