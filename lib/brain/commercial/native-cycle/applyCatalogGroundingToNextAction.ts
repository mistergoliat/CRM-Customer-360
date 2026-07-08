import type { CommercialOperationalLoopResult } from "../operational-loop";
import type { CatalogGroundingResult } from "./buildCatalogGroundedMessage";

const GROUNDABLE_NEXT_ACTION_TYPES = new Set(["respond", "recommend_products", "ask_clarifying_question", "qualify"]);

/**
 * Overrides the operational loop's selectedNextAction.draftMessage with the
 * capability-gateway-grounded message when one was produced. This never lets
 * the LLM's own (potentially ungrounded) draft reach the customer once a real
 * catalog capability ran - the deterministic, evidence-backed text always
 * wins so product/price/stock claims are never invented (ADR-005/ADR-006).
 */
export function applyCatalogGroundingToNextAction(
  loop: CommercialOperationalLoopResult | null,
  catalogGrounding: CatalogGroundingResult
): CommercialOperationalLoopResult | null {
  if (!loop || !loop.selectedNextAction) return loop;
  if (!catalogGrounding.executed || !catalogGrounding.groundedMessage) return loop;
  if (!GROUNDABLE_NEXT_ACTION_TYPES.has(loop.selectedNextAction.type)) return loop;
  if (loop.selectedNextAction.draftMessage === null) return loop;

  return {
    ...loop,
    selectedNextAction: {
      ...loop.selectedNextAction,
      draftMessage: catalogGrounding.groundedMessage
    }
  };
}
