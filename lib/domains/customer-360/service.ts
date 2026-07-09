import type { Customer360LoadResult, Customer360Metadata, Customer360QueryService, Customer360QueryServiceDependencies, Customer360Snapshot, CustomerLifecycleSection } from "./types";
import { createLifecycleEventAssembler } from "./assembler";
import { createLocalAddressBookAdapter, createLocalCustomerProfileAdapter } from "./local-adapter";

function latestIso(...values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function buildSnapshotMetadata(input: {
  source: string;
  warnings: string[];
  freshness: Customer360Metadata["freshness"];
  completeness: Customer360Metadata["completeness"];
}): Customer360Metadata {
  return {
    source: input.source,
    freshness: input.freshness,
    completeness: input.completeness,
    warnings: [...new Set(input.warnings)]
  };
}

function mergeSectionWarnings(...warnings: Array<string[] | undefined>) {
  return [...new Set(warnings.flatMap((item) => item ?? []))];
}

function computeFreshness(input: { source: string; now: Date; lastActivityAt: string | null }): Customer360Metadata["freshness"] {
  if (!input.lastActivityAt) {
    return {
      source: input.source,
      lastActivityAt: null,
      lastRefreshedAt: input.now.toISOString(),
      state: "unknown"
    };
  }

  const ageMs = input.now.getTime() - Date.parse(input.lastActivityAt);
  return {
    source: input.source,
    lastActivityAt: input.lastActivityAt,
    lastRefreshedAt: input.now.toISOString(),
    state: Number.isFinite(ageMs) && ageMs <= 1000 * 60 * 60 * 24 * 7 ? "fresh" : "stale"
  };
}

/**
 * loadCustomerProfile returning a null profile is ambiguous by itself
 * (Customer360SectionState reuses "unavailable" for both a clean "no such
 * row" and a source failure). createLocalCustomerProfileAdapter always adds
 * a "customer_not_found" marker to warnings when the row lookup came back
 * empty; any OTHER warning alongside it (missing table, query error) means
 * the source itself failed. Conservatively: only exactly that marker, alone,
 * counts as a genuine not_found - anything else, or its absence, is
 * unavailable (a failure is never optimistically read as "no such customer").
 */
function classifyMissingCustomerProfile(warnings: string[]): "not_found" | "unavailable" {
  const hasNotFoundMarker = warnings.includes("customer_not_found");
  const hasOtherWarnings = warnings.some((warning) => warning !== "customer_not_found");
  return hasNotFoundMarker && !hasOtherWarnings ? "not_found" : "unavailable";
}

export function createCustomer360QueryService(dependencies: Customer360QueryServiceDependencies = {}): Customer360QueryService {
  const profilePort = dependencies.profilePort ?? createLocalCustomerProfileAdapter();
  const addressBookPort = dependencies.addressBookPort ?? createLocalAddressBookAdapter();
  const lifecycleEventAssembler = dependencies.lifecycleEventAssembler ?? createLifecycleEventAssembler();
  const now = dependencies.now ?? (() => new Date());

  async function loadByCustomerId(customerId: string): Promise<Customer360LoadResult> {
      const currentTime = now();
      const [profileResult, addressResult] = await Promise.all([profilePort.loadCustomerProfile(customerId), addressBookPort.loadAddressBook(customerId)]);
      if (!profileResult.profile) {
        const warnings = [...new Set(profileResult.warnings)];
        return { status: classifyMissingCustomerProfile(warnings), snapshot: null, warnings };
      }

      const addressSection = addressResult.addresses ?? {
        state: addressResult.state,
        source: addressResult.source,
        lastUpdatedAt: null,
        warnings: addressResult.warnings,
        total: 0,
        items: []
      };

      const lifecycle: CustomerLifecycleSection = lifecycleEventAssembler({
        customerId,
        profile: profileResult.profile,
        addresses: addressSection,
        now: currentTime
      });

      const sections = {
        ...profileResult.profile.sections,
        addresses: addressSection
      };

      const lastActivityAt = latestIso(
        profileResult.profile.freshness.lastActivityAt,
        addressSection.lastUpdatedAt,
        lifecycle.lastUpdatedAt
      );
      const freshness = computeFreshness({
        source: "local_native_mariadb",
        now: currentTime,
        lastActivityAt
      });
      const profileCompleteness = profileResult.profile.completeness;
      const addressAvailable = addressSection.state === "real" || addressSection.state === "partial";
      const completeness = {
        state:
          profileCompleteness.state === "complete"
            ? addressAvailable
              ? "complete"
              : "partial"
            : profileCompleteness.state === "insufficient"
              ? addressAvailable
                ? "minimal"
                : "insufficient"
              : profileCompleteness.state === "minimal"
                ? addressAvailable
                  ? "minimal"
                  : "partial"
                : "partial",
        score: Math.min(100, profileCompleteness.score + (addressAvailable ? 10 : 0)),
        missing: [...new Set([...profileCompleteness.missing, ...(addressAvailable ? [] : ["addresses"])])]
      } as Customer360Metadata["completeness"];

      const metadata = buildSnapshotMetadata({
        source: "local_native_mariadb",
        warnings: mergeSectionWarnings(profileResult.warnings, profileResult.profile.warnings, addressSection.warnings, lifecycle.warnings),
        freshness,
        completeness
      });

      const snapshot: Customer360Snapshot = {
        contractName: "Customer360Snapshot",
        schemaVersion: "1.0.0",
        snapshotVersion: 1,
        customerId,
        identity: profileResult.profile.identity,
        profile: profileResult.profile.profile,
        sections,
        lifecycle,
        metadata
      };

      return { status: "found", snapshot, warnings: metadata.warnings };
  }

  return {
    loadByCustomerId,
    async getByCustomerId(customerId: string): Promise<Customer360Snapshot | null> {
      const result = await loadByCustomerId(customerId);
      return result.status === "found" ? result.snapshot : null;
    }
  };
}

const defaultService = createCustomer360QueryService();

export async function getCustomer360Snapshot(customerId: string) {
  return defaultService.getByCustomerId(customerId);
}
