// Service layer for the Customer Service boundary (ACS-R1-04-T04.1).
// Normalizes inputs, evaluates authority, and only then calls the port.
// Not connected to the inbound runtime, the LLM, or the Capability Gateway -
// see index.ts header note. Wiring is ACS-R1-04-T06.
import { randomUUID } from "node:crypto";
import { evaluateCreateCustomerAuthority, evaluateLinkExternalIdentityAuthority, type AuthorityDecisionNotAllowed } from "./authority-policy";
import type { CustomerServicePort } from "./ports";
import type { CreateCustomerCommercialPurpose, CreateCustomerResult, CustomerResolutionEvidence, LinkExternalIdentityResult, ResolveCustomerInput } from "./types";

function nowIso() {
  return new Date().toISOString();
}

function asNonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// customer-service:<operation>:<capabilityExecutionId>. capabilityExecutionId
// is an operational identity owned by the caller (the future Capability
// Gateway execution row, ACS-R1-04-T06) - never a free-form key an agent
// picks (contract section 6 / task section 6).
export function buildCustomerServiceIdempotencyKey(operation: "create" | "link", capabilityExecutionId: string): string {
  return `customer-service:${operation}:${capabilityExecutionId}`;
}

// Public, agent-facing request shapes. Neither carries idempotencyKey - the
// service derives it from capabilityExecutionId, so the caller cannot choose
// it arbitrarily even if it stuffs an extra field into the request object.
export type CreateCustomerServiceRequest = {
  capabilityExecutionId: string;
  firstName: string;
  lastName?: string | null;
  email: string;
  phoneNumber: string;
  origin: { channel: "whatsapp"; externalId: string };
  commercialPurpose: string;
  consent: { createCustomer: boolean; messageId: string; capturedAt: string };
  resolutionEvidence: CustomerResolutionEvidence;
};

export type CreateCustomerOutcome =
  | { stage: "denied_by_policy"; decision: AuthorityDecisionNotAllowed }
  | { stage: "executed"; result: CreateCustomerResult };

export type LinkExternalIdentityServiceRequest = {
  capabilityExecutionId: string;
  customerId: string;
  externalIdentity: { provider: "whatsapp"; externalId: string; normalizedPhone: string };
  // wa_id verified by the current inbound channel context - never taken from
  // message text or chosen by the LLM.
  inboundWaId: string;
  consent: { granted: boolean; messageId: string; capturedAt: string };
  knownConflict?: { conflictCode: string } | null;
};

export type LinkExternalIdentityOutcome =
  | { stage: "denied_by_policy"; decision: AuthorityDecisionNotAllowed }
  | { stage: "executed"; result: LinkExternalIdentityResult };

export type CustomerServiceClient = {
  resolveCustomer(input: ResolveCustomerInput): Promise<CustomerResolutionEvidence>;
  createCustomer(request: CreateCustomerServiceRequest): Promise<CreateCustomerOutcome>;
  linkExternalIdentity(request: LinkExternalIdentityServiceRequest): Promise<LinkExternalIdentityOutcome>;
};

export function createCustomerServiceClient(port: CustomerServicePort): CustomerServiceClient {
  return {
    async resolveCustomer(input) {
      // Wraps the raw port result as-is: a failure or timeout must never be
      // reinterpreted here (contract section 8) - see also
      // evaluateCreateCustomerAuthority, which only trusts this evidence.
      const result = await port.resolveCustomer(input);
      return { source: "customer_service", requestId: randomUUID(), checkedAt: nowIso(), result };
    },

    async createCustomer(request) {
      const firstName = asNonEmptyString(request.firstName);
      const email = asNonEmptyString(request.email);
      const phoneNumber = asNonEmptyString(request.phoneNumber);

      const decision = evaluateCreateCustomerAuthority({
        commercialPurpose: request.commercialPurpose,
        firstName,
        lastName: request.lastName ?? null,
        email,
        phoneNumber,
        consent: request.consent,
        resolutionEvidence: request.resolutionEvidence
      });

      if (decision.status !== "allowed") {
        return { stage: "denied_by_policy", decision };
      }

      // create_customer terminates here - link_external_identity is always a
      // separate, later call (contract invariant, task section 5).
      const result = await port.createCustomer({
        firstName: firstName as string,
        lastName: asNonEmptyString(request.lastName) ?? undefined,
        email: email as string,
        phoneNumber: phoneNumber as string,
        origin: request.origin,
        commercialPurpose: request.commercialPurpose as CreateCustomerCommercialPurpose,
        consent: { createCustomer: true, messageId: request.consent.messageId, capturedAt: request.consent.capturedAt },
        idempotencyKey: buildCustomerServiceIdempotencyKey("create", request.capabilityExecutionId)
      });

      return { stage: "executed", result };
    },

    async linkExternalIdentity(request) {
      const customerId = asNonEmptyString(request.customerId);
      const waId = asNonEmptyString(request.externalIdentity.externalId);
      const inboundWaId = asNonEmptyString(request.inboundWaId);

      const decision = evaluateLinkExternalIdentityAuthority({
        customerId,
        waId,
        inboundWaId,
        consent: request.consent,
        knownConflict: request.knownConflict ?? null
      });

      if (decision.status !== "allowed") {
        return { stage: "denied_by_policy", decision };
      }

      const result = await port.linkExternalIdentity({
        customerId: customerId as string,
        externalIdentity: request.externalIdentity,
        consent: { granted: true, messageId: request.consent.messageId, capturedAt: request.consent.capturedAt },
        idempotencyKey: buildCustomerServiceIdempotencyKey("link", request.capabilityExecutionId)
      });

      return { stage: "executed", result };
    }
  };
}
