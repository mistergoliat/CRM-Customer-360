import type { RequestCandidate } from "./buildDeterministicCandidates";
import type { DetectedTurnIntent, RequestOperation } from "./turnPlanTypes";

/**
 * Deterministic linker: decides, per detection, whether the intent creates a
 * new request or continues an existing one. Resolution order (most explicit
 * wins): explicit candidateRequestId -> single active same-intent request ->
 * most recent of several same-intent requests -> new request. Linking never
 * comes from model output alone: candidateRequestId is only honored when it
 * matches a real active candidate.
 */
export function linkRequestsToIntents(
  detections: readonly DetectedTurnIntent[],
  candidates: readonly RequestCandidate[]
): RequestOperation[] {
  return detections.map((detection): RequestOperation => {
    const explicit = detection.candidateRequestId
      ? candidates.find((candidate) => candidate.requestId === detection.candidateRequestId) ?? null
      : null;
    if (explicit) {
      return {
        detectionId: detection.detectionId,
        operation: detection.suggestedOperation === "cancel_request" ? "cancel" : detection.suggestedOperation === "modify_request" ? "modify" : "continue",
        requestId: explicit.requestId,
        intentType: detection.canonicalIntent,
        intentDomain: detection.domain,
        strategy: "explicit_reference",
        confidence: detection.confidence,
        reasonCode: "explicit_candidate_matched_active_request"
      };
    }

    const sameIntent = candidates.filter((candidate) => candidate.intentType === detection.canonicalIntent);

    if (detection.suggestedOperation === "create_request" || sameIntent.length === 0) {
      return {
        detectionId: detection.detectionId,
        operation: "create",
        requestId: null,
        intentType: detection.canonicalIntent,
        intentDomain: detection.domain,
        strategy: "new_request",
        confidence: detection.confidence,
        reasonCode: sameIntent.length === 0 ? "no_active_request_for_intent" : "provider_requested_new_request"
      };
    }

    if (sameIntent.length === 1) {
      return {
        detectionId: detection.detectionId,
        operation: "continue",
        requestId: sameIntent[0].requestId,
        intentType: detection.canonicalIntent,
        intentDomain: detection.domain,
        strategy: "intent_and_fact_match",
        confidence: detection.confidence,
        reasonCode: "single_active_request_for_intent"
      };
    }

    // ponytail: several active requests share this intent and nothing points at
    // one explicitly - default to the most recently touched (candidates arrive
    // sorted desc). The LLM provider's llm_disambiguation strategy is the
    // upgrade path for explicit separation.
    return {
      detectionId: detection.detectionId,
      operation: "continue",
      requestId: sameIntent[0].requestId,
      intentType: detection.canonicalIntent,
      intentDomain: detection.domain,
      strategy: "active_recent_request",
      confidence: Math.min(detection.confidence, 0.5),
      reasonCode: "ambiguous_same_intent_defaulted_to_recent"
    };
  });
}
