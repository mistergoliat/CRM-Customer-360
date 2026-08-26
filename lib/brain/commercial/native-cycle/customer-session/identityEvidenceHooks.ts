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
