import type { ConsentEvidence, ConsentScope } from "./types";

/**
 * Deterministic, conservative consent parser (task section 10). A bare
 * acknowledgement ("si", "ok", "dale", "bueno", "correcto") is never
 * sufficient by itself - it must appear alongside an explicit, unambiguous
 * action verb and target noun for the specific scope, in the SAME message,
 * with no negation immediately in front of the authorizing word.
 */

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const NEGATION_PATTERN = /\bno\s+(\w+\s+){0,2}?(autoriz\w*|acepto|confirmo|quiero)\b/i;

const CREATE_CUSTOMER_PATTERN =
  /\b(autoriz\w*|acepto|confirmo|si|ok|dale|bueno|correcto)\b[^.;\n]{0,40}\b(crea\w*|genera\w*)\b[^.;\n]{0,40}\b(cuenta|ficha|perfil)\b/i;

const LINK_EXTERNAL_IDENTITY_PATTERN =
  /\b(autoriz\w*|acepto|confirmo|si|ok|dale|bueno|correcto)\b[^.;\n]{0,40}\b(vincula\w*|asocia\w*|liga\w*)\b[^.;\n]{0,60}\b(whatsapp|numero|telefono|perfil|cuenta)\b/i;

const SCOPE_PATTERNS: Record<ConsentScope, RegExp> = {
  create_customer: CREATE_CUSTOMER_PATTERN,
  link_external_identity: LINK_EXTERNAL_IDENTITY_PATTERN
};

export type ParseConsentInput = {
  messageText: string;
  messageId: string;
  capturedAt: string;
};

/**
 * Returns evidence only when the current message explicitly and
 * unambiguously authorizes the given scope. Never inspects prior turns -
 * consent belongs to the current turn only (task section 10).
 */
export function parseConsentEvidence(input: ParseConsentInput, scope: ConsentScope): ConsentEvidence | null {
  const normalized = stripDiacritics(input.messageText.trim().toLowerCase());
  if (!normalized) return null;
  if (NEGATION_PATTERN.test(normalized)) return null;
  if (!SCOPE_PATTERNS[scope].test(normalized)) return null;

  return {
    scope,
    messageId: input.messageId,
    capturedAt: input.capturedAt,
    source: "current_inbound"
  };
}

export function parseAllConsentEvidence(input: ParseConsentInput): { createCustomer: ConsentEvidence | null; linkExternalIdentity: ConsentEvidence | null } {
  return {
    createCustomer: parseConsentEvidence(input, "create_customer"),
    linkExternalIdentity: parseConsentEvidence(input, "link_external_identity")
  };
}
