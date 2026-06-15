import { hasTable, insertExistingColumns, sanitizeDbError } from "@/lib/db";

export const AI_ORCHESTRATOR_SHADOW_LOG_TABLE = "ai_orchestrator_shadow_log";
export const DEFAULT_SHADOW_RAW_JSON_MAX_CHARS = 12000;

export type ShadowLogInput = {
  waId?: string | null;
  phoneNumberId?: string | null;
  messageId: string;
  conversationCaseId?: string | number | null;
  backendDecisionId?: string | null;
  backendIntent?: string | null;
  backendDepartment?: string | null;
  backendFinalAction?: string | null;
  backendRequiresHuman?: boolean | null;
  backendShouldReply?: boolean | null;
  backendConfidence?: number | null;
  backendOk: boolean;
  backendError?: string | null;
  currentN8nIntent?: string | null;
  currentN8nDepartment?: string | null;
  currentN8nFinalAction?: string | null;
  matchedIntent?: boolean | null;
  matchedDepartment?: boolean | null;
  matchedFinalAction?: boolean | null;
  latencyMs?: number | null;
  rawRequestJson?: unknown;
  rawResponseJson?: unknown;
};

export type ShadowLogOptions = {
  rawJsonMaxChars?: number;
};

function toNullableString(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function toNullableNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toNullableBool(value: boolean | null | undefined) {
  if (value === undefined || value === null) return null;
  return value ? 1 : 0;
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars);
}

export function prepareShadowRawJson(value: unknown, maxChars = DEFAULT_SHADOW_RAW_JSON_MAX_CHARS) {
  if (value === undefined) return null;

  const serialized = JSON.stringify(value);
  if (!serialized) return null;
  if (serialized.length <= maxChars) return serialized;

  return JSON.stringify({
    truncated: true,
    originalChars: serialized.length,
    maxChars,
    preview: truncateText(serialized, maxChars)
  });
}

export async function writeAiOrchestratorShadowLog(input: ShadowLogInput, options: ShadowLogOptions = {}) {
  try {
    const tableExists = await hasTable(AI_ORCHESTRATOR_SHADOW_LOG_TABLE);
    if (!tableExists) {
      return { ok: false as const, error: `${AI_ORCHESTRATOR_SHADOW_LOG_TABLE} no disponible` };
    }

    const rawJsonMaxChars = options.rawJsonMaxChars ?? DEFAULT_SHADOW_RAW_JSON_MAX_CHARS;

    await insertExistingColumns(
      AI_ORCHESTRATOR_SHADOW_LOG_TABLE,
      {
        wa_id: toNullableString(input.waId),
        phone_number_id: toNullableString(input.phoneNumberId),
        message_id: input.messageId,
        conversation_case_id: toNullableNumber(input.conversationCaseId),
        backend_decision_id: toNullableString(input.backendDecisionId),
        backend_intent: toNullableString(input.backendIntent),
        backend_department: toNullableString(input.backendDepartment),
        backend_final_action: toNullableString(input.backendFinalAction),
        backend_requires_human: toNullableBool(input.backendRequiresHuman),
        backend_should_reply: toNullableBool(input.backendShouldReply),
        backend_confidence: toNullableNumber(input.backendConfidence),
        backend_ok: input.backendOk ? 1 : 0,
        backend_error: input.backendError ? truncateText(input.backendError, 500) : null,
        current_n8n_intent: toNullableString(input.currentN8nIntent),
        current_n8n_department: toNullableString(input.currentN8nDepartment),
        current_n8n_final_action: toNullableString(input.currentN8nFinalAction),
        matched_intent: toNullableBool(input.matchedIntent),
        matched_department: toNullableBool(input.matchedDepartment),
        matched_final_action: toNullableBool(input.matchedFinalAction),
        latency_ms: toNullableNumber(input.latencyMs),
        raw_request_json: prepareShadowRawJson(input.rawRequestJson, rawJsonMaxChars),
        raw_response_json: prepareShadowRawJson(input.rawResponseJson, rawJsonMaxChars),
        created_at: "__CHILE_NOW__"
      },
      ["message_id"]
    );

    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: sanitizeDbError(error) };
  }
}
