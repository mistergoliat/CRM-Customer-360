import { safeExecute, safeQueryRows } from "@/lib/db";
import { auditLog } from "@/lib/audit";

/**
 * ACS-R1-05.1-T02.3D, decision 11. Minimal opt-out registry: an explicit
 * customer command ("STOP", "BAJA", ...) blocks every future autonomous
 * outbound message on this channel - inbound replies AND follow-ups, never
 * just one or the other. This is one of the non-configurable invariants
 * (see SalesAgentFollowUpConfiguration's doc comment) - it is checked here,
 * never exposed as something the Hub can turn off.
 *
 * Review correction (post-close): the status check must never fail open. A
 * DB read failure used to be treated as "not opted out" (silently letting
 * autonomy proceed) - it now returns a distinct "unavailable" outcome that
 * every caller (native-cycle Step 0.5, the follow-up worker) is required to
 * treat as blocking, exactly like a real opt-out.
 */

const DEFAULT_CHANNEL = "whatsapp";

export type CustomerOptOutStatus = "opted_out" | "not_opted_out" | "unavailable";

/** Never fails open - a DB read failure returns "unavailable", which callers must treat as blocking (never proceed as if not opted out). */
export async function checkCustomerOptOutStatus(waId: string, channel: string = DEFAULT_CHANNEL): Promise<CustomerOptOutStatus> {
  const result = await safeQueryRows<{ id: number }>(
    `SELECT id FROM crm_customer_opt_outs WHERE wa_id = ? AND channel = ? LIMIT 1`,
    [waId, channel]
  );
  if (!result.ok) return "unavailable";
  return result.rows.length > 0 ? "opted_out" : "not_opted_out";
}

export type RecordCustomerOptOutInput = {
  waId: string;
  channel?: string;
  /** explicit_customer_command is the only source this task implements - reserved for a future operator-initiated opt-out, never inferred. */
  reason: string;
  sourceMessageId?: string | null;
};

export type RecordCustomerOptOutResult = { ok: true; cancelledFollowUps: number } | { ok: false; error: string };

/**
 * Idempotent - a customer sending "STOP" twice (or a retried write) is
 * still exactly one opt-out row (INSERT IGNORE on the wa_id+channel unique
 * key). Every call also cancels every currently-pending schedule_followup
 * row for this identity, unconditionally and idempotently (a second call
 * finds nothing left to cancel, never an error) - an opt-out means no
 * future autonomous send, including one already scheduled before the
 * opt-out was recorded. Both the registration and any cancellations are
 * audited.
 */
export async function recordCustomerOptOut(input: RecordCustomerOptOutInput): Promise<RecordCustomerOptOutResult> {
  const channel = input.channel ?? DEFAULT_CHANNEL;
  const insertResult = await safeExecute(
    `INSERT IGNORE INTO crm_customer_opt_outs (wa_id, channel, reason, source_message_id) VALUES (?, ?, ?, ?)`,
    [input.waId, channel, input.reason, input.sourceMessageId ?? null]
  );
  if (!insertResult.ok) return { ok: false, error: insertResult.error };

  await auditLog({
    action: "customer_opt_out.recorded",
    entityType: "customer_opt_out",
    entityId: input.waId,
    after: { waId: input.waId, channel, reason: input.reason, sourceMessageId: input.sourceMessageId ?? null }
  });

  const cancelResult = await safeExecute(
    `UPDATE crm_agent_actions
      SET status = 'cancelled', cancel_reason = 'customer_opted_out', updated_at = CURRENT_TIMESTAMP(3)
      WHERE wa_id = ? AND channel = ? AND action_type = 'schedule_followup'
        AND status IN ('planned', 'requires_review', 'executing')`,
    [input.waId, channel]
  );
  const cancelledFollowUps = cancelResult.ok ? cancelResult.affectedRows : 0;
  if (cancelledFollowUps > 0) {
    await auditLog({
      action: "customer_opt_out.pending_followups_cancelled",
      entityType: "customer_opt_out",
      entityId: input.waId,
      after: { waId: input.waId, channel, cancelledCount: cancelledFollowUps }
    });
  }

  return { ok: true, cancelledFollowUps };
}

export type RecordCustomerOptInInput = {
  waId: string;
  channel?: string;
  /** explicit_customer_command (customer sent an unambiguous opt-in command while opted out) or operator_action (a controlled human reversal - no Hub surface yet, this is the domain primitive it would call). */
  reason: string;
  sourceMessageId?: string | null;
};

export type RecordCustomerOptInResult = { ok: true } | { ok: false; error: string };

/**
 * Durable, explicit reversal - deletes the opt-out row so future
 * checkCustomerOptOutStatus calls report "not_opted_out" again. Nothing to
 * re-cancel here: every follow-up pending at opt-out time was already
 * cancelled by recordCustomerOptOut, and no new one could have been
 * scheduled while opted out (Step 0.5 blocks autonomy entirely).
 */
export async function recordCustomerOptIn(input: RecordCustomerOptInInput): Promise<RecordCustomerOptInResult> {
  const channel = input.channel ?? DEFAULT_CHANNEL;
  const result = await safeExecute(`DELETE FROM crm_customer_opt_outs WHERE wa_id = ? AND channel = ?`, [input.waId, channel]);
  if (!result.ok) return { ok: false, error: result.error };

  await auditLog({
    action: "customer_opt_in.recorded",
    entityType: "customer_opt_out",
    entityId: input.waId,
    after: { waId: input.waId, channel, reason: input.reason, sourceMessageId: input.sourceMessageId ?? null }
  });

  return { ok: true };
}

// Inverted Spanish "!"/"?" (U+00A1 / U+00BF) plus ordinary punctuation -
// written as \u escapes, not literal glyphs, to keep this file ASCII-only.
const OPT_OUT_PUNCTUATION_PATTERN = /[.,!?"'`;:\u00a1\u00bf]+/g;
// Combining diacritical marks (U+0300-U+036F) left behind by NFD
// decomposition - stripping this range turns an accented word into its
// unaccented form after NFD, independent of the customer's original accents.
const COMBINING_DIACRITICS_PATTERN = /[\u0300-\u036f]/g;

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

/**
 * Same exact-match convention as EXPLICIT_OPT_OUT_COMMANDS. Only ever
 * consulted while the customer IS currently opted out (see
 * runNativeAutonomousCycle.ts Step 0.5) - that context gate is what makes
 * even a short, otherwise-ambiguous "si" safe to accept here without ever
 * being confused with an ordinary affirmative answer during a normal,
 * opted-in conversation, where this list is never checked at all.
 */
const EXPLICIT_OPT_IN_COMMANDS = new Set([
  "start",
  "si",
  "si quiero",
  "quiero volver a recibir mensajes",
  "quiero recibir mensajes de nuevo",
  "reactivar",
  "reactivar mensajes",
  "activar",
  "suscribirme",
  "quiero suscribirme de nuevo",
  "quiero suscribirme",
  "dar de alta",
  "darme de alta"
]);

export function detectExplicitOptInCommand(rawText: string): boolean {
  const normalized = normalizeForOptOutDetection(rawText);
  if (!normalized) return false;
  return EXPLICIT_OPT_IN_COMMANDS.has(normalized);
}
