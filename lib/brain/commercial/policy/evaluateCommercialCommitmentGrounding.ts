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
  { pattern: /\bprecios?\b/i, claimType: "price" },
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
 * ACS-R1-05-T06.2 (P1 correction). Scans the Sales Agent's own free-text
 * draft (never the deterministic catalog-grounded message - that is
 * composed separately from real hydrated batch data in
 * buildCatalogGroundedMessage.ts and only overrides selectedNextAction's
 * draftMessage AFTER the operational loop, and therefore after policy, has
 * already run) for declarative sensitive-topic statements that are not
 * backed by a kept, verified claim of the matching type. Questions and
 * pending/tentative actions ("Voy a revisar el precio.") are never flagged,
 * regardless of topic - only a stated fact without a matching claim is.
 *
 * This closes the gap evaluateCommercialClaims.ts cannot close on its own:
 * that module only governs claims the Sales Agent actually declared in
 * responseProposal.claims[]; nothing previously checked whether a
 * commercial fact written directly into draftText (bypassing the claims
 * contract entirely) was ever backed by real evidence.
 */
export function evaluateCommercialCommitmentGrounding(
  draftText: string | null | undefined,
  groundedClaimTypes: ReadonlySet<SalesAgentClaimType>
): CommercialCommitmentGroundingResult {
  if (!draftText || !draftText.trim()) return EMPTY_RESULT;

  const sentences = splitIntoSentences(draftText);
  const ungrounded = new Set<SalesAgentClaimType>();

  for (const sentence of sentences) {
    if (isQuestionSentence(sentence)) continue;
    if (isPendingActionSentence(sentence)) continue;
    for (const topic of findSensitiveTopics(sentence)) {
      if (!groundedClaimTypes.has(topic)) ungrounded.add(topic);
    }
  }

  if (ungrounded.size === 0) return EMPTY_RESULT;

  const ungroundedTopics = [...ungrounded];
  const issues: CommercialPolicyIssue[] = ungroundedTopics.map((topic) =>
    buildPolicyIssue(
      "evidence_missing",
      `Draft text makes a declarative statement about "${topic}" with no matching verified claim.`,
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
