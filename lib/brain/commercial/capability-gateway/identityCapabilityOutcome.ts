import type { CreateCustomerResult, LinkExternalIdentityResult, ResolveCustomerResult } from "@/lib/domains/customer-service";
import type { CapabilityGatewayExecutionStatus } from "./types";

// ACS-R1-04-T07. Separates the Gateway's technical execution status from the
// identity domain's actual business result (release spec section on T07,
// "Separar outcome tecnico y outcome de negocio"): create_customer/
// link_external_identity report a conflict as Gateway status "completed" (the
// call itself succeeded, no retry needed) - the business outcome is
// "conflict", not success. Every switch below is exhaustive over its real
// result union: a future variant added to ResolveCustomerResult/
// CreateCustomerResult/LinkExternalIdentityResult/CapabilityGatewayExecutionStatus
// fails to compile here until classified.

export type IdentityCapabilityName = "resolve_customer" | "create_customer" | "link_external_identity";

function assertNever(value: never): never {
  throw new Error(`identity_capability_outcome_unclassified:${JSON.stringify(value)}`);
}

function mapResolveCustomerOutcome(result: ResolveCustomerResult): string {
  switch (result.status) {
    case "resolved":
      return "resolved";
    case "no_match":
      return "no_match";
    case "conflict":
      return "conflict";
    case "invalid_input":
      return "invalid_input";
    case "temporarily_unavailable":
      return "temporarily_unavailable";
    default:
      return assertNever(result);
  }
}

function mapCreateCustomerOutcome(result: CreateCustomerResult): string {
  switch (result.status) {
    case "created":
      return "created";
    case "matched_existing":
      return "matched_existing";
    case "missing_information":
      return "missing_information";
    case "conflict":
      return "conflict";
    case "denied":
      return "denied";
    case "invalid_input":
      return "invalid_input";
    case "temporarily_unavailable":
      return "temporarily_unavailable";
    case "failed":
      return "failed";
    default:
      return assertNever(result);
  }
}

function mapLinkExternalIdentityOutcome(result: LinkExternalIdentityResult): string {
  switch (result.status) {
    case "completed":
      return "completed";
    case "already_linked":
      return "already_linked";
    case "conflict":
      return "conflict";
    case "denied":
      return "denied";
    case "invalid_input":
      return "invalid_input";
    case "temporarily_unavailable":
      return "temporarily_unavailable";
    case "failed":
      return "failed";
    default:
      return assertNever(result);
  }
}

/**
 * Fallback used whenever there is no richer domain result to inspect (e.g. a
 * policy denial or missing_information reported before Customer Service is
 * even called). Exhaustive over CapabilityGatewayExecutionStatus.
 */
function mapGatewayStatusFallback(status: CapabilityGatewayExecutionStatus): string {
  switch (status) {
    case "completed":
      return "completed";
    case "missing_information":
      return "missing_information";
    case "denied":
      return "denied";
    case "requires_approval":
      return "requires_approval";
    case "temporarily_blocked":
      return "temporarily_unavailable";
    case "invalid_arguments":
      return "invalid_input";
    case "failed":
      return "failed";
    default:
      return assertNever(status);
  }
}

/**
 * businessOutcome for the customer_identity_capability_outcome_recorded event
 * (ACS-R1-04-T07). Never throws - a genuinely unclassifiable shape (should be
 * unreachable given the exhaustive switches above) degrades to "unclassified"
 * rather than breaking the caller; this function is descriptive audit only,
 * never authoritative.
 */
export function deriveIdentityCapabilityBusinessOutcome(
  capability: IdentityCapabilityName,
  gatewayStatus: CapabilityGatewayExecutionStatus,
  data: Record<string, unknown> | null
): string {
  try {
    if (gatewayStatus === "completed" && data) {
      if (capability === "resolve_customer") {
        const nested = (data as { result?: { status?: unknown } }).result;
        if (nested && typeof nested.status === "string") {
          return mapResolveCustomerOutcome(nested as ResolveCustomerResult);
        }
      } else {
        const status = (data as { status?: unknown }).status;
        if (typeof status === "string") {
          return capability === "create_customer"
            ? mapCreateCustomerOutcome(data as unknown as CreateCustomerResult)
            : mapLinkExternalIdentityOutcome(data as unknown as LinkExternalIdentityResult);
        }
      }
    }
    return mapGatewayStatusFallback(gatewayStatus);
  } catch {
    return "unclassified";
  }
}
