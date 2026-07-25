import type { FollowUpCriticalSignal, FollowUpSummaryRange, FollowUpStatus } from "./constants";

export type FollowUpReason = { type: "cancel" | "failure" | null; code: string | null; label: string };

export type FollowUpConfigurationSnapshot = {
  source: string | null;
  recordId: number | null;
  version: number | null;
  hash: string | null;
};

export type FollowUpListItem = {
  actionId: string;
  actionIdShort: string;
  status: string;
  statusLabel: string;
  criticalSignals: FollowUpCriticalSignal[];
  opportunityId: number | null;
  opportunityKey: string | null;
  conversationCaseId: number | null;
  waIdMasked: string | null;
  attemptNumber: number;
  maxAttempts: number;
  scheduledFor: string | null;
  reason: FollowUpReason;
  configuration: { source: string | null; version: number | null };
  updatedAt: string | null;
};

export type FollowUpListReadModel = {
  items: FollowUpListItem[];
  pagination: { page: number; limit: number; total: number };
  warnings: string[];
};

export type FollowUpSummary = {
  range: FollowUpSummaryRange;
  planned: number;
  plannedOverdue: number;
  executing: number;
  executingStale: number;
  executed: number;
  cancelled: number;
  failed: number;
  blocked: number;
  requiresReview: number;
  missingSchedule: number;
  missingConfiguration: number;
};

export type FollowUpSummaryReadModel = {
  summary: FollowUpSummary;
  warnings: string[];
};

export type FollowUpOutboxCorrelation =
  | { kind: "correlated"; outboxMessageId: number; status: string | null; sentAt: string | null }
  | { kind: "none" }
  | { kind: "ambiguous"; candidateCount: number };

export type FollowUpDetail = {
  item: FollowUpListItem;
  timestamps: {
    createdAt: string | null;
    updatedAt: string | null;
    approvedAt: string | null;
    executedAt: string | null;
    cancelledAt: string | null;
  };
  reasons: {
    cancelReason: string | null;
    failureReason: string | null;
    blockReasons: string[];
  };
  configurationSnapshot: FollowUpConfigurationSnapshot;
  opportunity: { id: number; key: string | null; status: string | null; stage: string | null } | null;
  conversation: { id: number; status: string | null; humanOwnerActive: boolean; aiEnabled: boolean } | null;
  optOut: { optedOut: boolean } | null;
  outboxCorrelation: FollowUpOutboxCorrelation;
  technicalHistoryAvailable: false;
  technicalHistoryMessage: string;
};

export type FollowUpDetailReadModel = {
  detail: FollowUpDetail | null;
  warnings: string[];
};

export type { FollowUpCriticalSignal, FollowUpSummaryRange, FollowUpStatus };
