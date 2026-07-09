import type { ConversationRequestDomain } from "../conversation-request";
import type { AutonomousCustomerContext } from "../context/autonomousCustomerContext";
import type { AutonomousCustomerContextLoadState } from "../context/loadAutonomousCustomerContext";
import type { CustomerSessionDecisionContext } from "../native-cycle/customer-session";
import type { RequestCandidate } from "./buildDeterministicCandidates";
import type { DetectedTurnIntent } from "./turnPlanTypes";

export type TurnPlannerProviderInput = {
  messageText: string;
  candidates: readonly RequestCandidate[];
  /**
   * ACS-R1-04-T05: reduced Customer 360 history, already loaded once upstream
   * - a future LLM provider can read it without querying Customer 360 again.
   * The deterministic provider below ignores both fields.
   */
  customerContext?: AutonomousCustomerContext | null;
  customerContextState?: AutonomousCustomerContextLoadState;
  /**
   * ACS-R1-04-T06: minimized identity/onboarding decision context, already
   * resolved once upstream. A future LLM provider can propose resolve_customer/
   * create_customer/link_external_identity by name only - it never receives
   * customerId, PII or consent evidence; those are assembled server-side at
   * execution time. The deterministic provider below ignores this field.
   */
  customerSession?: CustomerSessionDecisionContext | null;
};

export type TurnPlannerProviderOutput = {
  detections: DetectedTurnIntent[];
};

/**
 * The planner provider is the ONLY component allowed to interpret the
 * customer message into intents. planTurn() is its only call site: one
 * planning pass per turn, never one per request.
 */
export type TurnPlannerProvider = {
  name: string;
  plan(input: TurnPlannerProviderInput): Promise<TurnPlannerProviderOutput>;
};

type KeywordRule = {
  canonicalIntent: string;
  domain: ConversationRequestDomain;
  pattern: RegExp;
  /** Generic rules only fire when no specific intent matched the message. */
  generic?: boolean;
};

/** Keyword matching runs over diacritic-stripped text ("cotízala" -> "cotizala"). */
function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Patterns are written WITHOUT accents and matched against stripped text.
// ponytail: keyword baseline; an LLM provider plugs in behind the same
// interface for paraphrase, explicit-separation and fact extraction.
const KEYWORD_RULES: readonly KeywordRule[] = [
  { canonicalIntent: "human_assistance", domain: "human_assistance", pattern: /\b(humano|persona real|ejecutivo|operador|hablar con alguien|agente humano)\b/i },
  { canonicalIntent: "complaint", domain: "support", pattern: /\b(reclamo|reclamar|queja|quejarme|molesto|indignad[oa])\b/i },
  { canonicalIntent: "warranty", domain: "warranty", pattern: /\bgarantias?\b/i },
  { canonicalIntent: "order_status", domain: "order", pattern: /\b(pedido|mi orden|mi compra|seguimiento|tracking|donde (esta|viene))\b/i },
  { canonicalIntent: "maintenance_quote", domain: "maintenance", pattern: /\b(mantencion|mantenimiento|servicio tecnico|reparacion|reparar)\b/i },
  { canonicalIntent: "product_quote", domain: "sales", pattern: /\b(cotiz\w*|presupuesto)\b/i },
  // "¿cuánto sale la mantención?" is a maintenance question, not a catalog
  // one: the generic price/stock rule yields to any specific match above.
  { canonicalIntent: "product_information", domain: "catalog", pattern: /\b(precio|cuanto (vale|cuesta|sale)|stock|disponib\w*|caracteristicas|medidas|dimensiones)\b/i, generic: true }
];

function detectIntentsByKeyword(messageText: string): Array<{ canonicalIntent: string; domain: ConversationRequestDomain; confidence: number }> {
  const text = stripDiacritics(messageText);
  const matched = KEYWORD_RULES.filter((rule) => rule.pattern.test(text));
  const hasSpecific = matched.some((rule) => !rule.generic);
  const matches = matched
    .filter((rule) => !rule.generic || !hasSpecific)
    .map((rule) => ({
      canonicalIntent: rule.canonicalIntent,
      domain: rule.domain,
      confidence: 0.6
    }));
  if (matches.length > 0) return matches;
  return [{ canonicalIntent: "general_question", domain: "general", confidence: 0.4 }];
}

/**
 * Deterministic keyword-based planner: multi-intent capable, zero LLM cost,
 * safe default when no model provider is configured. One detection per
 * canonical intent per message; extractedFacts stay empty (fact extraction is
 * provider-specific work).
 */
export function createDeterministicTurnPlannerProvider(): TurnPlannerProvider {
  return {
    name: "deterministic-keyword",
    async plan(input: TurnPlannerProviderInput): Promise<TurnPlannerProviderOutput> {
      const text = input.messageText.trim();
      if (!text) return { detections: [] };

      const detections = detectIntentsByKeyword(text).map((match, index): DetectedTurnIntent => {
        const sameIntentActives = input.candidates.filter((candidate) => candidate.intentType === match.canonicalIntent);
        return {
          detectionId: `det-${index + 1}-${match.canonicalIntent}`,
          rawIntent: match.canonicalIntent,
          canonicalIntent: match.canonicalIntent,
          domain: match.domain,
          confidence: match.confidence,
          suggestedOperation: sameIntentActives.length > 0 ? "continue_request" : "create_request",
          candidateRequestId: null,
          extractedFacts: []
        };
      });

      return { detections };
    }
  };
}
