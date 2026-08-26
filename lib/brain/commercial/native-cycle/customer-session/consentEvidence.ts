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

// SALES-AGENT-R2-ID-R2-A09, PARTE 9. Target noun narrowed to the CHANNEL
// itself ("whatsapp"/"numero"/"telefono") - "perfil"/"cuenta" were removed
// (they used to overlap with LINK_PRESTASHOP_IDENTITY_PATTERN below, which
// would have let "vincula mi cuenta" authorize the wrong bridge). This is a
// genuine security-relevant narrowing, not a wording tweak: two structurally
// different mutations (channel-control vs. e-commerce account adjudication)
// must never share one ambiguous target-noun vocabulary. A phrase that also
// names the channel explicitly ("vincula mi cuenta de whatsapp") still
// matches here as intended.
const LINK_EXTERNAL_IDENTITY_PATTERN =
  /\b(autoriz\w*|acepto|confirmo|si|ok|dale|bueno|correcto)\b[^.;\n]{0,40}\b(vincula\w*|asocia\w*|liga\w*)\b[^.;\n]{0,60}\b(whatsapp|numero|telefono)\b/i;

// SALES-AGENT-R2-ID-R2-A09. The PrestaShop canonical bridge's own consent
// scope - never inferred from LINK_EXTERNAL_IDENTITY_PATTERN. "confirma\w*"
// is included alongside vincula/asocia/liga since A08's revised READY_TO_LINK
// wording (buildCommercialWorkFinalizerMessage.ts) asks "¿confirmas que la
// vinculemos a tu perfil...?", and a customer's short affirmative echo
// ("confirmo") should count as the action verb, not just the leading
// acknowledgement group.
const LINK_PRESTASHOP_IDENTITY_PATTERN =
  /\b(autoriz\w*|acepto|confirmo|si|ok|dale|bueno|correcto)\b[^.;\n]{0,40}\b(vincula\w*|asocia\w*|liga\w*|confirma\w*)\b[^.;\n]{0,60}\b(perfil|cuenta|prestashop)\b/i;

const SCOPE_PATTERNS: Record<ConsentScope, RegExp> = {
  create_customer: CREATE_CUSTOMER_PATTERN,
  link_external_identity: LINK_EXTERNAL_IDENTITY_PATTERN,
  link_prestashop_identity: LINK_PRESTASHOP_IDENTITY_PATTERN
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

export function parseAllConsentEvidence(
  input: ParseConsentInput
): { createCustomer: ConsentEvidence | null; linkExternalIdentity: ConsentEvidence | null; linkPrestashopIdentity: ConsentEvidence | null } {
  return {
    createCustomer: parseConsentEvidence(input, "create_customer"),
    linkExternalIdentity: parseConsentEvidence(input, "link_external_identity"),
    linkPrestashopIdentity: parseConsentEvidence(input, "link_prestashop_identity")
  };
}
