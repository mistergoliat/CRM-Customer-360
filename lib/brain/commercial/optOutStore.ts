import { safeExecute, safeQueryRows } from "@/lib/db";

/**
 * ACS-R1-05.1-T02.3D, decision 11. Minimal opt-out registry: an explicit
 * customer command ("STOP", "BAJA", ...) blocks every future autonomous
 * outbound message on this channel - inbound replies AND follow-ups, never
 * just one or the other. This is one of the non-configurable invariants
 * (see SalesAgentFollowUpConfiguration's doc comment) - it is checked here,
 * never exposed as something the Hub can turn off.
 */

const DEFAULT_CHANNEL = "whatsapp";

export type RecordCustomerOptOutInput = {
  waId: string;
  channel?: string;
  /** explicit_customer_command is the only source this task implements - reserved for a future operator-initiated opt-out, never inferred. */
  reason: string;
  sourceMessageId?: string | null;
};

export type RecordCustomerOptOutResult = { ok: true } | { ok: false; error: string };

/** Idempotent - a customer sending "STOP" twice (or a retried write) is still exactly one opt-out row (INSERT IGNORE on the wa_id+channel unique key). */
export async function recordCustomerOptOut(input: RecordCustomerOptOutInput): Promise<RecordCustomerOptOutResult> {
  const result = await safeExecute(
    `INSERT IGNORE INTO crm_customer_opt_outs (wa_id, channel, reason, source_message_id) VALUES (?, ?, ?, ?)`,
    [input.waId, input.channel ?? DEFAULT_CHANNEL, input.reason, input.sourceMessageId ?? null]
  );
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function isCustomerOptedOut(waId: string, channel: string = DEFAULT_CHANNEL): Promise<boolean> {
  const result = await safeQueryRows<{ id: number }>(
    `SELECT id FROM crm_customer_opt_outs WHERE wa_id = ? AND channel = ? LIMIT 1`,
    [waId, channel]
  );
  return result.ok && result.rows.length > 0;
}

// Inverted Spanish "!"/"?" (U+00A1 / U+00BF) plus ordinary punctuation -
// written as \u escapes, not literal glyphs, to keep this file ASCII-only.
const OPT_OUT_PUNCTUATION_PATTERN = /[.,!?"'`;:¡¿]+/g;
// Combining diacritical marks (U+0300-U+036F) left behind by NFD
// decomposition - stripping this range turns an accented word into its
// unaccented form after NFD, independent of the customer's original accents.
const COMBINING_DIACRITICS_PATTERN = /[̀-ͯ]/g;

function normalizeForOptOutDetection(text: string): string {
  return text
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS_PATTERN, "")
    .toLowerCase()
    .replace(OPT_OUT_PUNCTUATION_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deliberately an EXACT-match allowlist against a small, human-reviewed set
 * of unambiguous unsubscribe commands - never a substring/keyword match.
 * This is what guarantees ordinary commercial objections ("no", "no
 * gracias", "no me interesa", "no por ahora") can never be mistaken for an
 * opt-out: none of them are in this set, and there is no fuzzy/partial
 * matching that could accidentally catch them. Only add a new entry here
 * after confirming it is unambiguous on its own, with no product-inquiry
 * reading.
 */
const EXPLICIT_OPT_OUT_COMMANDS = new Set([
  "stop",
  "baja",
  "unsubscribe",
  "cancelar suscripcion",
  "cancelar subscripcion",
  "date de baja",
  "darme de baja",
  "quiero darme de baja",
  "eliminame de la lista",
  "borrame de la lista",
  "no quiero mas mensajes",
  "no quiero recibir mas mensajes",
  "no me escribas mas",
  "no me envies mas mensajes",
  "no me contactes mas",
  "dejen de escribirme",
  "dejar de recibir mensajes",
  "dejen de enviarme mensajes"
]);

export function detectExplicitOptOutCommand(rawText: string): boolean {
  const normalized = normalizeForOptOutDetection(rawText);
  if (!normalized) return false;
  return EXPLICIT_OPT_OUT_COMMANDS.has(normalized);
}
