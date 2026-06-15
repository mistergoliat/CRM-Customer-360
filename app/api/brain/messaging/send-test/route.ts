import { requireAiOrchestrationAccess } from "@/lib/auth";
import { sendMetaWhatsAppTextMessage, validateMetaSendGuards } from "@/lib/brain/messaging/metaSendAdapter";
import type { MetaSendRequest } from "@/lib/brain/messaging/types";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeRequest(input: unknown): MetaSendRequest | null {
  if (!isRecord(input)) return null;

  const waId = asTrimmedString(input.waId);
  const phoneNumberId = asTrimmedString(input.phoneNumberId);
  const messageText = asTrimmedString(input.messageText);
  if (!waId || !phoneNumberId || !messageText) return null;

  return {
    waId,
    phoneNumberId,
    messageText,
    timeoutMs: typeof input.timeoutMs === "number" ? input.timeoutMs : undefined,
    source: asTrimmedString(input.source) as MetaSendRequest["source"] | undefined,
    sourceRequestId: asTrimmedString(input.sourceRequestId),
    conversationCaseId:
      typeof input.conversationCaseId === "string" || typeof input.conversationCaseId === "number"
        ? input.conversationCaseId
        : undefined,
    actionPolicy: isRecord(input.actionPolicy) ? input.actionPolicy : undefined,
    botEligibility: isRecord(input.botEligibility) ? input.botEligibility : undefined,
    metadata: isRecord(input.metadata) ? input.metadata : undefined
  };
}

function buildDisabledResponse(errorMessage: string) {
  return {
    ok: false,
    status: "disabled",
    error_code: "disabled",
    error_message: errorMessage,
    blocked_reasons: ["meta_send_test_disabled"],
    warnings: ["El endpoint de prueba Meta esta deshabilitado por defecto."],
    meta_payload_preview: null,
    response_body: null,
    adapter_status: "disabled"
  };
}

export async function POST(request: Request) {
  const auth = await requireAiOrchestrationAccess(request);
  if (!auth.ok) return auth.response;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  if (process.env.BRAIN_META_SEND_TEST_ENABLED?.trim() !== "true") {
    return Response.json(buildDisabledResponse("BRAIN_META_SEND_TEST_ENABLED=false"), { status: 200 });
  }

  const normalized = normalizeRequest(body);
  if (!normalized) {
    return Response.json(
      {
        ok: false,
        status: "invalid_payload",
        error_code: "invalid_payload",
        error_message: "waId, phoneNumberId y messageText son obligatorios.",
        blocked_reasons: ["invalid_payload"],
        warnings: ["Request body invalido o incompleto."],
        meta_payload_preview: null,
        response_body: null
      },
      { status: 400 }
    );
  }

  const guard = validateMetaSendGuards(normalized);
  if (!guard.ok) {
    return Response.json(
      {
        ok: false,
        status: guard.errorCode ?? "failed",
        error_code: guard.errorCode,
        error_message: guard.errorMessage,
        blocked_reasons: guard.blockedReasons,
        warnings: guard.warnings,
        meta_payload_preview: guard.metaPayloadPreview,
        response_body: null,
        adapter_status: guard.adapterStatus
      },
      { status: 200 }
    );
  }

  const result = await sendMetaWhatsAppTextMessage(normalized);
  return Response.json(result);
}
