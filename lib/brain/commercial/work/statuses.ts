export const COMMERCIAL_WORK_STATUSES = [
  "ACTIVE",
  "WAITING_CUSTOMER",
  "WAITING_SYSTEM",
  "COMPLETED",
  "CANCELLED",
  "SUPERSEDED",
  "HANDOFF",
  "FAILED"
] as const;

export type CommercialWorkStatus = (typeof COMMERCIAL_WORK_STATUSES)[number];

export const COMMERCIAL_OBJECTIVE_STATUSES = [
  "PENDING",
  "READY",
  "IN_PROGRESS",
  "COMPLETED",
  "WAITING_CUSTOMER",
  "WAITING_SYSTEM",
  "BLOCKED",
  "CANCELLED",
  "SUPERSEDED",
  "FAILED"
] as const;

export type CommercialObjectiveStatus = (typeof COMMERCIAL_OBJECTIVE_STATUSES)[number];

export const COMMERCIAL_WORK_STEP_STATUSES = [
  "PENDING",
  "READY",
  "RUNNING",
  "COMPLETED",
  "BLOCKED",
  "WAITING_CUSTOMER",
  "WAITING_SYSTEM",
  "RETRY_SCHEDULED",
  "CANCELLED",
  "SUPERSEDED",
  "FAILED"
] as const;

export type CommercialWorkStepStatus = (typeof COMMERCIAL_WORK_STEP_STATUSES)[number];
