import type { CommercialOperationalLoopResult } from "../operational-loop";
import type { CustomerOnboardingPostPlanResult } from "./customer-session";
import { buildOnboardingGroundedMessage } from "./buildOnboardingGroundedMessage";

/**
 * Overrides the operational loop's selectedNextAction.draftMessage with the
 * real onboarding/identity outcome when the post-plan stage executed
 * create_customer/link_external_identity this turn. Unlike catalog grounding,
 * this may override even a null draftMessage (some next-action types like
 * "wait_for_customer" produce no draft on their own, but a just-completed
 * create/link still needs to reach the customer) and is not restricted to a
 * fixed next-action-type set - a real identity outcome outranks whatever
 * next action was selected before the post-plan stage ran.
 */
export function applyOnboardingGroundingToNextAction(
  loop: CommercialOperationalLoopResult | null,
  postPlanResult: CustomerOnboardingPostPlanResult
): CommercialOperationalLoopResult | null {
  if (!loop || !loop.selectedNextAction) return loop;

  const groundedMessage = buildOnboardingGroundedMessage(postPlanResult);
  if (!groundedMessage) return loop;

  return {
    ...loop,
    selectedNextAction: {
      ...loop.selectedNextAction,
      draftMessage: groundedMessage
    }
  };
}
