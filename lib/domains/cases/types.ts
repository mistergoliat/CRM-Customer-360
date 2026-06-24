import type { TimelineEntry } from "@/lib/cases";
import type { ModuleDataMode } from "../runtime/data-source-status";

export type CaseListInput = {
  q?: string;
  status?: string;
  department?: string;
  priority?: string;
  requiresHuman?: string;
  page?: number;
};

export type CaseListItem = {
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
  updatedAt: string | null;
  source: string;
  href: string;
  customerResolutionStatus?: "unresolved" | "found" | "linked" | "conflict" | "unknown";
  customerId?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  customerPlatformOrigin?: string | null;
};

export type CaseListReadModel = {
  items: CaseListItem[];
  pagination: { page: number; pageSize: number; total: number };
  meta: { mode: ModuleDataMode; source: string; warnings: string[] };
};

export type CaseTimelineReadModel = {
  caseId: string;
  source: string;
  rows: TimelineEntry[];
  warnings: string[];
};

export type CaseDetailReadModel = {
  caseRow: Record<string, unknown> | null;
  timeline: CaseTimelineReadModel;
  customerResolutionStatus: "unresolved" | "found" | "linked" | "conflict" | "unknown";
  customerId: string | null;
  customerEmail: string | null;
  customerName: string | null;
  customerPlatformOrigin: string | null;
  meta: { mode: ModuleDataMode; source: string; warnings: string[] };
  warnings: string[];
};
