import { createCustomerServicePort } from "@/lib/integrations/customer-service";
import { upsertExternalIdentity } from "@/lib/integrations/customer-external-identity";
import { createCustomerServiceClient } from "@/lib/domains/customer-service";
import type { CustomerServicePort } from "@/lib/domains/customer-service";
import { createCustomerOnboardingService } from "@/lib/domains/customer-onboarding";
import type { CustomerOnboardingPendingField, CustomerOnboardingService } from "@/lib/domains/customer-onboarding";
import { recordOnboardingTransitionIfChanged } from "../native-cycle/customer-session/identityAuditEvents";
import { recordPrestashopBridgeEvidence } from "../native-cycle/customer-session/identityEvidenceHooks";
import { mapOnboardingPurposeToCommercialPurpose } from "../native-cycle/customer-session/onboardingPurposeMapping";
import { completeOnboardingWithVerifiedCustomer, landOnboardingInTerminalState, verifyCustomerMasterProjection } from "../native-cycle/customer-session/onboardingTransitions";
import { deriveIdentityCapabilityBusinessOutcome } from "./identityCapabilityOutcome";
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

// ACS-R1-04-T07. Allowlisted, PII-free summaries for what the Gateway
// persists as request_summary_json/response_summary_json for these three
// capabilities specifically (release spec section 7 "Privacidad y
// minimizacion obligatoria"). Every other capability keeps the generic
// raw-input/raw-output behavior in executeCapability.ts unchanged.

function identityResponseSummary(
  capability: "resolve_customer" | "create_customer" | "link_external_identity" | "link_prestashop_identity",
  outcome: CapabilityExecutionOutcome,
  hasResolvedCustomer: boolean
): Record<string, unknown> {
  return {
    businessOutcome: deriveIdentityCapabilityBusinessOutcome(capability, outcome.status, outcome.data as Record<string, unknown> | null),
    gatewayStatus: outcome.status,
    retryable: outcome.retryable,
    stableErrorCode: outcome.errorCode,
    hasResolvedCustomer,
    hasExternalIdentity: capability !== "create_customer"
  };
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
    buildRequestSummary(input) {
      return {
        channel: "whatsapp",
        phoneAvailable: Boolean(input.phoneNumber),
        emailAvailable: Boolean(input.email),
        consentPresent: false,
        purpose: null,
        hasResolvedCustomer: false,
        hasExternalIdentity: Boolean(input.externalId)
      };
    },
    buildResponseSummary(outcome) {
      return identityResponseSummary("resolve_customer", outcome, false);
    },
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
    buildRequestSummary(_input, context) {
      const session = context.trustedCustomerSession;
      return {
        channel: "whatsapp",
        phoneAvailable: Boolean(session?.trustedInbound.normalizedPhone),
        emailAvailable: Boolean(session?.onboarding?.collected.email),
        consentPresent: session?.currentTurnConsent.createCustomer !== null && session?.currentTurnConsent.createCustomer !== undefined,
        purpose: session?.onboarding?.purpose ?? null,
        hasResolvedCustomer: Boolean(session?.identity.customerId),
        hasExternalIdentity: Boolean(session?.trustedInbound)
      };
    },
    buildResponseSummary(outcome, context) {
      return identityResponseSummary("create_customer", outcome, Boolean(context.trustedCustomerSession?.identity.customerId));
    },
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
            const result = await onboardingService.collectFields({
              conversationId: onboarding.conversationId,
              expectedVersion: onboarding.version,
              collectedPatch: {},
              pendingFields: decision.requiredFields as CustomerOnboardingPendingField[]
            });
            await recordOnboardingTransitionIfChanged({ operation: "collect_fields", previous: onboarding, result, correlationId: context.correlationId });
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
        // ACS-R1-04-T08.1: Customer Service really did succeed (the business
        // outcome created/matched_existing below is never changed by this) -
        // but the local master_customer projection is verified before
        // completing onboarding with its customerMasterId.
        const projectionWarnings: string[] = [];
        if (onboarding) {
          const gated = await completeOnboardingWithVerifiedCustomer(onboardingService, onboarding, result.customerMasterId, context.correlationId);
          if (gated.warning) projectionWarnings.push(gated.warning);
        }
        return {
          status: "completed",
          data: result as unknown as Record<string, unknown>,
          errorCode: null,
          retryable: false,
          evidence: evidenceOf("customer_service", `create_customer ${result.status}.`),
          warnings: projectionWarnings
        };
      }
      if (result.status === "missing_information") {
        if (onboarding && onboarding.status !== "resolving") {
          const collectResult = await onboardingService.collectFields({
            conversationId: onboarding.conversationId,
            expectedVersion: onboarding.version,
            collectedPatch: {},
            pendingFields: result.requiredFields as CustomerOnboardingPendingField[]
          });
          await recordOnboardingTransitionIfChanged({ operation: "collect_fields", previous: onboarding, result: collectResult, correlationId: context.correlationId });
        }
        return { status: "missing_information", data: { requiredFields: result.requiredFields }, errorCode: null, retryable: false, evidence: [] };
      }
      if (result.status === "conflict") {
        if (onboarding) await landOnboardingInTerminalState(onboardingService, onboarding, "conflict", context.correlationId);
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
    buildRequestSummary(_input, context) {
      const session = context.trustedCustomerSession;
      return {
        channel: "whatsapp",
        phoneAvailable: Boolean(session?.trustedInbound.normalizedPhone),
        emailAvailable: Boolean(session?.onboarding?.collected.email),
        consentPresent: session?.currentTurnConsent.linkExternalIdentity !== null && session?.currentTurnConsent.linkExternalIdentity !== undefined,
        purpose: session?.onboarding?.purpose ?? null,
        hasResolvedCustomer: Boolean(session?.identity.customerId),
        hasExternalIdentity: Boolean(session?.trustedInbound)
      };
    },
    buildResponseSummary(outcome, context) {
      return identityResponseSummary("link_external_identity", outcome, Boolean(context.trustedCustomerSession?.identity.customerId));
    },
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
        // ACS-R1-04-T08.1: verify Customer Service's echoed-back
        // customerMasterId agrees with the customer already known locally
        // this turn (session.identity.customerId, guaranteed non-null above)
        // and has a real master_customer row before trusting it further.
        const projectionWarnings: string[] = [];
        if (onboarding && onboarding.status !== "completed") {
          const gated = await completeOnboardingWithVerifiedCustomer(onboardingService, onboarding, result.customerMasterId, context.correlationId, {
            knownLocalCustomerId: session.identity.customerId
          });
          if (gated.warning) projectionWarnings.push(gated.warning);
        } else {
          const check = await verifyCustomerMasterProjection(result.customerMasterId, { knownLocalCustomerId: session.identity.customerId });
          if (check.status === "check_failed") projectionWarnings.push("customer_master_projection_check_failed");
          else if (check.status !== "verified") projectionWarnings.push("customer_master_projection_unavailable");
        }
        return {
          status: "completed",
          data: result as unknown as Record<string, unknown>,
          errorCode: null,
          retryable: false,
          evidence: evidenceOf("customer_service", `link_external_identity ${result.status}.`),
          warnings: projectionWarnings
        };
      }
      if (result.status === "conflict") {
        if (onboarding && onboarding.status !== "conflict") await landOnboardingInTerminalState(onboardingService, onboarding, "conflict", context.correlationId);
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

/**
 * link_prestashop_identity (SALES-AGENT-R2-ID-R2-A09). Closes the A08.1 gap:
 * a deliberately SEPARATE capability from link_external_identity above, not
 * that one generalized (task PRINCIPIO CENTRAL - WhatsApp link authority
 * proves channel control, this proves e-commerce account adjudication, a
 * different predicate). System-owned: never given a tool alias
 * (toolAliases.ts, unchanged) - triggered only by the identity workflow
 * (runCustomerOnboardingPostPlanStage's new step, gated on
 * RuntimeIdentityContext.status === "READY_TO_LINK", PARTE 7/GAP 1 - never
 * on session.identity.source, which is the WhatsApp-channel axis).
 * masterCustomerId/prestashopCustomerId are read exclusively from
 * session.runtimeIdentity (A05's server-computed READY_TO_LINK fact) - the
 * LLM-facing tool-request input is ignored entirely, same discipline as
 * create_customer/link_external_identity above.
 */
function linkPrestashopIdentityCapability(): CapabilityGatewayDefinition {
  return {
    capability: "link_prestashop_identity",
    version: CAPABILITY_GATEWAY_VERSION,
    description: "Links a verified PrestaShop candidate to the resolved master customer via Customer Service, gated by A04's READY_TO_LINK decision and explicit current-turn consent.",
    // Same reasoning as link_external_identity: conceptual authority is
    // "requires_consent" (checked inside execute() via
    // evaluateLinkPrestaShopIdentityAuthority), no operator pre-approval
    // step exists, so the Gateway's binary field is "autonomous".
    governance: { sideEffect: "mutating", authority: "autonomous", riskClass: "medium" },
    maxRetries: 0,
    buildRequestSummary(_input, context) {
      const session = context.trustedCustomerSession;
      return {
        channel: "whatsapp",
        readyToLink: session?.runtimeIdentity.status === "READY_TO_LINK",
        consentPresent: session?.currentTurnConsent.linkPrestashopIdentity !== null && session?.currentTurnConsent.linkPrestashopIdentity !== undefined,
        hasResolvedCustomer: Boolean(session?.runtimeIdentity.masterCustomerId),
        hasExternalIdentity: Boolean(session?.runtimeIdentity.prestashopCustomerId)
      };
    },
    buildResponseSummary(outcome, context) {
      return identityResponseSummary("link_prestashop_identity", outcome, Boolean(context.trustedCustomerSession?.runtimeIdentity.masterCustomerId));
    },
    async checkAvailability() {
      return { status: "available", reason: null };
    },
    async execute(_input, context: CapabilityGatewayContext) {
      const session = context.trustedCustomerSession;
      if (!session) {
        return { status: "denied", data: null, errorCode: "missing_trusted_session", retryable: false, evidence: [] };
      }

      // PARTE 3: the higher-level precondition this capability owns. A04's
      // READY_TO_LINK decision already encodes "LEVEL_2 + a current
      // (non-stale/superseded/revoked), verified PrestaShop candidate + no
      // CONFLICT/AMBIGUOUS this turn" (evaluate.ts) - re-deriving those
      // checks in the domain-level authority (authority-policy.ts) would
      // duplicate A04's policy in a layer that has no RuntimeIdentityContext
      // concept by design. Never re-evaluated here beyond this single status
      // check - A04/A05 remain the sole source of this fact.
      if (session.runtimeIdentity.status !== "READY_TO_LINK") {
        return { status: "denied", data: null, errorCode: "not_ready_to_link", retryable: false, evidence: [] };
      }

      const masterCustomerId = session.runtimeIdentity.masterCustomerId;
      const prestashopCustomerId = session.runtimeIdentity.prestashopCustomerId;
      if (!masterCustomerId || !prestashopCustomerId) {
        // Structurally unreachable given READY_TO_LINK's own guarantee
        // (runtimeIdentityContext.ts always sets both alongside that
        // status) - defensive fail-closed, never trusted implicitly.
        return { status: "denied", data: null, errorCode: "identity_incomplete", retryable: false, evidence: [] };
      }

      const consent = session.currentTurnConsent.linkPrestashopIdentity;
      const client = createCustomerServiceClient(getSharedCustomerServicePort());
      const capabilityExecutionId = `${context.correlationId}:link_prestashop_identity`;

      const outcome = await client.linkPrestashopIdentity({
        capabilityExecutionId,
        customerId: masterCustomerId,
        prestashopCustomerId,
        // granted must reflect whether THIS turn actually carries parsed
        // consent evidence - never hardcoded true (same fix already applied
        // to create_customer/link_external_identity).
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

      // PARTE 4/17: no local idempotency/conflict pre-check - Customer
      // Service is the sole authority over the canonical link's uniqueness
      // (PARTE 6). completed/already_linked are both success; conflict is
      // reported as-is, never auto-relinked/overwritten (PARTE 17: an
      // incorrect bridge requires an explicit correction workflow this task
      // does not build). No CustomerOnboardingState transition here - unlike
      // create_customer/link_external_identity, this operation never touches
      // onboarding (READY_TO_LINK only ever occurs once a master is already
      // resolved at LEVEL_2, well past any active onboarding row).
      const result = outcome.result;
      if (result.status === "completed" || result.status === "already_linked") {
        // PARTE 5/13. Customer Service is an external system with no access
        // to main_management - it authorizes and records the link on its
        // own side, but the LOCAL projection (customer_external_identity,
        // the table A05's live LEVEL_3 check actually reads) has no other
        // writer for provider="prestashop" anywhere in this codebase (the
        // A08.1 root-cause finding). CRM writes it here, the same way
        // lib/brain/native-whatsapp/service.ts already writes the
        // provider="whatsapp" case - trusting Customer Service's own
        // echoed-back customerMasterId (already validated numeric by the
        // HTTP adapter), never this turn's unvalidated local master id
        // directly. A write failure never fabricates success: the Gateway
        // status/business outcome stay "completed" (the external operation
        // really did succeed), but a warning is attached so the caller can
        // observe the projection gap - resolveRuntimeIdentityContext's own
        // live check (unmodified) already fails closed to NOT LEVEL_3 on
        // its own next read regardless (PARTE 13: no fabricated LEVEL_3
        // possible from this capability's return value alone).
        const upserted = await upsertExternalIdentity({
          customerId: Number(result.customerMasterId),
          provider: "prestashop",
          identityType: "prestashop_customer_id",
          externalId: prestashopCustomerId,
          normalizedValue: prestashopCustomerId,
          isVerified: true
        });

        // PARTE 14 (same-turn resume). A04's canonicalPsLink/LEVEL_3 branch
        // (evaluate.ts) reads DURABLE EVIDENCE first (source =
        // "customer_external_identity"), not the live table directly - A02's
        // resolver already writes exactly this shape every turn once it
        // discovers a live bridge (applyIdentityEvidence.ts's "Case A"), but
        // only on ITS OWN next pre-plan pass. recordPrestashopBridgeEvidence
        // (identityEvidenceHooks.ts, the SAME trusted-runtime-only boundary
        // recordOnboardingFieldEvidence already uses - never a second
        // evidence engine, and never imported directly here: IDE17 asserts
        // this file never imports the evidence domain at all, so no LLM-
        // reachable path can ever mark evidence VERIFIED) writes the
        // identical row, making the fact available THIS turn so
        // runCommercialWorkInboundCycle.ts's existing bounded re-settle
        // (PARTE 15 of A07, extended above) can observe LEVEL_3 immediately
        // instead of only on the turn after. Fail-safe by construction (see
        // that hook's own module comment) - a write failure there degrades
        // to cross-turn-only resume, never a blocking failure here.
        await recordPrestashopBridgeEvidence({
          conversationId: session.conversationId,
          messageId: session.trustedInbound.messageId,
          correlationId: context.correlationId,
          masterCustomerId: result.customerMasterId,
          prestashopCustomerId,
          sourceRecordRef: result.externalIdentityId,
          observedAt: new Date().toISOString()
        });

        const warnings: string[] = [];
        if (!upserted.ok) warnings.push("prestashop_bridge_local_write_failed");

        return {
          status: "completed",
          data: result as unknown as Record<string, unknown>,
          errorCode: null,
          retryable: false,
          evidence: evidenceOf("customer_service", `link_prestashop_identity ${result.status}.`),
          warnings
        };
      }
      if (result.status === "conflict") {
        return {
          status: "completed",
          data: result as unknown as Record<string, unknown>,
          errorCode: "prestashop_link_conflict",
          retryable: false,
          evidence: evidenceOf("customer_service", "link_prestashop_identity conflict.")
        };
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
  linkExternalIdentityCapability(),
  linkPrestashopIdentityCapability()
];
