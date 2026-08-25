import { normalizePhoneChile, normalizeWaId } from "@/lib/customer-identity/normalize";
import { normalizeCustomerEmail } from "@/lib/domains/customers/email";
import { isValidEmail } from "@/lib/domains/customers/validation";
import { createLocalCustomerIdentityAdapter } from "./local-adapter";
import { applyIdentityEvidence, classifyPrestashopCandidates, type PrestashopBridgeLookup } from "./evidence";
import type {
  CustomerIdentityConflict,
  CustomerIdentityPort,
  CustomerIdentityResolutionService,
  CustomerIdentityResolutionServiceDependencies,
  ResolveCustomerIdentityInput,
  ResolveCustomerIdentityResult
} from "./types";

function uniqueIds(values: string[]) {
  return Array.from(new Set(values));
}

type BaseResult = Omit<ResolveCustomerIdentityResult, "detail">;

function unresolved(
  status: "identification_required" | "conflict" | "temporarily_unavailable" | "invalid_input",
  input: { conflicts?: CustomerIdentityConflict[]; warnings?: string[] }
): BaseResult {
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
// a conflict - this service never guesses. Unchanged since ACS-R1-04-T02
// (ID-R2-A02 PARTE 7: "Conservar resolver actual").
async function resolveWaPhone(port: CustomerIdentityPort, input: ResolveCustomerIdentityInput): Promise<BaseResult> {
  const normalizedExternalId = normalizeWaId(input.externalId);
  if (!normalizedExternalId) {
    return unresolved("invalid_input", { warnings: ["invalid_external_id"] });
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
    const phoneLookup = await port.findCustomersByNormalizedPhone({ normalizedPhone });
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

export function createCustomerIdentityResolutionService(
  dependencies: CustomerIdentityResolutionServiceDependencies = {}
): CustomerIdentityResolutionService {
  const port = dependencies.port ?? createLocalCustomerIdentityAdapter();
  const now = dependencies.now ?? (() => new Date());

  return {
    async resolveIdentity(input: ResolveCustomerIdentityInput): Promise<ResolveCustomerIdentityResult> {
      const base = await resolveWaPhone(port, input);

      // ID-R2-A02: candidate discovery by email/order reference. Skipped
      // entirely when the wa_id/phone lookup itself already failed
      // technically or the input was invalid - nothing to add, and no point
      // spending two more queries (PARTE 18).
      let emailCandidateIds: string[] | null = null;
      let emailInvalid = false;
      let emailQueryFailed = false;
      let orderCandidateIds: string[] | null = null;
      let orderQueryFailed = false;

      if (base.status !== "temporarily_unavailable" && base.status !== "invalid_input") {
        const normalizedEmail = normalizeCustomerEmail(input.email ?? null);
        if (input.email && input.email.trim()) {
          if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
            emailInvalid = true;
          } else {
            const lookup = await port.findPrestashopCustomerIdsByEmail({ normalizedEmail });
            if (!lookup.ok) emailQueryFailed = true;
            else emailCandidateIds = lookup.candidatePrestashopCustomerIds;
          }
        }

        const orderReference = input.orderReference?.trim();
        if (orderReference) {
          const lookup = await port.findPrestashopCustomerIdsByOrderReference({ orderReference });
          if (!lookup.ok) orderQueryFailed = true;
          else orderCandidateIds = lookup.candidatePrestashopCustomerIds;
        }
      }

      const prestashopOutcome = classifyPrestashopCandidates({
        emailInvalid,
        emailQueryFailed,
        orderQueryFailed,
        emailCandidateIds,
        orderCandidateIds
      });

      // PrestaShop -> master bridge (PARTE 6): only checked once a single
      // PrestaShop customer id actually emerged from email/order evidence.
      // Reuses the existing, provider-agnostic external identity lookup -
      // no new port method needed for this half of the resolver.
      let bridge: PrestashopBridgeLookup = { checked: false };
      if (prestashopOutcome.kind === "resolved") {
        const linkLookup = await port.findCustomerByExternalIdentity({
          provider: "prestashop",
          externalId: prestashopOutcome.prestashopCustomerId
        });
        bridge = linkLookup.ok
          ? { checked: true, ok: true, masterCustomerIds: linkLookup.candidateCustomerIds }
          : { checked: true, ok: false };
      }

      const outcome = applyIdentityEvidence({ base, prestashop: prestashopOutcome, bridge, observedAt: now().toISOString() });

      if (!outcome.overrideToConflict && !outcome.overrideToSystemFailure) {
        return { ...base, warnings: [...base.warnings, ...outcome.extraWarnings], detail: outcome.detail };
      }

      if (outcome.overrideToConflict) {
        return {
          status: "conflict",
          customerId: null,
          matchedBy: null,
          confidence: "insufficient",
          conflicts: outcome.conflictOverride ? [outcome.conflictOverride] : base.conflicts,
          warnings: [...base.warnings, ...outcome.extraWarnings],
          detail: outcome.detail
        };
      }

      return {
        status: "temporarily_unavailable",
        customerId: null,
        matchedBy: null,
        confidence: "insufficient",
        conflicts: base.conflicts,
        warnings: [...base.warnings, ...outcome.extraWarnings],
        detail: outcome.detail
      };
    }
  };
}

const defaultService = createCustomerIdentityResolutionService();

export async function resolveCustomerIdentity(input: ResolveCustomerIdentityInput): Promise<ResolveCustomerIdentityResult> {
  return defaultService.resolveIdentity(input);
}
