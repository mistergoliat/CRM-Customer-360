import { randomUUID } from "node:crypto";
import { recordIdentityEvidence } from "./repository";
import type {
  IdentityEvidenceChannelControl,
  IdentityEvidenceRecord,
  IdentityEvidenceSignalType,
  RecordIdentityEvidenceInput,
  RecordIdentityEvidenceResult
} from "./types";

// PARTE 7. Freshness is derived from lifecycle status alone - never an
// invented numeric TTL. wa_id/prestashop_customer_id durability additionally
// depends on their customer_external_identity link staying active, which
// this domain does not join against yet (no revocation writer exists in the
// codebase today - see release doc "Deudas"); callers that need that
// stronger guarantee must cross-check customer_external_identity themselves.
export type IdentityEvidenceFreshness = "current" | "historical" | "stale";

export function computeEvidenceFreshness(record: IdentityEvidenceRecord): IdentityEvidenceFreshness {
  if (record.status === "SUPERSEDED" || record.status === "REVOKED") return "historical";
  if (record.status === "STALE") return "stale";
  return "current";
}

// Minimal shape of ID-R2-A02's IdentityEvidence/IdentityResolutionDetail -
// declared locally (not imported from lib/domains/customer-identity) so
// this leaf domain never depends on the resolver's module, mirroring the
// no-cross-module-import convention already used by lib/brain/commercial/events/types.ts.
type SourceIdentityEvidenceItem = {
  signalType: IdentityEvidenceSignalType;
  source: RecordIdentityEvidenceInput["source"];
  strength: RecordIdentityEvidenceInput["strength"];
  masterCustomerId?: string;
  prestashopCustomerId?: string;
  verified: boolean;
  observedAt: string;
};

export type RecordIdentityEvidenceBatchInput = {
  conversationId: string;
  messageId?: string | null;
  correlationId: string;
  channel: string;
  evidence: SourceIdentityEvidenceItem[];
  /** Set only when the resolver's own detail.status === "IDENTITY_CONFLICT" this turn (PARTE 6). */
  conflict?: { conflictCode: string } | null;
  /**
   * Raw normalized values the resolver never places on IdentityEvidence
   * (ID-R2-A02 privacy rule - see lib/domains/customer-identity/types.ts).
   * Only pass a value the caller already legitimately holds this turn (e.g.
   * trustedInbound.externalId/normalizedPhone) - never invented here, never
   * persisted raw (repository.ts hashes/redacts before writing).
   */
  rawSignalValues?: Partial<Record<IdentityEvidenceSignalType, string>>;
  channelEvidence?: IdentityEvidenceChannelControl | null;
};

function providerForSignal(signalType: IdentityEvidenceSignalType, channel: string): string {
  return signalType === "prestashop_customer_id" ? "prestashop" : channel;
}

/**
 * PARTE 15. The write boundary a trusted runtime (never the LLM, never a
 * capability/tool) calls once per turn with whatever evidence the resolver
 * already computed. Fail-safe by construction for the caller: every result
 * is a plain object, nothing here throws past this function - callers still
 * decide whether to swallow a failure (see identityEvidenceHooks.ts callers,
 * which always do, matching identityAuditEvents.ts's existing convention).
 */
export async function recordIdentityEvidenceBatch(input: RecordIdentityEvidenceBatchInput): Promise<RecordIdentityEvidenceResult[]> {
  const conflictGroupId = input.conflict ? randomUUID() : null;
  const results: RecordIdentityEvidenceResult[] = [];

  for (const item of input.evidence) {
    const rawValue = input.rawSignalValues?.[item.signalType] ?? null;
    const result = await recordIdentityEvidence({
      conversationId: input.conversationId,
      messageId: input.messageId ?? null,
      correlationId: input.correlationId,
      channel: input.channel,
      provider: providerForSignal(item.signalType, input.channel),
      channelEvidence: item.signalType === "wa_id" ? (input.channelEvidence ?? "controlled") : null,
      signalType: item.signalType,
      source: item.source,
      normalizedSignalValue: rawValue,
      masterCustomerId: item.masterCustomerId ?? null,
      prestashopCustomerId: item.prestashopCustomerId ?? null,
      strength: item.strength,
      verified: item.verified,
      observedAt: item.observedAt,
      conflictGroupId,
      conflictCode: input.conflict?.conflictCode ?? null
    });
    results.push(result);
  }

  return results;
}
