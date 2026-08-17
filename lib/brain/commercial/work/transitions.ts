import type { CommercialObjectiveStatus, CommercialWorkStatus, CommercialWorkStepStatus } from "./statuses";

const WORK_TRANSITIONS: Record<CommercialWorkStatus, readonly CommercialWorkStatus[]> = {
  ACTIVE: ["WAITING_CUSTOMER", "WAITING_SYSTEM", "COMPLETED", "CANCELLED", "SUPERSEDED", "HANDOFF", "FAILED"],
  WAITING_CUSTOMER: ["ACTIVE", "COMPLETED", "CANCELLED", "SUPERSEDED", "HANDOFF"],
  WAITING_SYSTEM: ["ACTIVE", "COMPLETED", "FAILED", "CANCELLED", "SUPERSEDED", "HANDOFF"],
  COMPLETED: ["SUPERSEDED"],
  CANCELLED: [],
  SUPERSEDED: [],
  HANDOFF: [],
  FAILED: []
};

const OBJECTIVE_TRANSITIONS: Record<CommercialObjectiveStatus, readonly CommercialObjectiveStatus[]> = {
  PENDING: ["READY", "BLOCKED", "WAITING_CUSTOMER", "WAITING_SYSTEM", "COMPLETED", "CANCELLED", "SUPERSEDED", "FAILED"],
  READY: ["IN_PROGRESS", "COMPLETED", "BLOCKED", "WAITING_CUSTOMER", "WAITING_SYSTEM", "FAILED", "CANCELLED", "SUPERSEDED"],
  IN_PROGRESS: ["COMPLETED", "WAITING_SYSTEM", "FAILED", "CANCELLED", "SUPERSEDED"],
  COMPLETED: ["SUPERSEDED"],
  WAITING_CUSTOMER: ["READY", "COMPLETED", "CANCELLED", "SUPERSEDED", "FAILED"],
  WAITING_SYSTEM: ["READY", "COMPLETED", "FAILED", "CANCELLED", "SUPERSEDED"],
  BLOCKED: ["READY", "WAITING_CUSTOMER", "WAITING_SYSTEM", "FAILED", "CANCELLED", "SUPERSEDED"],
  CANCELLED: [],
  SUPERSEDED: [],
  FAILED: []
};

const STEP_TRANSITIONS: Record<CommercialWorkStepStatus, readonly CommercialWorkStepStatus[]> = {
  PENDING: ["READY", "RUNNING", "BLOCKED", "WAITING_CUSTOMER", "WAITING_SYSTEM", "CANCELLED", "SUPERSEDED", "FAILED"],
  READY: ["RUNNING", "COMPLETED", "WAITING_SYSTEM", "RETRY_SCHEDULED", "FAILED", "CANCELLED", "SUPERSEDED", "BLOCKED"],
  RUNNING: ["COMPLETED", "WAITING_SYSTEM", "RETRY_SCHEDULED", "WAITING_CUSTOMER", "FAILED", "CANCELLED", "SUPERSEDED", "BLOCKED"],
  COMPLETED: ["SUPERSEDED"],
  BLOCKED: ["READY", "WAITING_CUSTOMER", "WAITING_SYSTEM", "CANCELLED", "SUPERSEDED", "FAILED"],
  WAITING_CUSTOMER: ["READY", "CANCELLED", "SUPERSEDED", "FAILED"],
  WAITING_SYSTEM: ["READY", "RETRY_SCHEDULED", "FAILED", "CANCELLED", "SUPERSEDED"],
  RETRY_SCHEDULED: ["RUNNING", "READY", "FAILED", "CANCELLED", "SUPERSEDED"],
  CANCELLED: [],
  SUPERSEDED: [],
  FAILED: []
};

function canTransition<T extends string>(map: Record<T, readonly T[]>, from: T, to: T): boolean {
  return from === to || (map[from] ?? []).includes(to);
}

export function canTransitionCommercialWorkStatus(from: CommercialWorkStatus, to: CommercialWorkStatus): boolean {
  return canTransition(WORK_TRANSITIONS, from, to);
}

export function canTransitionObjectiveStatus(from: CommercialObjectiveStatus, to: CommercialObjectiveStatus): boolean {
  return canTransition(OBJECTIVE_TRANSITIONS, from, to);
}

export function canTransitionStepStatus(from: CommercialWorkStepStatus, to: CommercialWorkStepStatus): boolean {
  return canTransition(STEP_TRANSITIONS, from, to);
}

export function describeAllowedCommercialWorkTransitions(status: CommercialWorkStatus): readonly CommercialWorkStatus[] {
  return WORK_TRANSITIONS[status];
}

export function describeAllowedObjectiveTransitions(status: CommercialObjectiveStatus): readonly CommercialObjectiveStatus[] {
  return OBJECTIVE_TRANSITIONS[status];
}

export function describeAllowedStepTransitions(status: CommercialWorkStepStatus): readonly CommercialWorkStepStatus[] {
  return STEP_TRANSITIONS[status];
}
