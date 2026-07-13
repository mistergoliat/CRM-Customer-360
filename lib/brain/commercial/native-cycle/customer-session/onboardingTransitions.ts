import type { CustomerOnboardingService, CustomerOnboardingState } from "@/lib/domains/customer-onboarding";
import { recordOnboardingTransitionIfChanged } from "./identityAuditEvents";

// Shared onboarding-state transition helpers (ACS-R1-04-T06, contract
// section 18). Deliberately dependency-free beyond the onboarding domain
// itself (plus the ACS-R1-04-T07 audit recorder, which only depends on the
// events family - never on the Capability Gateway) - resolveNativeCustomerSession
// and the create_customer/link_external_identity Gateway capabilities both
// call these, and neither may import the other (resolveNativeCustomerSession
// -> Capability Gateway -> registry -> the identity capabilities would
// otherwise cycle back here).

/** Moves onboarding into a terminal state (conflict/temporarily_unavailable), landing through "resolving" first if needed. Never reinitiates an already-terminal state. */
export async function landOnboardingInTerminalState(
  onboardingService: CustomerOnboardingService,
  onboarding: CustomerOnboardingState,
  target: "conflict" | "temporarily_unavailable",
  correlationId?: string | null
): Promise<{ state: CustomerOnboardingState; warning: string | null }> {
  let current = onboarding;
  if (current.status === "required" || current.status === "collecting") {
    const moved = await onboardingService.markResolving({ conversationId: current.conversationId, expectedVersion: current.version });
    if (!moved.ok) return { state: current, warning: moved.status === "onboarding_state_version_conflict" ? "customer_onboarding_version_conflict" : null };
    await recordOnboardingTransitionIfChanged({ operation: "mark_resolving", previous: current, result: moved, correlationId });
    current = moved.state;
  }
  // Never reinitiate an already-terminal state (conflict/temporarily_blocked/completed) - section 18.
  if (current.status !== "resolving") return { state: current, warning: null };

  const transition =
    target === "conflict"
      ? await onboardingService.markConflict({ conversationId: current.conversationId, expectedVersion: current.version })
      : await onboardingService.markTemporarilyUnavailable({ conversationId: current.conversationId, expectedVersion: current.version });
  if (!transition.ok) return { state: current, warning: transition.status === "onboarding_state_version_conflict" ? "customer_onboarding_version_conflict" : null };
  await recordOnboardingTransitionIfChanged({
    operation: target === "conflict" ? "mark_conflict" : "mark_temporarily_unavailable",
    previous: current,
    result: transition,
    correlationId
  });
  return { state: transition.state, warning: null };
}

/** Completes onboarding with a resolved customerId, landing through "resolving" first if needed. */
export async function completeOnboardingWithCustomer(
  onboardingService: CustomerOnboardingService,
  onboarding: CustomerOnboardingState,
  customerId: string,
  correlationId?: string | null
): Promise<{ state: CustomerOnboardingState; warning: string | null }> {
  let current = onboarding;
  if (current.status === "required" || current.status === "collecting") {
    const moved = await onboardingService.markResolving({ conversationId: current.conversationId, expectedVersion: current.version });
    if (!moved.ok) return { state: current, warning: moved.status === "onboarding_state_version_conflict" ? "customer_onboarding_version_conflict" : null };
    await recordOnboardingTransitionIfChanged({ operation: "mark_resolving", previous: current, result: moved, correlationId });
    current = moved.state;
  }
  if (current.status !== "resolving") return { state: current, warning: null };

  const completed = await onboardingService.completeOnboarding({ conversationId: current.conversationId, expectedVersion: current.version, customerId });
  if (!completed.ok) {
    if (completed.status === "customer_conflict") return { state: current, warning: "customer_identity_conflict" };
    return { state: current, warning: completed.status === "onboarding_state_version_conflict" ? "customer_onboarding_version_conflict" : null };
  }
  await recordOnboardingTransitionIfChanged({ operation: "complete", previous: current, result: completed, correlationId });
  return { state: completed.state, warning: null };
}
