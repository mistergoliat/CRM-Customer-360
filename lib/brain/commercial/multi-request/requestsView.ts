import { safeQueryRows } from "@/lib/db";
import { listActiveConversationRequests, listRequestEvents, loadConversationRequest } from "../conversation-request";
import type { ConversationRequest, RequestEvent } from "../conversation-request";
import { listActiveRequestFacts } from "../request-facts";
import type { RequestFact } from "../request-facts";
import { findOpenEscalationForRequest } from "../request-escalations";
import type { RequestEscalation } from "../request-escalations";
import { getCurrentQuoteForRequest } from "../quotes";
import type { CommercialQuote } from "../quotes";
import { listDeferredActionsForRequest } from "./deferredActions";
import type { DeferredRequestAction } from "./deferredActions";
import { listPendingFollowupsForRequest } from "./requestFollowups";
import type { RequestFollowup } from "./requestFollowups";

export type ConversationRequestView = {
  request: ConversationRequest;
  activeFacts: RequestFact[];
  currentQuote: CommercialQuote | null;
  openEscalation: RequestEscalation | null;
  deferredActions: DeferredRequestAction[];
  pendingFollowups: RequestFollowup[];
  recentEvents: RequestEvent[];
};

export type ConversationRequestsView = {
  conversationId: number;
  conversationPublicId: string | null;
  requests: ConversationRequestView[];
  totals: { active: number; waitingCustomer: number; waitingHuman: number };
};

export async function resolveConversationIdByPublicId(publicId: string): Promise<number | null> {
  const result = await safeQueryRows<{ id: number | string }>(
    "SELECT id FROM conversation WHERE public_id = ? LIMIT 1",
    [publicId]
  );
  if (!result.ok || !result.rows[0]) return null;
  const id = Number(result.rows[0].id);
  return Number.isFinite(id) ? id : null;
}

async function composeRequestView(request: ConversationRequest, eventLimit: number): Promise<ConversationRequestView> {
  const [activeFacts, currentQuote, openEscalation, deferredActions, pendingFollowups, events] = await Promise.all([
    listActiveRequestFacts(request.requestId),
    getCurrentQuoteForRequest(request.requestId),
    findOpenEscalationForRequest(request.requestId),
    listDeferredActionsForRequest(request.requestId),
    listPendingFollowupsForRequest(request.requestId),
    listRequestEvents(request.requestId)
  ]);
  return {
    request,
    activeFacts,
    currentQuote,
    openEscalation,
    deferredActions,
    pendingFollowups,
    recentEvents: events.slice(-eventLimit)
  };
}

/**
 * Operator read model: everything the HUB needs to answer "what is the system
 * working on in this conversation, per request" - state, facts, quote,
 * escalation, deferred work and trail. Read-only by construction.
 */
export async function loadConversationRequestsView(
  conversation: { conversationId: number } | { conversationPublicId: string },
  options: { eventLimit?: number } = {}
): Promise<ConversationRequestsView | null> {
  let conversationId: number;
  let conversationPublicId: string | null = null;

  if ("conversationPublicId" in conversation) {
    const resolved = await resolveConversationIdByPublicId(conversation.conversationPublicId);
    if (resolved === null) return null;
    conversationId = resolved;
    conversationPublicId = conversation.conversationPublicId;
  } else {
    conversationId = conversation.conversationId;
  }

  const eventLimit = Math.max(1, Math.min(options.eventLimit ?? 20, 100));
  const activeRequests = await listActiveConversationRequests(conversationId);
  const requests = await Promise.all(activeRequests.map((request) => composeRequestView(request, eventLimit)));

  return {
    conversationId,
    conversationPublicId,
    requests,
    totals: {
      active: requests.filter((view) => view.request.status === "active" || view.request.status === "detected" || view.request.status === "partially_resolved").length,
      waitingCustomer: requests.filter((view) => view.request.status === "waiting_customer").length,
      waitingHuman: requests.filter((view) => view.request.status === "waiting_human").length
    }
  };
}

/** Single-request drill-down for the HUB detail pane. */
export async function loadRequestDetailView(requestId: string, options: { eventLimit?: number } = {}): Promise<ConversationRequestView | null> {
  const request = await loadConversationRequest(requestId);
  if (!request) return null;
  return composeRequestView(request, Math.max(1, Math.min(options.eventLimit ?? 50, 200)));
}
