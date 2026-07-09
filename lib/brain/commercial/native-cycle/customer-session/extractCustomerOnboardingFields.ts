import { normalizeEmail } from "@/lib/customer-identity/normalize";
import { isValidEmail } from "@/lib/domains/customers/validation";

// ACS-R1-04-T06.1, contract sections 9-11. Deterministic, conservative
// extraction from the CURRENT inbound message only - never Customer 360,
// never prior turns, never LLM-proposed candidates. Read-only: never writes
// anything. Favors false negatives over false positives (section 10).

export type CustomerOnboardingFieldCandidates = {
  firstName?: string;
  lastName?: string;
  email?: string;
  orderReference?: string;
};

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// -----------------------------------------------------------------------
// Email (section 9)
// -----------------------------------------------------------------------

const EMAIL_TOKEN_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function extractEmail(messageText: string): string | undefined {
  const match = messageText.match(EMAIL_TOKEN_PATTERN);
  if (!match) return undefined;
  const normalized = normalizeEmail(match[0]);
  if (!normalized || !isValidEmail(normalized)) return undefined;
  return normalized;
}

// -----------------------------------------------------------------------
// Name (section 10) - "me llamo X" / "mi nombre es X" / "soy X" / "nombre: X"
// -----------------------------------------------------------------------

const NAME_CUE_PATTERN = /\b(?:me llamo|mi nombre es|nombre\s*:|soy)\s+([^.,;\n!?]{1,60})/i;

// Words that can immediately follow "soy"/etc without being a name -
// capture stops (or never starts) here. Not exhaustive by design: false
// negatives are acceptable, false positives are not (section 10).
const NAME_STOPWORDS = new Set([
  "cliente",
  "clienta",
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "nuevo",
  "nueva",
  "antiguo",
  "antigua",
  "encargado",
  "encargada",
  "gerente",
  "dueno",
  "duena",
  "socio",
  "socia",
  "representante",
  "parte",
  "aqui",
  "quien",
  "quiere",
  "necesito",
  "quiero",
  "tengo",
  "busco",
  "vengo",
  "trabajo",
  "y",
  "e",
  "que",
  "para",
  "por",
  "con",
  "sin",
  "muy",
  "aun",
  "todavia"
]);

function looksLikeEmailOrUrl(token: string): boolean {
  // The name-cue capture stops at "." (sentence-boundary punctuation), so a
  // domain like "www.tienda.com" can arrive here already truncated to just
  // "www" - reject that fragment on its own too, never just the full form.
  if (/^www$/i.test(token)) return true;
  return /[@]/.test(token) || /^https?:\/\//i.test(token) || /\bwww\./i.test(token) || /\.(com|cl|net|org)\b/i.test(token);
}

function extractName(messageText: string): { firstName?: string; lastName?: string } {
  const match = messageText.match(NAME_CUE_PATTERN);
  if (!match) return {};

  const rawTokens = match[1].trim().split(/\s+/).filter(Boolean);
  const nameTokens: string[] = [];

  for (const token of rawTokens.slice(0, 3)) {
    if (/\d/.test(token)) break;
    if (looksLikeEmailOrUrl(token)) break;
    if (token.length > 20) break;
    const normalizedToken = stripDiacritics(token).toLowerCase();
    if (NAME_STOPWORDS.has(normalizedToken)) {
      if (nameTokens.length === 0) return {};
      break;
    }
    nameTokens.push(token);
  }

  if (nameTokens.length === 0) return {};
  if (nameTokens.length === 1) return { firstName: nameTokens[0] };
  return { firstName: nameTokens[0], lastName: nameTokens.slice(1).join(" ") };
}

// -----------------------------------------------------------------------
// Order reference (section 11) - requires an explicit label cue
// -----------------------------------------------------------------------

// A real separator (whitespace, or ":"/"#" surrounded by optional
// whitespace) is required between the cue word and the captured token - a
// cue word glued directly onto other text (e.g. inside a URL path like
// ".../pedido-123") must never match.
const ORDER_REFERENCE_CUE_PATTERN =
  /\b(?:numero de pedido|numero de orden|n[uo]?mero de pedido|n[uo]?mero de orden|pedido|orden|compra|referencia)\b(?:\s+(?:es|de compra))?(?:\s+|\s*[:#]\s*)([A-Za-z0-9-]{3,20})\b/i;

function looksLikeReferenceToken(token: string): boolean {
  return /\d/.test(token) && /^[A-Za-z0-9-]{3,20}$/.test(token);
}

function extractOrderReference(messageText: string): string | undefined {
  const normalized = stripDiacritics(messageText);
  const match = normalized.match(ORDER_REFERENCE_CUE_PATTERN);
  if (!match) return undefined;
  const candidate = match[1];
  if (!looksLikeReferenceToken(candidate)) return undefined;
  return candidate;
}

/**
 * Conservative, read-only extraction of onboarding fields from the current
 * inbound message text. Never inspects prior turns, Customer 360, or
 * LLM-proposed candidates - the message the customer just sent is the sole
 * authoritative source (contract sections 9-11).
 */
export function extractCustomerOnboardingFields(messageText: string): CustomerOnboardingFieldCandidates {
  const trimmed = messageText?.trim();
  if (!trimmed) return {};

  const email = extractEmail(trimmed);
  const { firstName, lastName } = extractName(trimmed);
  const orderReference = extractOrderReference(trimmed);

  const candidates: CustomerOnboardingFieldCandidates = {};
  if (firstName) candidates.firstName = firstName;
  if (lastName) candidates.lastName = lastName;
  if (email) candidates.email = email;
  if (orderReference) candidates.orderReference = orderReference;
  return candidates;
}
