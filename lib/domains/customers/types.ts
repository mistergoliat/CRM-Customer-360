import type { ModuleDataMode } from "../runtime/data-source-status";
import type { PlatformOrigin } from "./platform-origin";

export type CustomerListInput = {
  search?: string;
  page?: number;
  pageSize?: number;
};

export type CustomerRecord = {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  platformOrigin: PlatformOrigin;
};

export type CustomerListItem = CustomerRecord & {
  displayName: string;
  identityState: "real" | "partial" | "unavailable" | "error";
  source: string;
  lastActivity: string | null;
  relatedConversations: number;
  relatedCases: number;
  ltv: string | null;
  risk: string | null;
};

export type CustomerPagination = {
  page: number;
  pageSize: number;
  total: number;
};

export type CustomerListMeta = {
  mode: ModuleDataMode;
  source: string;
  warnings: string[];
};

export type CustomerListReadModel = {
  items: CustomerListItem[];
  pagination: CustomerPagination;
  meta: CustomerListMeta;
};

export type CustomerIdentityObservation = {
  source: string;
  table: string;
  matchedBy: string;
  identityType: string | null;
  identityValue: string | null;
  sourceRecordId: string | number | null;
  confidence: string;
  customerKey: string | null;
  notes: string[];
};

export type CustomerSectionState = "real" | "partial" | "fixture" | "disabled" | "unavailable" | "error";

export type CustomerSection = {
  state: CustomerSectionState;
  source: string;
  warnings: string[];
  items: Array<{ label: string; value: string }>;
};

export type CustomerDetailReadModel = {
  customer: CustomerRecord | null;
  identity: {
    state: "real" | "partial" | "fixture" | "disabled" | "unavailable" | "error";
    source: string;
    warnings: string[];
    observations: CustomerIdentityObservation[];
  };
  relatedConversations: {
    state: CustomerSectionState;
    source: string;
    warnings: string[];
    items: Array<{ id: string; label: string; href: string; meta: string }>;
  };
  relatedCases: {
    state: CustomerSectionState;
    source: string;
    warnings: string[];
    items: Array<{ id: string; label: string; href: string; meta: string }>;
  };
  linkedSources: {
    state: CustomerSectionState;
    source: string;
    warnings: string[];
    items: Array<{ label: string; value: string }>;
  };
  sections: {
    ltv: CustomerSection;
    scoring: CustomerSection;
    segment: CustomerSection;
    notes: CustomerSection;
    campaigns: CustomerSection;
  };
  warnings: string[];
  meta: CustomerListMeta;
};

export type CreateCustomerInput = {
  firstname: string;
  lastname: string;
  email: string;
  platformOrigin: PlatformOrigin;
  idempotencyKey?: string | null;
};

export type CreateCustomerResult = {
  customer: CustomerRecord;
  warnings: string[];
  meta: CustomerListMeta;
};
