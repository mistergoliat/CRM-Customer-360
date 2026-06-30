import type { ModuleDataMode } from "../runtime/data-source-status";
import type { SalesNeedProfile } from "@/lib/brain/commercial/sales-consultative/types";

export type ConversationListInput = {
  page?: number;
  q?: string;
};

export type ConversationListItem = {
  id: string;
  contactName: string | null;
  waId: string | null;
  status: string | null;
  priority: string | null;
  department: string | null;
  serviceCode: string | null;
  requiresHuman: boolean;
  whatsappWindowOpen: boolean;
  lastMessage: string | null;
  lastMessageAt: string | null;
  owner: string | null;
  source: string;
  href: string;
  customerResolutionStatus?: "unresolved" | "found" | "linked" | "conflict" | "unknown";
  customerId?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  customerPlatformOrigin?: string | null;
};

export type ConversationListReadModel = {
  items: ConversationListItem[];
  pagination: { page: number; pageSize: number; total: number };
  meta: { mode: ModuleDataMode; source: string; warnings: string[] };
};

export type ConversationMessage = {
  key: string;
  source: string;
  direction: string;
  body: string;
  occurredAt: string | null;
  status: string | null;
  timelineSource: string;
};

export type ConversationDetailReadModel = {
  conversation: ConversationListItem | null;
  messages: ConversationMessage[];
  customerResolutionStatus: "unresolved" | "found" | "linked" | "conflict" | "unknown";
  customerId: string | null;
  customerEmail: string | null;
  customerName: string | null;
  customerPlatformOrigin: string | null;
  opportunity?: {
    id: string | number | null;
    opportunityKey: string;
    status: string;
    stage: string | null;
    currentSummary: string | null;
    nextActionType: string | null;
    nextActionDueAt: string | null;
    humanOwnerActive: boolean;
    aiBlocked: boolean;
  } | null;
  salesNeedProfile?: SalesNeedProfile | null;
  lastDecision?: {
    id: number;
    decisionId: string;
    nextStatus: string;
    nextStage: string | null;
    rationale: string;
    createdAt: string;
    warnings: string[];
  } | null;
  actions?: Array<{
    id: number;
    actionId: string;
    actionType: string;
    status: string;
    scheduledFor: string | null;
    finalMessage: string | null;
    draftMessage: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  customer: {
    state: "real" | "partial" | "fixture" | "disabled" | "unavailable" | "error";
    source: string;
    warnings: string[];
    summary: string;
  };
  case: {
    state: "real" | "partial" | "fixture" | "disabled" | "unavailable" | "error";
    source: string;
    warnings: string[];
    summary: string;
  };
  dataQuality: {
    status: "valid" | "partial" | "disabled" | "error";
    warnings: string[];
    source: string;
  };
  warnings: string[];
  meta: { mode: ModuleDataMode; source: string; warnings: string[] };
};
