import { createCustomerServicePort } from "@/lib/integrations/customer-service";
import { createCustomerServiceClient } from "@/lib/domains/customer-service";
import type { CustomerServicePort } from "@/lib/domains/customer-service";
import { createCustomerOnboardingService } from "@/lib/domains/customer-onboarding";
import type { CustomerOnboardingPendingField, CustomerOnboardingService } from "@/lib/domains/customer-onboarding";
import { mapOnboardingPurposeToCommercialPurpose } from "../native-cycle/customer-session/onboardingPurposeMapping";
import { completeOnboardingWithCustomer, landOnboardingInTerminalState } from "../native-cycle/customer-session/onboardingTransitions";
import type { CapabilityExecutionOutcome, CapabilityGatewayContext, CapabilityGatewayDefinition } from "./types";

const CAPABILITY_GATEWAY_VERSION = "capability-gateway.v1" as const;

let cachedPort: CustomerServicePort | undefined;
function getSharedCustomerServicePort(): CustomerServicePort {
  if (!cachedPort) cachedPort = createCustomerServicePort();
  return cachedPort;
}

/** Test-only: force the registry to re-read env / re-create the Customer Service port. */
export function resetCustomerServicePortForTests() {
  cachedPort = undefined;
}

let cachedOnboardingService: CustomerOnboardingService | undefined;
function getSharedOnboardingService(): CustomerOnboardingService {
  if (!cachedOnboardingService) cachedOnboardingService = createCustomerOnboardingService();
  return cachedOnboardingService;
}

/** Test-only: force the registry to re-create the onboarding service (e.g. after injecting a fake). */
export function resetOnboardingServiceForTests() {
  cachedOnboardingService = undefined;
}

/** Test-only: inject a fake onboarding service directly, bypassing the real DB-backed default. */
export function setOnboardingServiceForTests(service: CustomerOnboardingService) {
  cachedOnboardingService = service;
}

function evidenceOf(source: string, summary: string): CapabilityExecutionOutcome["evidence"] {
  return [{ source, summary, capturedAt: new Date().toISOString() }];
}

/**
 * resolve_customer: read-only, autonomous (contract section 9). Invoked
 * directly by resolveNativeCustomerSession - never by an LLM tool request -
 * so it needs no trustedCustomerSession and no tool alias.
 */
function resolveCustomerCapability(): CapabilityGatewayDefinition {
  return {
    capability: "resolve_customer",
    version: CAPABILITY_GATEWAY_VERSION,
    description: "Read-only identity resolution via the external Customer Service boundary.",
    governance: { sideEffect: "read_only", authority: "autonomous", riskClass: "low" },
    maxRetries: 0,
    async checkAvailability() {
      return { status: "available", reason: null };
    },
    async execute(input) {
      const client = createCustomerServiceClient(getSharedCustomerServicePort());
      const evidence = await client.resolveCustomer({
        channel: "whatsapp",
        externalId: String(input.externalId ?? ""),
        phoneNumber: typeof input.phoneNumber === "string" ? input.phoneNumber : null,
        email: typeof input.email === "string" ? input.email : null
      });

      if (evidence.result.status === "temporarily_unavailable") {
        return {
          status: "temporarily_blocked",
          data: null,
          errorCode: "temporarily_unavailable",
          retryable: evidence.result.retryable,
          evidence: evidenceOf("customer_service", "resolve_customer reported temporarily_unavailable.")
        };
      }

      return {
        status: "completed",
        data: evidence as unknown as Record<string, unknown>,
        errorCode: null,
        retryable: false,
        evidence: evidenceOf("customer_service", `resolve_customer returned ${evidence.result.status}.`)
      };
    }
  };
}

/**
 * create_customer / link_external_identity: mutating, consent-gated
 * (contract section 9). Both ignore the LLM-supplied tool-request input
 * entirely - every sensitive value is assembled server-side from
 * context.trustedCustomerSession (contract section 16 / task section 16).
 */
function createCustomerCapability(): CapabilityGatewayDefinition {
  return {
    capability: "create_customer",
    version: CAPABILITY_GATEWAY_VERSION,
    description: "Creates a canonical customer via Customer Service, gated by policy and explicit consent.",
    // Conceptual authority is "policy" (docs/data/customer-creation-linking-authority-contract.md
    // section 9) - the Gateway's own authority field is binary and only means
    // "does an operator have to pre-approve this regardless of policy". No
    // operator step exists here: evaluateCreateCustomerAuthority (called
    // inside execute()) is the real gate, so "autonomous" is the correct
    // value for this field specifically.
    governance: { sideEffect: "mutating", authority: "autonomous", riskClass: "medium" },
    maxRetries: 0,
    async checkAvailability() {
      return { status: "available", reason: null };
    },
    async execute(_input, context: CapabilityGatewayContext) {
      const session = context.trustedCustomerSession;
      if (!session) {
        return { status: "denied", data: null, errorCode: "missing_trusted_session", retryable: false, evidence: [] };
      }

      const onboarding = session.onboarding;
      const consent = session.currentTurnConsent.createCustomer;
      const commercialPurpose = mapOnboardingPurposeToCommercialPurpose(onboarding?.purpose);
      const client = createCustomerServiceClient(getSharedCustomerServicePort());
      const capabilityExecutionId = `${context.correlationId}:create_customer`;

      const outcome = await client.createCustomer({
        capabilityExecutionId,
        firstName: onboarding?.collected.firstName ?? "",
        lastName: onboarding?.collected.lastName ?? null,
        email: onboarding?.collected.email ?? "",
        phoneNumber: session.trustedInbound.normalizedPhone,
        origin: { channel: "whatsapp", externalId: session.trustedInbound.externalId },
        // evaluateCreateCustomerAuthority denies any purpose outside CREATE_CUSTOMER_ALLOWED_PURPOSES.
        // An unmapped onboarding purpose (or no onboarding at all) must fail closed, never guess a
        // valid-looking default - "none" is deliberately not a member of that allowlist.
        commercialPurpose: (commercialPurpose ?? "none") as never,
        // consent.createCustomer must reflect whether THIS turn actually
        // carries parsed consent evidence - hardcoding true here would let
        // evaluateCreateCustomerAuthority's consent gate always pass.
        consent: { createCustomer: consent !== null, messageId: consent?.messageId ?? "", capturedAt: consent?.capturedAt ?? "" },
        resolutionEvidence: session.freshExternalResolutionEvidence ?? { source: "customer_service", requestId: "none", checkedAt: new Date().toISOString(), result: { status: "temporarily_unavailable", retryable: false } }
      });

      const onboardingService = getSharedOnboardingService();

      if (outcome.stage === "denied_by_policy") {
        const decision = outcome.decision;
        if (decision.status === "missing_information") {
          if (onboarding && onboarding.status !== "resolving") {
            await onboardingService.collectFields({
              conversationId: onboarding.conversationId,
              expectedVersion: onboarding.version,
              collectedPatch: {},
              pendingFields: decision.requiredFields as CustomerOnboardingPendingField[]
            });
          }
          return { status: "missing_information", data: { requiredFields: decision.requiredFields }, errorCode: null, retryable: false, evidence: [] };
        }
        if (decision.status === "requires_consent") {
          return { status: "denied", data: null, errorCode: `consent_required:${decision.consentType}`, retryable: false, evidence: [] };
        }
        if (decision.status === "requires_human") {
          return { status: "requires_approval", data: null, errorCode: decision.reasonCode, retryable: false, evidence: [] };
        }
        return { status: "denied", data: null, errorCode: decision.reasonCode, retryable: false, evidence: [] };
      }

      // Post-execution onboarding transitions (contract section 16's outcome
      // table) - the domain's own state machine is the only writer, never a
      // direct field mutation here.
      const result = outcome.result;

      if (result.status === "created" || result.status === "matched_existing") {
        if (onboarding) await completeOnboardingWithCustomer(onboardingService, onboarding, result.customerId);
        return { status: "completed", data: result as unknown as Record<string, unknown>, errorCode: null, retryable: false, evidence: evidenceOf("customer_service", `create_customer ${result.status}.`) };
      }
      if (result.status === "missing_information") {
        if (onboarding && onboarding.status !== "resolving") {
          await onboardingService.collectFields({
            conversationId: onboarding.conversationId,
            expectedVersion: onboarding.version,
            collectedPatch: {},
            pendingFields: result.requiredFields as CustomerOnboardingPendingField[]
          });
        }
        return { status: "missing_information", data: { requiredFields: result.requiredFields }, errorCode: null, retryable: false, evidence: [] };
      }
      if (result.status === "conflict") {
        if (onboarding) await landOnboardingInTerminalState(onboardingService, onboarding, "conflict");
        return { status: "completed", data: result as unknown as Record<string, unknown>, errorCode: "customer_creation_conflict", retryable: false, evidence: evidenceOf("customer_service", "create_customer conflict.") };
      }
      if (result.status === "denied") {
        return { status: "denied", data: null, errorCode: result.reason, retryable: false, evidence: [] };
      }
      if (result.status === "invalid_input") {
        return { status: "invalid_arguments", data: null, errorCode: result.fields.join(","), retryable: false, evidence: [] };
      }
      if (result.status === "temporarily_unavailable") {
        return { status: "temporarily_blocked", data: null, errorCode: "temporarily_unavailable", retryable: result.retryable, evidence: [] };
      }
      return { status: "failed", data: null, errorCode: result.code, retryable: result.retryable, evidence: [] };
    }
  };
}

function linkExternalIdentityCapability(): CapabilityGatewayDefinition {
  return {
    capability: "link_external_identity",
    version: CAPABILITY_GATEWAY_VERSION,
    description: "Links the current WhatsApp identity to a resolved customer via Customer Service, gated by explicit consent.",
    // Conceptual authority is "requires_consent" (customer consent, checked
    // inside execute() via evaluateLinkExternalIdentityAuthority) - not
    // operator pre-approval, so the Gateway's binary authority field is
    // "autonomous" here too (see create_customer for the same reasoning).
    governance: { sideEffect: "mutating", authority: "autonomous", riskClass: "medium" },
    maxRetries: 0,
    async checkAvailability() {
      return { status: "available", reason: null };
    },
    async execute(_input, context: CapabilityGatewayContext) {
      const session = context.trustedCustomerSession;
      if (!session?.identity.customerId) {
        return { status: "denied", data: null, errorCode: "customer_id_required", retryable: false, evidence: [] };
      }

      const consent = session.currentTurnConsent.linkExternalIdentity;
      const client = createCustomerServiceClient(getSharedCustomerServicePort());
      const capabilityExecutionId = `${context.correlationId}:link_external_identity`;

      const outcome = await client.linkExternalIdentity({
        capabilityExecutionId,
        customerId: session.identity.customerId,
        externalIdentity: { provider: "whatsapp", externalId: session.trustedInbound.externalId, normalizedPhone: session.trustedInbound.normalizedPhone },
        inboundWaId: session.trustedInbound.externalId,
        // granted must reflect whether THIS turn actually carries parsed
        // consent evidence - hardcoding true would always pass the gate
        // regardless of consent (see create_customer for the same fix).
        consent: { granted: consent !== null, messageId: consent?.messageId ?? "", capturedAt: consent?.capturedAt ?? "" }
      });

      if (outcome.stage === "denied_by_policy") {
        const decision = outcome.decision;
        if (decision.status === "missing_information") {
          return { status: "missing_information", data: { requiredFields: decision.requiredFields }, errorCode: null, retryable: false, evidence: [] };
        }
        if (decision.status === "requires_consent") {
          return { status: "denied", data: null, errorCode: `consent_required:${decision.consentType}`, retryable: false, evidence: [] };
        }
        if (decision.status === "requires_human") {
          return { status: "requires_approval", data: null, errorCode: decision.reasonCode, retryable: false, evidence: [] };
        }
        return { status: "denied", data: null, errorCode: decision.reasonCode, retryable: false, evidence: [] };
      }

      // Post-execution onboarding transitions (contract section 16's outcome
      // table) - only applies when this turn's session carries an onboarding
      // row still short of "completed"; a returning customer with no active
      // onboarding has nothing to transition.
      const onboardingService = getSharedOnboardingService();
      const onboarding = session.onboarding;
      const result = outcome.result;

      if (result.status === "completed" || result.status === "already_linked") {
        if (onboarding && onboarding.status !== "completed") {
          await completeOnboardingWithCustomer(onboardingService, onboarding, session.identity.customerId);
        }
        return { status: "completed", data: result as unknown as Record<string, unknown>, errorCode: null, retryable: false, evidence: evidenceOf("customer_service", `link_external_identity ${result.status}.`) };
      }
      if (result.status === "conflict") {
        if (onboarding && onboarding.status !== "conflict") await landOnboardingInTerminalState(onboardingService, onboarding, "conflict");
        return { status: "completed", data: result as unknown as Record<string, unknown>, errorCode: "customer_link_conflict", retryable: false, evidence: evidenceOf("customer_service", "link_external_identity conflict.") };
      }
      if (result.status === "denied") {
        return { status: "denied", data: null, errorCode: result.reason, retryable: false, evidence: [] };
      }
      if (result.status === "invalid_input") {
        return { status: "invalid_arguments", data: null, errorCode: result.fields.join(","), retryable: false, evidence: [] };
      }
      if (result.status === "temporarily_unavailable") {
        return { status: "temporarily_blocked", data: null, errorCode: "temporarily_unavailable", retryable: result.retryable, evidence: [] };
      }
      return { status: "failed", data: null, errorCode: result.code, retryable: result.retryable, evidence: [] };
    }
  };
}

export const CUSTOMER_IDENTITY_CAPABILITY_DEFINITIONS: readonly CapabilityGatewayDefinition[] = [
  resolveCustomerCapability(),
  createCustomerCapability(),
  linkExternalIdentityCapability()
];
