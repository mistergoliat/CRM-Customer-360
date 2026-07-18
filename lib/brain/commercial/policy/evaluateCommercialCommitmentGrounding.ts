import { isPendingActionSentence, isQuestionSentence, splitIntoSentences } from "../commercialSentenceClassifier";
import { buildPolicyIssue } from "./policyUtils";
import type { CommercialPolicyIssue, CommercialPolicyRuleId } from "./policyTypes";
import type { SalesAgentClaimType } from "../sales-agent/validationTypes";

type TopicKeywordEntry = { pattern: RegExp; claimType: SalesAgentClaimType };

/**
 * Maps a commercial-topic keyword to the SalesAgentClaimType that would
 * ground a declarative statement about it. Mentioning one of these words
 * alone is never enough to flag anything - findSensitiveTopics only ever
 * runs on sentences that already passed the question/pending-action skip
 * below (evaluateCommercialCommitmentGrounding), so a bare topic mention in
 * a question ("Necesitas revisar el precio?") or a pending action ("Voy a
 * consultar el stock.") is never reached in the first place.
 */
const TOPIC_KEYWORDS: TopicKeywordEntry[] = [
  // "cuesta(n)"/"vale(n)" ("costs"/"is worth") are as common as the noun
  // "precio" itself for stating a concrete figure in Spanish ("La jaula A
  // cuesta $500.000.") - missing them would let the exact declarative
  // phrasing this correction targets skip grounding entirely.
  { pattern: /\bprecios?\b|\bcuestan?\b|\bvalen?\b/i, claimType: "price" },
  { pattern: /\bstock\b/i, claimType: "stock" },
  { pattern: /\bdespachos?\b/i, claimType: "dispatch" },
  { pattern: /\bentregas?\b/i, claimType: "delivery" },
  { pattern: /\bplazos?\b/i, claimType: "delivery" },
  { pattern: /\bgarant[ií]as?\b/i, claimType: "warranty" },
  { pattern: /\bdescuentos?\b/i, claimType: "promotion" },
  { pattern: /\bdisponibilidad\b|\bdisponibles?\b/i, claimType: "service_availability" },
  { pattern: /\bpedidos?\b/i, claimType: "order_status" }
];

function findSensitiveTopics(sentence: string): SalesAgentClaimType[] {
  const found = new Set<SalesAgentClaimType>();
  for (const entry of TOPIC_KEYWORDS) {
    if (entry.pattern.test(sentence)) found.add(entry.claimType);
  }
  return [...found];
}

/**
 * ACS-R1-05-T06.2 (second correction, section 4/5): MVP-scoped instance
 * matching. The Sales Agent contract (SalesAgentClaim) has no dedicated
 * productId/entityId field, so a real "same entity" check cannot be built
 * without inventing new contract surface (out of scope - "no construyas
 * infraestructura futura por anticipado"). Instead, this compares the
 * concrete NUMBER (and, best-effort, currency) named in the sentence against
 * the concrete number named in each candidate claim's own `value` string -
 * in practice two different products/facts almost always carry two
 * different numbers, so exact-number matching is an honest, deterministic
 * proxy for "same instance" without pretending to resolve entity identity
 * the contract doesn't expose. When a sentence names no extractable number
 * (most stock/availability/warranty/dispatch statements), matching falls
 * back to the coarser type-level check - the best signal actually available.
 */
function extractNormalizedAmount(text: string): number | null {
  const match = text.match(/\$?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?/);
  if (!match) return null;
  const integerPart = match[1].replace(/\./g, "");
  const amount = Number(integerPart);
  return Number.isFinite(amount) ? amount : null;
}

const CURRENCY_TOKENS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bclp\b/i, "CLP"],
  [/\bus\$|\busd\b/i, "USD"],
  [/\bd[oó]lares?\b/i, "USD"],
  [/\beuros?\b|\beur\b/i, "EUR"],
  [/\bars\b/i, "ARS"],
  [/\bpesos?\b/i, "CLP"]
];

const BARE_DOLLAR_SIGN_PATTERN = /\$/;

function extractCurrencyToken(text: string): string | null {
  for (const [pattern, code] of CURRENCY_TOKENS) {
    if (pattern.test(text)) return code;
  }
  // A bare "$" with no explicit code defaults to the retailer's own currency
  // (CLP) - this is what lets an explicit foreign-currency claim ("500000
  // USD") actually conflict with a plain "$500.000" statement instead of
  // silently comparing as "no currency signal on either side".
  if (BARE_DOLLAR_SIGN_PATTERN.test(text)) return "CLP";
  return null;
}

export type GroundedCommercialClaim = { type: SalesAgentClaimType; value: string };

export type CommercialCommitmentGroundingResult = {
  ungroundedTopics: SalesAgentClaimType[];
  issues: CommercialPolicyIssue[];
  warnings: string[];
  appliedRules: CommercialPolicyRuleId[];
  requiresReview: boolean;
};

const EMPTY_RESULT: CommercialCommitmentGroundingResult = {
  ungroundedTopics: [],
  issues: [],
  warnings: [],
  appliedRules: [],
  requiresReview: false
};

/**
 * ACS-R1-05-T06.2 (P1 correction, hardened in the second correction pass).
 * Scans the Sales Agent's own free-text draft (never the deterministic
 * catalog-grounded message - that is composed separately from real hydrated
 * batch data in buildCatalogGroundedMessage.ts and only overrides
 * selectedNextAction's draftMessage AFTER the operational loop, and
 * therefore after policy, has already run) for declarative sensitive-topic
 * statements that are not backed by a kept, verified claim of the matching
 * type AND matching concrete value. Questions and pending/tentative actions
 * ("Voy a revisar el precio.") are never flagged, regardless of topic - only
 * a stated fact without a matching, instance-specific claim is.
 *
 * Fail-safe by design (section 5 of the task): a clearly matching number
 * grounds the statement; an absent, ambiguous, or differently-valued claim
 * never does - this function only ever contributes to `requires_review`,
 * never to a hard `blocked` (a declarative statement that could be true but
 * lacks proof is not the same risk class as an unconditional promise).
 */
export function evaluateCommercialCommitmentGrounding(
  draftText: string | null | undefined,
  groundedClaims: readonly GroundedCommercialClaim[]
): CommercialCommitmentGroundingResult {
  if (!draftText || !draftText.trim()) return EMPTY_RESULT;

  const sentences = splitIntoSentences(draftText);
  const ungrounded = new Set<SalesAgentClaimType>();

  for (const sentence of sentences) {
    if (isQuestionSentence(sentence)) continue;
    if (isPendingActionSentence(sentence)) continue;

    for (const topic of findSensitiveTopics(sentence)) {
      const matchingClaims = groundedClaims.filter((claim) => claim.type === topic);
      if (matchingClaims.length === 0) {
        ungrounded.add(topic);
        continue;
      }

      const sentenceAmount = extractNormalizedAmount(sentence);
      if (sentenceAmount === null) {
        // No concrete figure to verify in this sentence - type-level presence
        // of grounding evidence is the strongest signal actually available.
        continue;
      }

      const sentenceCurrency = extractCurrencyToken(sentence);
      const hasMatchingInstance = matchingClaims.some((claim) => {
        const claimAmount = extractNormalizedAmount(claim.value);
        if (claimAmount === null || claimAmount !== sentenceAmount) return false;
        const claimCurrency = extractCurrencyToken(claim.value);
        if (sentenceCurrency && claimCurrency && sentenceCurrency !== claimCurrency) return false;
        return true;
      });

      if (!hasMatchingInstance) ungrounded.add(topic);
    }
  }

  if (ungrounded.size === 0) return EMPTY_RESULT;

  const ungroundedTopics = [...ungrounded];
  const issues: CommercialPolicyIssue[] = ungroundedTopics.map((topic) =>
    buildPolicyIssue(
      "evidence_missing",
      `Draft text makes a declarative statement about "${topic}" with no matching verified claim for the specific value stated.`,
      ["responseProposal", "draftText"],
      "POLICY-DRAFT-STATEMENT-EVIDENCE",
      { claimType: topic },
      "warning"
    )
  );

  return {
    ungroundedTopics,
    issues,
    warnings: ["commercial_statement_missing_evidence"],
    appliedRules: ["POLICY-DRAFT-STATEMENT-EVIDENCE"],
    requiresReview: true
  };
}
