import { normalizeEmail } from "@/lib/customer-identity/normalize";
import type { CustomerIdentityResolutionResult } from "@/lib/customer-identity/types";
import type { CustomerDetailReadModel, CustomerListItem, CustomerListMeta, CustomerListReadModel, CustomerRecord } from "./types";

function buildDisplayName(customer: CustomerRecord) {
  return `${customer.firstname} ${customer.lastname}`.trim();
}

function sectionItems(values: Array<{ label: string; value: string }>) {
  return values;
}

export function buildCustomerListReadModel(input: {
  items: CustomerRecord[];
  page: number;
  pageSize: number;
  total: number;
  mode: CustomerListMeta["mode"];
  source: string;
  warnings?: string[];
}): CustomerListReadModel {
  return {
    items: input.items.map<CustomerListItem>((item) => ({
      ...item,
      displayName: buildDisplayName(item),
      identityState: input.mode === "real" ? "real" : "partial",
      source: input.source,
      lastActivity: null,
      relatedConversations: 0,
      relatedCases: 0,
      ltv: null,
      risk: null
    })),
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total: input.total
    },
    meta: {
      mode: input.mode,
      source: input.source,
      warnings: input.warnings ?? []
    }
  };
}

export function buildCustomerDetailReadModel(input: {
  customer: CustomerRecord | null;
  identityResult: CustomerIdentityResolutionResult | null;
  relatedConversationRows: Array<{ id: string; label: string; href: string; meta: string }>;
  relatedCaseRows: Array<{ id: string; label: string; href: string; meta: string }>;
  warnings?: string[];
  mode: CustomerListMeta["mode"];
  source: string;
}): CustomerDetailReadModel {
  const identityResult = input.identityResult;
  const customerEmail = input.customer?.email ?? null;
  return {
    customer: input.customer,
    identity: {
      state: identityResult ? (identityResult.resolution.status === "conflict_needs_review" ? "error" : identityResult.resolution.status === "not_enough_identity" ? "unavailable" : "real") : "unavailable",
      source: identityResult?.metadata.source ?? input.source,
      warnings: identityResult?.warnings ?? [],
      observations: identityResult?.sourceMatches.map((match) => ({
        source: match.source,
        table: match.source,
        matchedBy: match.matchedBy,
        identityType: match.identityType,
        identityValue: match.identityValue,
        sourceRecordId: match.sourceRecordId,
        confidence: match.confidence,
        customerKey: match.customerKey,
        notes: match.notes
      })) ?? []
    },
    relatedConversations: {
      state: input.relatedConversationRows.length > 0 ? "real" : "partial",
      source: "legacy_n8n",
      warnings: input.relatedConversationRows.length > 0 ? [] : ["no_related_conversations"],
      items: input.relatedConversationRows
    },
    relatedCases: {
      state: input.relatedCaseRows.length > 0 ? "real" : "partial",
      source: "legacy_n8n",
      warnings: input.relatedCaseRows.length > 0 ? [] : ["no_related_cases"],
      items: input.relatedCaseRows
    },
      linkedSources: {
      state: identityResult && identityResult.sourceMatches.length > 0 ? "real" : "partial",
      source: identityResult?.metadata.source ?? input.source,
      warnings: identityResult?.warnings ?? [],
      items: sectionItems([
        { label: "master_customer", value: input.customer ? input.customer.email : customerEmail ?? "No disponible" },
        { label: "Plataforma de origen", value: input.customer?.platformOrigin ?? "unknown" },
        { label: "identity_matches", value: String(identityResult?.sourceMatches.length ?? 0) }
      ])
    },
    sections: {
      ltv: {
        state: "fixture",
        source: "demo_projection",
        warnings: ["ltv_not_backed"],
        items: sectionItems([{ label: "LTV", value: "Datos de demostración" }])
      },
      scoring: {
        state: "fixture",
        source: "demo_projection",
        warnings: ["scoring_not_backed"],
        items: sectionItems([{ label: "Scoring", value: "Datos no disponibles" }])
      },
      segment: {
        state: "fixture",
        source: "demo_projection",
        warnings: ["segment_not_backed"],
        items: sectionItems([{ label: "Segmento", value: "Parcial" }])
      },
      notes: {
        state: "fixture",
        source: "demo_projection",
        warnings: ["notes_not_backed"],
        items: sectionItems([{ label: "Notas", value: "Datos de demostración" }])
      },
      campaigns: {
        state: "fixture",
        source: "demo_projection",
        warnings: ["campaigns_not_backed"],
        items: sectionItems([{ label: "Campañas", value: "Datos no disponibles" }])
      }
    },
    warnings: input.warnings ?? [],
    meta: {
      mode: input.mode,
      source: input.source,
      warnings: input.warnings ?? []
    }
  };
}

export function toCustomerEmail(value: string) {
  return normalizeEmail(value) ?? value.trim().toLowerCase();
}
