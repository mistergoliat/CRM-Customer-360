import { createCustomerOnboardingService } from "@/lib/domains/customer-onboarding";
import type { CustomerOnboardingCollectedData, CustomerOnboardingService, CustomerOnboardingState } from "@/lib/domains/customer-onboarding";
import type { ResolveCustomerInput } from "@/lib/domains/customer-service";
import { executeGovernedCapability } from "../../capability-gateway/executeCapability";
import type { CapabilityGatewayResult } from "../../capability-gateway/types";
import { extractCustomerOnboardingFields } from "./extractCustomerOnboardingFields";
import { recordExternalIdentityResolution, recordIdentityCapabilityOutcome, recordOnboardingTransitionIfChanged, recordSessionWarnings } from "./identityAuditEvents";
import {
  computePendingOnboardingFields,
  isAllowedCreateCustomerPurpose,
  mapOnboardingPurposeToCommercialPurpose,
  mapOperationToOnboardingPurpose,
  requiredOnboardingFieldsForPurpose
} from "./onboardingPurposeMapping";
import { completeOnboardingWithCustomer, landOnboardingInTerminalState } from "./onboardingTransitions";
import { defaultResolveCustomerExternal, type ResolveCustomerExternalFn } from "./resolveNativeCustomerSession";
import { mergeWarnings } from "./warnings";
import type { NativeCustomerSessionExecutionContext } from "./types";

// ACS-R1-04-T06.1. Runs once per turn, after the canonical (legacy) planner
// decided this turn's action, and only in the legacy pipeline - never
// multi-request (task section 21). Never repeats local resolution, the
// initial onboarding load, identity reconciliation, Customer 360 loading or
// the planner itself; reuses customerSessionExecution built in the pre-plan
// phase (resolveNativeCustomerSession). Never generates customer-facing text.

/** The single structured signal the post-plan phase reacts to - never free-text keyword search. */
export type CustomerOnboardingPlannedOperation = {
  /** A key resolvable via onboardingPurposeMapping.ts (e.g. a CommercialOperationalLoopNextActionType), or null when this turn's plan needs no identity. */
  operation: string | null;
};

export type CustomerOnboardingPostPlanDependencies = {
  onboardingService?: CustomerOnboardingService;
  resolveCustomerExternal?: ResolveCustomerExternalFn;
  now?: () => Date;
};

export type CustomerOnboardingPostPlanInput = {
  plannedOperation: CustomerOnboardingPlannedOperation;
  messageText: string;
  correlationId: string;
  /** Built once in the pre-plan phase (resolveNativeCustomerSession) - never reloaded, never re-resolved here. */
  customerSessionExecution: NativeCustomerSessionExecutionContext;
  /**
   * ACS-R1-04-T07 correlation only (release spec section 9). The canonical
   * loop's own opportunity/decision, already computed by the caller before
   * this stage runs - never re-derived here, never used to gate any
   * create_customer/link_external_identity authority.
   */
  opportunityId?: string | null;
  decisionId?: string | null;
  dependencies?: CustomerOnboardingPostPlanDependencies;
};

export const CUSTOMER_ONBOARDING_POST_PLAN_ATTEMPTED_OPERATIONS = [
  "none",
  "start_onboarding",
  "collect_fields",
  "resolve_customer",
  "create_customer",
  "link_external_identity"
] as const;
export type CustomerOnboardingPostPlanAttemptedOperation = (typeof CUSTOMER_ONBOARDING_POST_PLAN_ATTEMPTED_OPERATIONS)[number];

export type CustomerOnboardingPostPlanResult = {
  attemptedOperation: CustomerOnboardingPostPlanAttemptedOperation;
  onboarding: CustomerOnboardingState | null;
  capabilityOutcome: CapabilityGatewayResult | null;
  warnings: string[];
};

const TERMINAL_STATUSES: CustomerOnboardingState["status"][] = ["completed", "conflict", "temporarily_blocked", "temporarily_unavailable"];

function buildCollectedPatch(candidates: ReturnType<typeof extractCustomerOnboardingFields>): Partial<CustomerOnboardingCollectedData> {
  const patch: Partial<CustomerOnboardingCollectedData> = {};
  if (candidates.firstName) patch.firstName = candidates.firstName;
  if (candidates.lastName) patch.lastName = candidates.lastName;
  if (candidates.email) patch.email = candidates.email;
  if (candidates.orderReference) patch.orderReference = candidates.orderReference;
  return patch;
}

/**
 * Sole entry point for post-plan onboarding activation, multi-turn field
 * capture, and create_customer/link_external_identity execution. Never
 * writes crm_customer_onboarding_state directly - only CustomerOnboardingService's
 * public transitions. Never generates customer-facing text (see
 * applyOnboardingGroundingToNextAction for that projector).
 */
export async function runCustomerOnboardingPostPlanStage(input: CustomerOnboardingPostPlanInput): Promise<CustomerOnboardingPostPlanResult> {
  const onboardingService = input.dependencies?.onboardingService ?? createCustomerOnboardingService();
  const resolveCustomerExternal = input.dependencies?.resolveCustomerExternal ?? defaultResolveCustomerExternal;
  const now = input.dependencies?.now ?? (() => new Date());

  const session = input.customerSessionExecution;
  const warnings: string[] = [];
  let attemptedOperation: CustomerOnboardingPostPlanAttemptedOperation = "none";
  let onboarding = session.onboarding;

  // Local identity was not resolved. "anonymous" and "identification_required"
  // both mean this - mapLocalResolution (pre-plan) only reports
  // "identification_required" when onboarding was ALREADY active before this
  // turn; a brand-new conversation's first identity-requiring turn always
  // shows "anonymous" instead, since onboarding does not exist yet at the
  // point pre-plan resolves identity. Checking only "identification_required"
  // would make activation (step 1) and the create gate (step 3) unreachable
  // on a conversation's very first turn.
  const identityUnresolved = session.identity.status === "anonymous" || session.identity.status === "identification_required";

  // 1. Activation: only a structured planned operation that maps to an
  // allowed purpose, only while identity is still unresolved, only when no
  // onboarding is active yet (task section 7 - never for a public query,
  // never re-activated once something already exists).
  const purpose = input.plannedOperation.operation ? mapOperationToOnboardingPurpose(input.plannedOperation.operation) : null;
  if (purpose && identityUnresolved && !onboarding) {
    const started = await onboardingService.startOnboarding({
      conversationId: session.conversationId,
      opportunityId: session.opportunityId,
      purpose,
      pendingFields: requiredOnboardingFieldsForPurpose(purpose)
    });
    if (started.ok) {
      await recordOnboardingTransitionIfChanged({ operation: "start", previous: null, result: started, correlationId: input.correlationId });
      onboarding = started.state;
      attemptedOperation = "start_onboarding";
    } else if (started.status === "purpose_conflict") {
      // A concurrent turn/race already started onboarding for a different
      // purpose - reload the real state, never silently overwrite it.
      onboarding = await onboardingService.getState(session.conversationId);
    }
  }

  // 2. Multi-turn field capture (task sections 8-12) - only while still
  // collecting, from the current message only, through CustomerOnboardingService
  // only. Skipped entirely when there is no onboarding or it already reached
  // a terminal state - never reinitiated or overwritten here. This never
  // blocks the link_external_identity path below: a returning, already-
  // identified customer with no active onboarding can still link.
  if (onboarding && !TERMINAL_STATUSES.includes(onboarding.status) && (onboarding.status === "required" || onboarding.status === "collecting")) {
    const candidates = extractCustomerOnboardingFields(input.messageText);
    const patch = buildCollectedPatch(candidates);
    if (Object.keys(patch).length > 0) {
      const merged = { ...onboarding.collected, ...patch };
      const pendingFields = computePendingOnboardingFields(onboarding.purpose, merged);
      const previous = onboarding;
      const result = await onboardingService.collectFields({
        conversationId: onboarding.conversationId,
        expectedVersion: onboarding.version,
        collectedPatch: patch,
        pendingFields
      });
      if (result.ok) {
        await recordOnboardingTransitionIfChanged({ operation: "collect_fields", previous, result, correlationId: input.correlationId });
        onboarding = result.state;
        attemptedOperation = "collect_fields";
      } else if (result.status === "onboarding_state_version_conflict") {
        // Reload once, revalidate, never loop (task section 12).
        const reloaded = await onboardingService.getState(onboarding.conversationId);
        if (reloaded) onboarding = reloaded;
        warnings.push("customer_onboarding_version_conflict");
      }
    }
  }

  // 3. create_customer path: an onboarding row must exist, be non-terminal,
  // local identity never resolved, minimum data present, explicit create
  // consent from THIS turn, allowed purpose.
  if (onboarding && !TERMINAL_STATUSES.includes(onboarding.status) && identityUnresolved) {
    const consent = session.currentTurnConsent.createCustomer;
    const commercialPurpose = mapOnboardingPurposeToCommercialPurpose(onboarding.purpose);
    const requiredFields = requiredOnboardingFieldsForPurpose(onboarding.purpose);
    const hasMinimumData = requiredFields.every((field) => Boolean(onboarding?.collected[field]));

    if (consent && hasMinimumData && commercialPurpose && isAllowedCreateCustomerPurpose(commercialPurpose)) {
      // Never call resolve_customer twice in the same turn - reuse pre-plan's
      // fresh evidence if it already attempted this (task section 14).
      let evidence = session.freshExternalResolutionEvidence;
      if (!evidence) {
        attemptedOperation = "resolve_customer";
        const resolveInput: ResolveCustomerInput = {
          channel: "whatsapp",
          externalId: session.trustedInbound.externalId,
          phoneNumber: session.trustedInbound.normalizedPhone,
          email: onboarding.collected.email ?? null
        };
        try {
          evidence = await resolveCustomerExternal(resolveInput, { correlationId: input.correlationId });
        } catch {
          evidence = { source: "customer_service", requestId: "unavailable", checkedAt: now().toISOString(), result: { status: "temporarily_unavailable", retryable: true } };
        }
        await recordExternalIdentityResolution({
          phase: "post_plan",
          messageId: session.trustedInbound.messageId,
          correlationId: input.correlationId,
          conversationId: session.conversationId,
          opportunityId: input.opportunityId ?? session.opportunityId,
          evidence
        });
      }

      if (evidence.result.status === "resolved") {
        const landed = await completeOnboardingWithCustomer(onboardingService, onboarding, evidence.result.customerId, input.correlationId);
        onboarding = landed.state;
        if (landed.warning) warnings.push(landed.warning);
      } else if (evidence.result.status === "conflict") {
        warnings.push("customer_identity_conflict");
        const landed = await landOnboardingInTerminalState(onboardingService, onboarding, "conflict", input.correlationId);
        onboarding = landed.state;
        if (landed.warning) warnings.push(landed.warning);
      } else if (evidence.result.status === "temporarily_unavailable") {
        warnings.push("customer_service_unavailable");
      } else if (evidence.result.status === "invalid_input") {
        warnings.push("customer_identity_invalid_input");
      } else {
        // no_match: the only outcome that allows create_customer to run.
        attemptedOperation = "create_customer";
        const trustedCustomerSession: NativeCustomerSessionExecutionContext = { ...session, onboarding, freshExternalResolutionEvidence: evidence };
        const outcome = await executeGovernedCapability("create_customer", {}, { correlationId: input.correlationId, trustedCustomerSession });
        await recordIdentityCapabilityOutcome({
          capability: "create_customer",
          correlationId: input.correlationId,
          conversationId: session.conversationId,
          opportunityId: input.opportunityId ?? session.opportunityId,
          customerId: session.identity.customerId,
          decisionId: input.decisionId,
          gatewayResult: outcome
        });
        const refreshed = await onboardingService.getState(onboarding.conversationId);
        if (refreshed) onboarding = refreshed;
        const finalWarnings = mergeWarnings(warnings);
        await recordSessionWarnings({
          phase: "post_plan",
          messageId: session.trustedInbound.messageId,
          correlationId: input.correlationId,
          conversationId: session.conversationId,
          opportunityId: input.opportunityId ?? session.opportunityId,
          customerId: session.identity.customerId,
          decisionId: input.decisionId,
          executionPublicId: outcome.executionPublicId,
          warnings: finalWarnings
        });
        return { attemptedOperation, onboarding, capabilityOutcome: outcome, warnings: finalWarnings };
      }
    }
  }

  // 4. link_external_identity path: identity already resolved this turn but
  // not yet via the exact wa_id (source !== "external_identity" means the
  // wa_id itself is not the confirmed match yet), with explicit link consent
  // from THIS turn. Always separate from create_customer - never both in the
  // same turn (see the early return above).
  if (session.identity.status === "identified" && session.identity.customerId && session.identity.source !== "external_identity") {
    const consent = session.currentTurnConsent.linkExternalIdentity;
    if (consent) {
      attemptedOperation = "link_external_identity";
      const trustedCustomerSession: NativeCustomerSessionExecutionContext = { ...session, onboarding };
      const outcome = await executeGovernedCapability("link_external_identity", {}, { correlationId: input.correlationId, trustedCustomerSession });
      await recordIdentityCapabilityOutcome({
        capability: "link_external_identity",
        correlationId: input.correlationId,
        conversationId: session.conversationId,
        opportunityId: input.opportunityId ?? session.opportunityId,
        customerId: session.identity.customerId,
        decisionId: input.decisionId,
        gatewayResult: outcome
      });
      const refreshed = await onboardingService.getState(session.conversationId);
      if (refreshed) onboarding = refreshed;
      const finalWarnings = mergeWarnings(warnings);
      await recordSessionWarnings({
        phase: "post_plan",
        messageId: session.trustedInbound.messageId,
        correlationId: input.correlationId,
        conversationId: session.conversationId,
        opportunityId: input.opportunityId ?? session.opportunityId,
        customerId: session.identity.customerId,
        decisionId: input.decisionId,
        executionPublicId: outcome.executionPublicId,
        warnings: finalWarnings
      });
      return { attemptedOperation, onboarding, capabilityOutcome: outcome, warnings: finalWarnings };
    }
  }

  const finalWarnings = mergeWarnings(warnings);
  await recordSessionWarnings({
    phase: "post_plan",
    messageId: session.trustedInbound.messageId,
    correlationId: input.correlationId,
    conversationId: session.conversationId,
    opportunityId: input.opportunityId ?? session.opportunityId,
    customerId: session.identity.customerId,
    decisionId: input.decisionId,
    warnings: finalWarnings
  });
  return { attemptedOperation, onboarding, capabilityOutcome: null, warnings: finalWarnings };
}
