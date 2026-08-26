import { normalizePhoneChile, normalizeWaId } from "@/lib/customer-identity/normalize";
import { recordIdentityEvidence, recordIdentityEvidenceBatch } from "@/lib/domains/customer-identity-evidence";
import type { IdentityResolutionDetail } from "@/lib/domains/customer-identity";

// SALES-AGENT-R2-ID-R2-A03. Durable identity evidence persistence, wired
// into the two places the trusted native-cycle runtime already produces
// real identity signals - never a new engine, never reachable from the LLM.
// Same fail-safe discipline as identityAuditEvents.ts (ACS-R1-04-T07): a
// recording failure here can never surface as a raw error or change a
// business outcome, so every export below swallows its own errors.

/**
 * Called once per turn from resolveNativeCustomerSession, right after the
 * canonical resolver (lib/domains/customer-identity) returns its detail -
 * persists whatever wa_id/phone/email/prestashop/order evidence it computed
 * this turn (ID-R2-A02's in-memory contract), durably. When the turn's
 * detail escalated to IDENTITY_CONFLICT, every evidence item recorded this
 * turn shares one fresh conflict_group_id (PARTE 6).
 */
export async function recordTurnIdentityEvidence(params: {
  conversationId: string;
  messageId: string;
  correlationId: string;
  externalId: string;
  normalizedPhone: string | null;
  detail: IdentityResolutionDetail | undefined;
}): Promise<void> {
  if (!params.detail || params.detail.evidence.length === 0) return;

  const normalizedWaId = normalizeWaId(params.externalId);
  const normalizedPhone = params.normalizedPhone ? normalizePhoneChile(params.normalizedPhone) : null;

  try {
    await recordIdentityEvidenceBatch({
      conversationId: params.conversationId,
      messageId: params.messageId,
      correlationId: params.correlationId,
      channel: "whatsapp",
      evidence: params.detail.evidence,
      conflict:
        params.detail.status === "IDENTITY_CONFLICT" && params.detail.conflictCode
          ? { conflictCode: params.detail.conflictCode }
          : null,
      rawSignalValues: {
        ...(normalizedWaId ? { wa_id: normalizedWaId } : {}),
        ...(normalizedPhone ? { phone: normalizedPhone } : {})
      },
      channelEvidence: "controlled"
    });
  } catch {
    // Fail-safe - see module comment.
  }
}

/**
 * Called from the post-plan onboarding field-capture step
 * (runCustomerOnboardingPostPlanStage) for each identity-bearing field the
 * customer declared this turn (email, orderReference - PARTE 5). The
 * customer's declared value is never proof of ownership by itself (same
 * semantics as ID-R2-A02's "candidate" evidence) - source "manual",
 * strength "observed". Corrections are handled generically by
 * recordIdentityEvidence: an unchanged value is a no-op, a changed value
 * transactionally supersedes the prior row for this (conversation, field).
 */
export async function recordOnboardingFieldEvidence(params: {
  conversationId: string;
  messageId: string;
  correlationId: string;
  masterCustomerId: string | null;
  field: "email" | "orderReference";
  value: string;
  observedAt: string;
}): Promise<void> {
  try {
    await recordIdentityEvidence({
      conversationId: params.conversationId,
      messageId: params.messageId,
      correlationId: params.correlationId,
      channel: "whatsapp",
      provider: "manual",
      signalType: params.field === "email" ? "email" : "order_reference",
      source: "manual",
      normalizedSignalValue: params.value,
      masterCustomerId: params.masterCustomerId,
      strength: "observed",
      verified: false,
      observedAt: params.observedAt
    });
  } catch {
    // Fail-safe - see module comment.
  }
}

/**
 * SALES-AGENT-R2-ID-R2-A09 (PARTE 14). Called once, right after
 * linkPrestashopIdentityCapability (customerIdentityCapabilities.ts)
 * confirms a canonical PrestaShop bridge with Customer Service and writes
 * the live customer_external_identity row. Kept here rather than imported
 * directly into the Capability Gateway layer - a structural test
 * (customerIdentityEvidence.test.ts's IDE17) asserts that file never imports
 * this evidence domain at all, specifically so no LLM-reachable path can
 * ever mark evidence VERIFIED; this hook is the SAME trusted-runtime-only
 * boundary recordOnboardingFieldEvidence/recordTurnIdentityEvidence above
 * already are, never a second evidence engine. Mirrors exactly the shape
 * A02's own resolver writes once it discovers the same live bridge on a
 * later turn (applyIdentityEvidence.ts's "Case A") - this only makes the
 * fact available a turn earlier, so A07's existing same-turn resume can
 * observe it immediately (see release doc PARTE 14).
 */
export async function recordPrestashopBridgeEvidence(params: {
  conversationId: string;
  messageId: string;
  correlationId: string;
  masterCustomerId: string;
  prestashopCustomerId: string;
  /** Customer Service's own echoed link record id - used only to make this write's signalHash distinct from the weaker candidate evidence it supersedes (recordIdentityEvidence.ts's own dedup key), never invented. */
  sourceRecordRef: string;
  observedAt: string;
}): Promise<void> {
  try {
    await recordIdentityEvidence({
      conversationId: params.conversationId,
      messageId: params.messageId,
      correlationId: params.correlationId,
      channel: "whatsapp",
      provider: "prestashop",
      signalType: "prestashop_customer_id",
      source: "customer_external_identity",
      sourceRecordRef: params.sourceRecordRef,
      masterCustomerId: params.masterCustomerId,
      prestashopCustomerId: params.prestashopCustomerId,
      strength: "verified",
      verified: true,
      observedAt: params.observedAt
    });
  } catch {
    // Fail-safe - see module comment. A failure here degrades to cross-turn-
    // only resume (A02 writes the same row on its own next pass) - never a
    // fabricated evidence row, never surfaced as a capability failure.
  }
}
