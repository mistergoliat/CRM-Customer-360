// SALES-AGENT-R2-ID-R2-A03: durable persistence for the per-signal
// IdentityEvidence the canonical resolver (lib/domains/customer-identity,
// ID-R2-A02) already computes every turn in memory. See migrations/032 for
// the full rationale and PARTE 1/2 analysis.
//
// Separation kept throughout this module (task PRINCIPIO CENTRAL):
//   OBSERVATION  -> a row exists (status OBSERVED/CANDIDATE/VERIFIED/...)
//   ASSESSMENT   -> `strength`, fixed at write time from ID-R2-A02's evidence
//   VERIFICATION -> `status === "VERIFIED"` / `verifiedAt`
//   AUTHORITY    -> never granted here. This domain never writes
//                   master_customer or customer_external_identity, and is
//                   never reachable as an LLM tool.

export type IdentityEvidenceSignalType = "wa_id" | "phone" | "email" | "prestashop_customer_id" | "order_reference" | "manual_verification";

export type IdentityEvidenceSourceType = "customer_external_identity" | "prestashop" | "order" | "manual" | "customer_service";

// Mirrors lib/domains/customer-identity#IdentityEvidenceStrength exactly -
// this is the ID-R2-A02 vocabulary, fixed at the moment a row is written.
export type IdentityEvidenceStrength = "observed" | "candidate" | "strong" | "verified" | "conflict";

// PARTE 4. OBSERVED/CANDIDATE/VERIFIED/CONFLICTED are reachable at insert
// time; SUPERSEDED/STALE/REVOKED are only reachable via an explicit
// transition on an existing row - never inferred, never a default.
export type IdentityEvidenceStatus = "OBSERVED" | "CANDIDATE" | "VERIFIED" | "CONFLICTED" | "SUPERSEDED" | "STALE" | "REVOKED";

// Terminal - no further transition is legal without a brand new evidence row
// (task PARTE 4: "No permitir SUPERSEDED -> VERIFIED sin nueva evidence").
export const IDENTITY_EVIDENCE_TERMINAL_STATUSES: readonly IdentityEvidenceStatus[] = ["SUPERSEDED", "REVOKED"];

// PARTE 10. Channel control vs. mere observation - only meaningful for
// channel-identity signal types (wa_id today). Never generalized from
// WhatsApp consent semantics to other providers.
export type IdentityEvidenceChannelControl = "observed" | "controlled" | "verified";

export type IdentityEvidenceRecord = {
  evidenceId: string;
  conversationId: string;
  messageId: string | null;
  correlationId: string;

  channel: string;
  provider: string;
  channelEvidence: IdentityEvidenceChannelControl | null;

  signalType: IdentityEvidenceSignalType;
  source: IdentityEvidenceSourceType;
  sourceRecordRef: string | null;
  signalHash: string | null;
  signalDisplay: string | null;

  masterCustomerId: string | null;
  prestashopCustomerId: string | null;

  strength: IdentityEvidenceStrength;
  status: IdentityEvidenceStatus;

  conflictGroupId: string | null;
  conflictCode: string | null;

  observedAt: string;
  verifiedAt: string | null;
  supersededAt: string | null;
  supersededByEvidenceId: string | null;
  staleAt: string | null;
  revokedAt: string | null;

  metadata: Record<string, unknown>;

  createdAt: string;
  updatedAt: string;
};

// PARTE 16. Never masterCustomerId/prestashopCustomerId/hash/ref - the
// minimum shape safe to place near an LLM prompt or return to a client.
export type IdentityEvidencePromptSafeSummary = {
  signalType: IdentityEvidenceSignalType;
  status: IdentityEvidenceStatus;
  strength: IdentityEvidenceStrength;
  observedAt: string;
};

export function toPromptSafeSummary(record: IdentityEvidenceRecord): IdentityEvidencePromptSafeSummary {
  return { signalType: record.signalType, status: record.status, strength: record.strength, observedAt: record.observedAt };
}

export type RecordIdentityEvidenceInput = {
  conversationId: string;
  messageId?: string | null;
  correlationId: string;
  channel: string;
  provider: string;
  channelEvidence?: IdentityEvidenceChannelControl | null;
  signalType: IdentityEvidenceSignalType;
  source: IdentityEvidenceSourceType;
  sourceRecordRef?: string | null;
  /** Normalized value used only to compute signalHash/signalDisplay - never persisted raw, never logged. */
  normalizedSignalValue?: string | null;
  masterCustomerId?: string | null;
  prestashopCustomerId?: string | null;
  strength: IdentityEvidenceStrength;
  /** ID-R2-A02 IdentityEvidence.verified - true only for cross-source-converged/verified signals. */
  verified?: boolean;
  observedAt: string;
  /** When set, the row is inserted directly as CONFLICTED and grouped - see recordIdentityEvidenceBatch. */
  conflictGroupId?: string | null;
  conflictCode?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type RecordIdentityEvidenceResult =
  | { ok: true; status: "created"; record: IdentityEvidenceRecord }
  | { ok: true; status: "duplicate"; record: IdentityEvidenceRecord }
  | { ok: true; status: "unchanged"; record: IdentityEvidenceRecord }
  | { ok: false; status: "error"; error: string };

// Distinct from RecordIdentityEvidenceResult - a transition never "creates"
// a row, it moves an existing one (PARTE 4). Kept separate so a caller can
// never confuse "a fresh evidence row was written" with "an existing row's
// lifecycle status changed".
export type IdentityEvidenceTransitionResult = { ok: true; record: IdentityEvidenceRecord } | { ok: false; error: string };
