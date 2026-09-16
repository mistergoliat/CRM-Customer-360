import type { CommercialProposalV1 } from "../../commercial-proposal/types";
import type { CommercialWorkStatus } from "../statuses";
import type { CommercialObjective } from "../types";
import type { CommercialObjectiveReconciliationDecision } from "./types";

/**
 * SALES-AGENT-R3-P5.
 *
 * Pure deterministic reconciliation: (CommercialProposalV1, current active
 * objective, current work status) -> one CommercialObjectiveReconciliationDecision.
 * No DB read, no DB write, no LLM call, no capability execution - the caller
 * (applyCommercialObjectiveReconciliation.ts) is the only place a decision
 * ever becomes a durable mutation.
 *
 * Deliberately NOT built on top of reconciliation.ts's
 * reconcileCommercialTrigger/reconcileCommercialObjectives - those encode
 * R2's own semantic seeding/supersession-family model
 * (commercialObjectiveSupersessionFamily, objectiveSeedFromPersisted) and
 * are the exact "second planner" this task must not reconstruct. This
 * module never imports from reconciliation.ts.
 *
 * Rules (see docs/ACTIVE_RELEASE.md's P5 brief for the full rationale):
 *  - proposal === null or proposal.objective === null -> NOOP. The durable
 *    objective is never touched by a turn with nothing to say ("gracias").
 *  - operation NONE -> NOOP. Having an objective kind opinion is not itself
 *    a request to act.
 *  - Any other operation against a work that is not ACTIVE/WAITING_CUSTOMER/
 *    WAITING_SYSTEM (i.e. HANDOFF/FAILED/a terminal status) -> REJECT. A
 *    human-owned or terminally-closed work is never mutated by this path.
 *  - START with no active objective -> START.
 *  - START while an objective of the SAME kind is already active -> CONTINUE
 *    (never a silent duplicate; also makes a retried START idempotent, since
 *    the just-created objective is of that same kind on the next read).
 *  - START while an objective of a DIFFERENT kind is active -> REJECT. The
 *    model must say REPLACE to change objective, never an implicit START.
 *  - CONTINUE/MODIFY require an active objective of the SAME kind, else
 *    REJECT (never an implicit START). Neither ever writes: P5 does not
 *    persist requirementSignals or any other business field into
 *    CommercialObjective.inputs (see reconcile.ts's own module comment in
 *    the release doc for the justification), so there is no legitimate
 *    durable field for either operation to change today - only the decision
 *    itself is observable, via the reconciliation-decided event.
 *  - REPLACE with no active objective -> STARTs a fresh objective for the
 *    proposed kind directly (nothing to supersede).
 *  - REPLACE with an active objective that is ALREADY the objective this
 *    exact turn created (same deterministic id) -> CONTINUE. Makes a
 *    retried REPLACE idempotent: without this check, a retry would
 *    supersede the objective its own earlier attempt just created.
 *  - REPLACE with any other active objective -> REPLACE (supersede it,
 *    create a new objective for the proposed kind).
 *  - CANCEL requires an active objective of the SAME kind, else REJECT.
 *  - COMPLETE always REJECTs in this increment: no objective kind has a
 *    durable success-evidence source wired yet (DISCOVER_NEED/ORDER/
 *    AFTER_SALES have no domain-read-model field at all; QUOTE's evidence
 *    mapping is deliberately deferred to the phase that adds real
 *    side-effects). A model saying COMPLETE never falsely completes an
 *    objective - see invariant 6.
 */
export function decideCommercialObjectiveReconciliation(input: {
  proposal: CommercialProposalV1 | null;
  activeObjective: CommercialObjective | null;
  workStatus: CommercialWorkStatus;
  /** Deterministic objectiveId this exact (work, inboundMessageId) pair would create/target - see applyCommercialObjectiveReconciliation.ts's buildTurnObjectiveId. Used only to make a retried REPLACE idempotent. */
  turnObjectiveId: string;
}): CommercialObjectiveReconciliationDecision {
  const { proposal, activeObjective, workStatus, turnObjectiveId } = input;

  if (!proposal) return { action: "NOOP", reasonCode: "PROPOSAL_ABSENT" };
  if (!proposal.objective) return { action: "NOOP", reasonCode: "PROPOSAL_OBJECTIVE_ABSENT" };

  const { kind, operation } = proposal.objective;
  if (operation === "NONE") return { action: "NOOP", reasonCode: "OPERATION_NONE" };

  if (workStatus !== "ACTIVE" && workStatus !== "WAITING_CUSTOMER" && workStatus !== "WAITING_SYSTEM") {
    return { action: "REJECT", reasonCode: "WORK_NOT_OPEN" };
  }

  const sameKindActive = activeObjective !== null && activeObjective.type === kind;

  switch (operation) {
    case "START":
      if (!activeObjective) return { action: "START", kind, reasonCode: "START_NO_ACTIVE_OBJECTIVE" };
      if (sameKindActive) return { action: "CONTINUE", objectiveId: activeObjective.objectiveId, reasonCode: "START_COLLAPSED_SAME_KIND_ACTIVE" };
      return { action: "REJECT", reasonCode: "START_WITH_DIFFERENT_ACTIVE_OBJECTIVE" };

    case "CONTINUE":
      if (!activeObjective) return { action: "REJECT", reasonCode: "CONTINUE_WITHOUT_ACTIVE_OBJECTIVE" };
      if (!sameKindActive) return { action: "REJECT", reasonCode: "CONTINUE_KIND_MISMATCH" };
      return { action: "CONTINUE", objectiveId: activeObjective.objectiveId, reasonCode: "CONTINUE_SAME_OBJECTIVE" };

    case "MODIFY":
      if (!activeObjective) return { action: "REJECT", reasonCode: "MODIFY_WITHOUT_ACTIVE_OBJECTIVE" };
      if (!sameKindActive) return { action: "REJECT", reasonCode: "MODIFY_KIND_MISMATCH" };
      return { action: "MODIFY", objectiveId: activeObjective.objectiveId, reasonCode: "MODIFY_SAME_OBJECTIVE" };

    case "REPLACE":
      if (!activeObjective) return { action: "START", kind, reasonCode: "REPLACE_WITHOUT_ACTIVE_OBJECTIVE_TREATED_AS_START" };
      if (activeObjective.objectiveId === turnObjectiveId) return { action: "CONTINUE", objectiveId: activeObjective.objectiveId, reasonCode: "REPLACE_ALREADY_APPLIED_THIS_TURN" };
      return { action: "REPLACE", previousObjectiveId: activeObjective.objectiveId, kind, reasonCode: "REPLACE_ACTIVE_OBJECTIVE" };

    case "CANCEL":
      if (!activeObjective) return { action: "REJECT", reasonCode: "CANCEL_WITHOUT_ACTIVE_OBJECTIVE" };
      if (!sameKindActive) return { action: "REJECT", reasonCode: "CANCEL_KIND_MISMATCH" };
      return { action: "CANCEL", objectiveId: activeObjective.objectiveId, reasonCode: "CANCEL_ACTIVE_OBJECTIVE" };

    case "COMPLETE":
      return { action: "REJECT", reasonCode: "COMPLETE_EVIDENCE_NOT_WIRED" };

    default:
      return { action: "REJECT", reasonCode: "OPERATION_UNRECOGNIZED" };
  }
}
