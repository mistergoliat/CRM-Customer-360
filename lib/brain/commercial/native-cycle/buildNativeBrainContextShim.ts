import type { CommercialContextSnapshot } from "../context/buildNativeCommercialContext";

/**
 * Adapts CommercialContextSnapshot (from the native MariaDB pipeline) to the
 * loose brainContext shape that normalizeCommercialBrainContext can parse.
 * This lets the native cycle reuse buildCommercialContext (and all its
 * SalesAgentInput building helpers) without duplicating logic.
 */
export function buildNativeBrainContextShim(
  snapshot: CommercialContextSnapshot,
  inboundText: string,
  waId: string,
  phoneNumberId: string,
  conversationCaseId: number | string | null,
  currentTime: string
): Record<string, unknown> {
  const customer = snapshot.customer;
  const conv = snapshot.conversation;
  const opp = snapshot.opportunity;

  const recentMessages = snapshot.recentMessages.map((m) => ({
    direction: m.direction,
    text: m.body ?? "",
    body: m.body ?? "",
    wa_id: waId,
    phone_number_id: phoneNumberId,
    occurred_at: m.occurredAt,
    created_at: m.occurredAt,
    channel: "whatsapp",
    platform: conv?.channel ?? "whatsapp"
  }));

  const latestInbound = {
    direction: "inbound",
    text: inboundText,
    body: inboundText,
    wa_id: waId,
    phone_number_id: phoneNumberId,
    occurred_at: currentTime,
    created_at: currentTime,
    channel: "whatsapp",
    platform: conv?.channel ?? "whatsapp",
    intent: null
  };

  const latestOutbound = snapshot.recentMessages
    .filter((m) => m.direction === "outbound")
    .sort((a, b) => new Date(b.occurredAt ?? 0).getTime() - new Date(a.occurredAt ?? 0).getTime())[0];

  return {
    channel: "whatsapp",
    platform: conv?.channel ?? "whatsapp",

    // The legacy pipeline resolves identity via the n8n context service; the
    // native path already resolved it against master_customer, so we mirror
    // the equivalent resolver output here.
    resolver_identity: {
      identity_type: snapshot.identityConflict ? "mixed" : customer ? "customer" : "wa_id",
      confidence: snapshot.identityConflict ? 0.2 : customer ? 0.9 : 0.5,
      notes: [],
      warnings: []
    },

    customer_context: {
      wa_id: conv?.externalContactId ?? waId,
      phone_number_id: phoneNumberId,
      id_customer: customer?.id ?? null,
      email: customer?.email ?? null,
      phone: conv?.externalContactId ?? waId,
      firstname: customer?.firstname ?? null,
      lastname: customer?.lastname ?? null
    },

    case_context: {
      conversation_case_id: conversationCaseId,
      status: conv?.status ?? "open",
      lifecycle_status: conv?.status ?? "open",
      human_owner_active: Boolean(conv?.humanOwnerActive || opp?.humanOwnerActive),
      ai_blocked: Boolean(!conv?.aiEnabled || opp?.aiBlocked),
      department: null,
      channel: "whatsapp"
    },

    conversation_context: {
      recent_messages: recentMessages,
      latest_inbound_message: latestInbound,
      latest_outbound_message: latestOutbound
        ? {
            direction: "outbound",
            text: latestOutbound.body ?? "",
            body: latestOutbound.body ?? "",
            wa_id: waId,
            occurred_at: latestOutbound.occurredAt,
            channel: "whatsapp"
          }
        : null
    },

    latestInboundMessage: latestInbound,

    opportunity: opp
      ? {
          opportunity_key: opp.opportunityKey,
          status: opp.status,
          stage: opp.stage,
          temperature: null,
          current_summary: opp.currentSummary ?? null,
          next_action_type: opp.nextActionType ?? null,
          next_action_due_at: opp.nextActionDueAt ?? null,
          human_owner_active: Boolean(opp.humanOwnerActive),
          ai_blocked: Boolean(opp.aiBlocked),
          requirements: [],
          product_interests: [],
          // Multi-turn: expose what the agent is waiting for and recent actions
          waiting_for: opp.nextActionType ?? null,
          current_next_best_action: opp.nextActionType
            ? { type: opp.nextActionType, due_at: opp.nextActionDueAt ?? null }
            : null,
          next_follow_up_at: opp.nextActionType === "schedule_followup" ? opp.nextActionDueAt ?? null : null
        }
      : null,

    // Fase 4: recent agent actions — tells the model what it already did and
    // what's pending, so it doesn't repeat questions or duplicate actions.
    pending_agent_actions: snapshot.actions
      .filter((a) => a.status === "proposed" || a.status === "planned")
      .map((a) => ({
        action_type: a.actionType,
        status: a.status,
        scheduled_for: a.scheduledFor,
        draft_message: a.draftMessage
      })),

    completed_agent_actions: snapshot.actions
      .filter((a) => a.status === "executed" || a.status === "cancelled" || a.status === "failed")
      .map((a) => ({
        action_type: a.actionType,
        status: a.status,
        final_message: a.finalMessage
      })),

    identity_conflict: snapshot.identityConflict
      ? {
          detected: true,
          wa_id: waId,
          customer_ids: snapshot.identityConflict.candidateCustomerIds
        }
      : null,

    // ACS-R1-04-T05: reduced, allowlisted Customer 360 history - already
    // loaded once by runNativeAutonomousCycle before this shim was built.
    // Never re-loaded here, never the full snapshot.
    customer360: snapshot.customer360,
    customer360State: snapshot.customer360State,

    // ACS-R1-04-T06: minimized identity/onboarding decision context - already
    // resolved once by resolveNativeCustomerSession. Never the execution
    // context, never re-resolved here.
    customerSession: snapshot.customerSession
  };
}
