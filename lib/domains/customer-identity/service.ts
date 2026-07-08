import { normalizePhoneChile, normalizeWaId } from "@/lib/customer-identity/normalize";
import { createLocalCustomerIdentityAdapter } from "./local-adapter";
import type {
  CustomerIdentityConflict,
  CustomerIdentityResolutionService,
  CustomerIdentityResolutionServiceDependencies,
  ResolveCustomerIdentityInput,
  ResolveCustomerIdentityResult
} from "./types";

function uniqueIds(values: string[]) {
  return Array.from(new Set(values));
}

function unresolved(
  status: "identification_required" | "conflict" | "temporarily_unavailable",
  input: { conflicts?: CustomerIdentityConflict[]; warnings?: string[] }
): ResolveCustomerIdentityResult {
  return {
    status,
    customerId: null,
    matchedBy: null,
    confidence: "insufficient",
    conflicts: input.conflicts ?? [],
    warnings: input.warnings ?? []
  };
}

// Order of resolution (docs/data/customer-onboarding-identity-contract.md, section 5):
// 1. exact external identity (provider + wa_id)
// 2. normalized phone
// A single external match wins unless phone disagrees; phone alone only
// resolves when it points to exactly one customer. Any other combination is
// a conflict - this service never guesses.
export function createCustomerIdentityResolutionService(
  dependencies: CustomerIdentityResolutionServiceDependencies = {}
): CustomerIdentityResolutionService {
  const port = dependencies.port ?? createLocalCustomerIdentityAdapter();

  return {
    async resolveIdentity(input: ResolveCustomerIdentityInput): Promise<ResolveCustomerIdentityResult> {
      const normalizedExternalId = normalizeWaId(input.externalId);
      if (!normalizedExternalId) {
        return unresolved("identification_required", { warnings: ["invalid_external_id"] });
      }

      const externalLookup = await port.findCustomerByExternalIdentity({
        provider: input.channel,
        externalId: normalizedExternalId
      });
      if (!externalLookup.ok) {
        return unresolved("temporarily_unavailable", { warnings: [externalLookup.error] });
      }

      const warnings: string[] = [];
      const normalizedPhone = normalizePhoneChile(input.phoneNumber);
      if (input.phoneNumber && !normalizedPhone) {
        warnings.push("phone_number_not_normalizable");
      }

      let phoneCandidates: string[] = [];
      if (normalizedPhone) {
        const phoneLookup = await port.findCustomersByNormalizedPhone({
          provider: input.channel,
          normalizedPhone
        });
        if (!phoneLookup.ok) {
          return unresolved("temporarily_unavailable", { warnings: [...warnings, phoneLookup.error] });
        }
        phoneCandidates = phoneLookup.candidateCustomerIds;
      }

      const externalCandidates = externalLookup.candidateCustomerIds;

      if (externalCandidates.length === 1) {
        const customerId = externalCandidates[0];
        const phoneAgrees = phoneCandidates.length === 0 || (phoneCandidates.length === 1 && phoneCandidates[0] === customerId);
        if (phoneAgrees) {
          return { status: "identified", customerId, matchedBy: "external_identity", confidence: "verified", conflicts: [], warnings };
        }

        const type = phoneCandidates.length > 1 ? "phone_ambiguous" : "external_identity_vs_phone";
        return unresolved("conflict", {
          conflicts: [{ type, candidateCustomerIds: uniqueIds([customerId, ...phoneCandidates]) }],
          warnings
        });
      }

      if (phoneCandidates.length === 1) {
        return { status: "identified", customerId: phoneCandidates[0], matchedBy: "phone", confidence: "strong", conflicts: [], warnings };
      }

      if (phoneCandidates.length > 1) {
        return unresolved("conflict", {
          conflicts: [{ type: "phone_ambiguous", candidateCustomerIds: uniqueIds(phoneCandidates) }],
          warnings
        });
      }

      return unresolved("identification_required", { warnings });
    }
  };
}

const defaultService = createCustomerIdentityResolutionService();

export async function resolveCustomerIdentity(input: ResolveCustomerIdentityInput): Promise<ResolveCustomerIdentityResult> {
  return defaultService.resolveIdentity(input);
}
