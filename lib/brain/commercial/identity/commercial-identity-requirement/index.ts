import type { RuntimeIdentityContext } from "../../native-cycle/customer-session/runtimeIdentityContext";
import { decideCommercialIdentityRequirement } from "./evaluate";
import { getCommercialIdentityRequirement } from "./operations";
import type { CommercialOperation } from "./operations";
import type { CommercialIdentityRequirementDecision } from "./types";

export * from "./types";
export * from "./operations";
export { decideCommercialIdentityRequirement, isIdentityLevelAtLeast, IDENTITY_LEVELS_IN_COMPARISON_ORDER } from "./evaluate";

/**
 * Convenience wrapper matching the task's sketch signature
 * (`evaluateCommercialIdentityRequirement(operation, runtimeIdentity)`) -
 * looks up the operation's requirement (operations.ts) and decides it
 * (evaluate.ts#decideCommercialIdentityRequirement) in one call. Still pure,
 * still no I/O.
 */
export function evaluateCommercialIdentityRequirement(
  operation: CommercialOperation,
  runtimeIdentity: RuntimeIdentityContext
): CommercialIdentityRequirementDecision {
  return decideCommercialIdentityRequirement(getCommercialIdentityRequirement(operation), runtimeIdentity);
}
