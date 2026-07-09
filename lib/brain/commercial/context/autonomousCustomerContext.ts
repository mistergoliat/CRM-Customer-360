import type { Customer360Sections, Customer360Snapshot } from "@/lib/domains/customer-360";

/**
 * Reduced, allowlisted projection of Customer360Snapshot for the autonomous
 * cycle (ACS-R1-04-T05). Built field-by-field on purpose - never a denylist
 * sanitizer - so a new field added to Customer360Snapshot later can never
 * leak here silently. Never includes: full email/phone, wa_id, linked
 * identities, customerKey, addresses, order references, invoice numbers,
 * message bodies/previews, provider message ids, draft/final messages,
 * lifecycle metadata, or the snapshot itself.
 */
export const AUTONOMOUS_CUSTOMER_CONTEXT_CONTRACT_NAME = "AutonomousCustomerContext" as const;
export const AUTONOMOUS_CUSTOMER_CONTEXT_SCHEMA_VERSION = "1.0.0" as const;

export type AutonomousCustomerContext = {
  contractName: typeof AUTONOMOUS_CUSTOMER_CONTEXT_CONTRACT_NAME;
  schemaVersion: typeof AUTONOMOUS_CUSTOMER_CONTEXT_SCHEMA_VERSION;

  profile: {
    displayName: string | null;
    emailAvailable: boolean;
  };

  relationshipSummary: {
    conversationCount: number;
    opportunityCount: number;
    quoteCount: number;
    orderCount: number;
    lastActivityAt: string | null;
  };

  commercialHistory: {
    recentOpportunities: Array<{
      status: string;
      stage: string | null;
      primaryIntent: string;
      priority: string;
      temperature: string;
      nextActionType: string | null;
      nextActionDueAt: string | null;
    }>;

    recentNeedProfiles: Array<{
      useCase: string | null;
      customerType: string | null;
      decisionReadiness: string | null;
      purchaseUrgency: string | null;
      budgetMin: string | null;
      budgetMax: string | null;
      missingInformation: string[];
    }>;

    recentQuotes: Array<{
      status: string;
      createdAt: string;
      sentAt: string | null;
      decidedAt: string | null;
      expiryAt: string | null;
    }>;
  };

  dataQuality: {
    freshness: "fresh" | "stale" | "unknown";
    completeness: "complete" | "partial" | "minimal" | "insufficient";
    completenessScore: number;
    unavailableSections: string[];
  };
};

const MAX_HISTORY_ITEMS = 3;

const SECTION_NAMES = [
  "conversations",
  "messages",
  "opportunities",
  "profiles",
  "actions",
  "outcomes",
  "quotes",
  "orders",
  "addresses",
  "commercialEvents"
] as const satisfies readonly (keyof Customer360Sections)[];

function compareIsoDesc(left: string | null, right: string | null): number {
  const leftTime = left ? Date.parse(left) : Number.NEGATIVE_INFINITY;
  const rightTime = right ? Date.parse(right) : Number.NEGATIVE_INFINITY;
  return rightTime - leftTime;
}

function collectUnavailableSections(sections: Customer360Sections): string[] {
  return SECTION_NAMES.filter((name) => {
    const state = sections[name].state;
    return state === "unavailable" || state === "error";
  });
}

/** Pure projection - never mutates the source snapshot (arrays are copied before sorting/slicing). */
export function projectAutonomousCustomerContext(snapshot: Customer360Snapshot): AutonomousCustomerContext {
  const recentOpportunities = [...snapshot.sections.opportunities.items]
    .sort((left, right) => compareIsoDesc(left.lastActivityAt, right.lastActivityAt) || left.opportunityId.localeCompare(right.opportunityId))
    .slice(0, MAX_HISTORY_ITEMS)
    .map((item) => ({
      status: item.status,
      stage: item.stage,
      primaryIntent: item.primaryIntent,
      priority: item.priority,
      temperature: item.temperature,
      nextActionType: item.nextActionType,
      nextActionDueAt: item.nextActionDueAt
    }));

  const recentNeedProfiles = [...snapshot.sections.profiles.items]
    .sort((left, right) => compareIsoDesc(left.lastUpdatedAt, right.lastUpdatedAt) || left.profileId.localeCompare(right.profileId))
    .slice(0, MAX_HISTORY_ITEMS)
    .map((item) => ({
      useCase: item.useCase,
      customerType: item.customerType,
      decisionReadiness: item.decisionReadiness,
      purchaseUrgency: item.purchaseUrgency,
      budgetMin: item.budgetMin,
      budgetMax: item.budgetMax,
      missingInformation: [...item.missingInformation]
    }));

  const recentQuotes = [...snapshot.sections.quotes.items]
    .sort((left, right) => compareIsoDesc(left.createdAt, right.createdAt) || left.quoteId.localeCompare(right.quoteId))
    .slice(0, MAX_HISTORY_ITEMS)
    .map((item) => ({
      status: item.status,
      createdAt: item.createdAt,
      sentAt: item.sentAt,
      decidedAt: item.decidedAt,
      expiryAt: item.expiryAt
    }));

  return {
    contractName: AUTONOMOUS_CUSTOMER_CONTEXT_CONTRACT_NAME,
    schemaVersion: AUTONOMOUS_CUSTOMER_CONTEXT_SCHEMA_VERSION,
    profile: {
      displayName: snapshot.identity.displayName,
      emailAvailable: Boolean(snapshot.identity.email)
    },
    relationshipSummary: {
      conversationCount: snapshot.profile.counts.conversations,
      opportunityCount: snapshot.profile.counts.opportunities,
      quoteCount: snapshot.profile.counts.quotes,
      orderCount: snapshot.profile.counts.orders,
      lastActivityAt: snapshot.profile.lastActivityAt
    },
    commercialHistory: {
      recentOpportunities,
      recentNeedProfiles,
      recentQuotes
    },
    dataQuality: {
      freshness: snapshot.metadata.freshness.state,
      completeness: snapshot.metadata.completeness.state,
      completenessScore: snapshot.metadata.completeness.score,
      unavailableSections: collectUnavailableSections(snapshot.sections)
    }
  };
}
