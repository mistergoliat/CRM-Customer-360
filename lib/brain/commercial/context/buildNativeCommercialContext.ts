import { loadNativeConversationDetailByPublicId } from "@/lib/brain/native-whatsapp";
import { findDistinctCustomersByNormalizedValue } from "@/lib/integrations/customer-external-identity";
import type { SalesConsultativeOpportunity, SalesNeedProfile } from "../sales-consultative/types";
import { COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES } from "../constants";
import { hasStaleCommercialContext } from "./adapters";
import type { AutonomousCustomerContext } from "./autonomousCustomerContext";
import type { AutonomousCustomerContextLoadState } from "./loadAutonomousCustomerContext";
import type { CustomerSessionDecisionContext } from "../native-cycle/customer-session";

export const COMMERCIAL_CONTEXT_CONTRACT_NAME = "CommercialContext" as const;
export const COMMERCIAL_CONTEXT_SCHEMA_VERSION = "1.0" as const;

export type NativeCommercialContextCompleteness = "complete" | "partial" | "minimal" | "insufficient";

export type NativeCommercialContextCustomer = {
  id: string;
  firstname: string;
  lastname: string;
  email: string | null;
  platformOrigin: string | null;
};

export type NativeCommercialContextConversation = {
  id: string;
  publicId: string;
  channel: string;
  provider: string;
  externalContactId: string;
  status: string;
  aiEnabled: boolean;
  humanOwnerActive: boolean;
  lastMessageAt: string | null;
};

export type NativeCommercialContextMessage = {
  id: string;
  direction: string;
  body: string | null;
  status: string | null;
  occurredAt: string | null;
};

export type NativeCommercialContextAction = {
  id: string;
  actionId: string;
  actionType: string;
  status: string;
  scheduledFor: string | null;
  draftMessage: string | null;
  finalMessage: string | null;
};

export type NativeCommercialContextSignals = {
  hasCustomer: boolean;
  hasOpportunity: boolean;
  hasNeedProfile: boolean;
  hasRecentMessages: boolean;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
  staleContext: boolean;
  identityConflict: boolean;
};

export type NativeCommercialContextIdentityConflict = {
  type: "divergent_identity_links" | "customer_conversation_mismatch";
  candidateCustomerIds: number[];
  detectedAt: string;
};

export type NativeCommercialContextWarning =
  | "conversation_not_found"
  | "missing_customer"
  | "missing_opportunity"
  | "missing_need_profile"
  | "missing_recent_messages"
  | "stale_context"
  | "human_owner_active"
  | "ai_blocked"
  | "invalid_current_time"
  | "identity_conflict_divergent_customers"
  | "identity_conflict_customer_conversation_mismatch";

export type CommercialContextSnapshot = {
  contractName: typeof COMMERCIAL_CONTEXT_CONTRACT_NAME;
  schemaVersion: typeof COMMERCIAL_CONTEXT_SCHEMA_VERSION;
  status: "success" | "insufficient_context" | "not_found";
  completeness: NativeCommercialContextCompleteness;
  customer: NativeCommercialContextCustomer | null;
  conversation: NativeCommercialContextConversation | null;
  recentMessages: NativeCommercialContextMessage[];
  opportunity: SalesConsultativeOpportunity | null;
  needProfile: SalesNeedProfile | null;
  actions: NativeCommercialContextAction[];
  signals: NativeCommercialContextSignals;
  identityConflict: NativeCommercialContextIdentityConflict | null;
  availableCapabilities: string[];
  warnings: NativeCommercialContextWarning[];
  /**
   * ACS-R1-04-T05: never loaded by this function (it stays a pure transactional
   * snapshot) - always "not_requested"/null here. The caller
   * (runNativeAutonomousCycle) loads Customer 360 once and overrides these two
   * fields before handing the snapshot to buildNativeBrainContextShim.
   */
  customer360: AutonomousCustomerContext | null;
  customer360State: AutonomousCustomerContextLoadState;
  /**
   * ACS-R1-04-T06: never resolved by this function - always null here. The
   * caller (runNativeAutonomousCycle) resolves the session once and merges
   * it in before handing the snapshot to buildNativeBrainContextShim.
   */
  customerSession: CustomerSessionDecisionContext | null;
  metadata: {
    source: "native_mariadb";
    conversationPublicId: string;
    currentTime: string;
  };
};

type NativeConversationDetailSource = {
  conversation: {
    id: number | string;
    public_id: string;
    channel: string;
    provider: string;
    external_contact_id: string;
    status: string;
    ai_enabled: number | string | boolean;
    human_owner_active: number | string | boolean;
    last_message_at: string | null;
  };
  customer: {
    id: number | string;
    firstname: string;
    lastname: string;
    email: string | null;
    platform_origin: string | null;
  } | null;
  messages: Array<{
    id: number | string;
    direction: string;
    body: string | null;
    status: string | null;
    provider_timestamp: string | null;
    created_at: string;
  }>;
  opportunity: SalesConsultativeOpportunity | null;
  profile: SalesNeedProfile | null;
  actions: Array<{
    id: number | string;
    actionId: string;
    actionType: string;
    status: string;
    scheduledFor: string | null;
    draftMessage: string | null;
    finalMessage: string | null;
  }>;
};

type ConversationDetailLoader = (conversationPublicId: string) => Promise<NativeConversationDetailSource | null>;

type DistinctCustomersLookup = (
  provider: string,
  normalizedValue: string
) => Promise<{ ok: boolean; customerIds: number[] }>;

export type BuildNativeCommercialContextInput = {
  conversationPublicId: string;
  currentTime: string | Date;
  availableCapabilities?: string[];
  loadConversationDetail?: ConversationDetailLoader;
  findDistinctCustomers?: DistinctCustomersLookup;
};

function toIsoOrNull(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asBoolean(value: number | string | boolean | null | undefined) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  return false;
}

function computeCompleteness(input: {
  hasConversation: boolean;
  hasCustomer: boolean;
  hasOpportunity: boolean;
  hasRecentMessages: boolean;
}): NativeCommercialContextCompleteness {
  if (!input.hasConversation) return "insufficient";
  if (input.hasCustomer && input.hasOpportunity && input.hasRecentMessages) return "complete";
  if (input.hasCustomer || input.hasOpportunity || input.hasRecentMessages) return "partial";
  return "minimal";
}

function buildEmptySnapshot(input: {
  status: "not_found" | "insufficient_context";
  conversationPublicId: string;
  currentTime: string;
  availableCapabilities: string[];
  warnings: NativeCommercialContextWarning[];
}): CommercialContextSnapshot {
  return {
    contractName: COMMERCIAL_CONTEXT_CONTRACT_NAME,
    schemaVersion: COMMERCIAL_CONTEXT_SCHEMA_VERSION,
    status: input.status,
    completeness: "insufficient",
    customer: null,
    conversation: null,
    recentMessages: [],
    opportunity: null,
    needProfile: null,
    actions: [],
    signals: {
      hasCustomer: false,
      hasOpportunity: false,
      hasNeedProfile: false,
      hasRecentMessages: false,
      humanOwnerActive: false,
      aiBlocked: false,
      staleContext: false,
      identityConflict: false
    },
    identityConflict: null,
    availableCapabilities: input.availableCapabilities,
    warnings: input.warnings,
    customer360: null,
    customer360State: "not_requested",
    customerSession: null,
    metadata: {
      source: "native_mariadb",
      conversationPublicId: input.conversationPublicId,
      currentTime: input.currentTime
    }
  };
}

/**
 * Read-only CommercialContext snapshot sourced exclusively from native tables
 * (master_customer, conversation, conversation_message, crm_opportunities,
 * crm_sales_need_profiles, crm_agent_actions) via loadNativeConversationDetailByPublicId.
 * No legacy/shadow fallback, no mutation, no tool execution.
 */
export async function buildNativeCommercialContext(input: BuildNativeCommercialContextInput): Promise<CommercialContextSnapshot> {
  const availableCapabilities = [...(input.availableCapabilities ?? [])];
  const currentTime = toIsoOrNull(input.currentTime);

  if (!input.conversationPublicId || !input.conversationPublicId.trim()) {
    return buildEmptySnapshot({
      status: "insufficient_context",
      conversationPublicId: input.conversationPublicId ?? "",
      currentTime: currentTime ?? new Date(0).toISOString(),
      availableCapabilities,
      warnings: ["conversation_not_found"]
    });
  }

  if (!currentTime) {
    return buildEmptySnapshot({
      status: "insufficient_context",
      conversationPublicId: input.conversationPublicId,
      currentTime: new Date(0).toISOString(),
      availableCapabilities,
      warnings: ["invalid_current_time"]
    });
  }

  const loadConversationDetail = input.loadConversationDetail ?? loadNativeConversationDetailByPublicId;
  const detail = await loadConversationDetail(input.conversationPublicId);

  if (!detail) {
    return buildEmptySnapshot({
      status: "not_found",
      conversationPublicId: input.conversationPublicId,
      currentTime,
      availableCapabilities,
      warnings: ["conversation_not_found"]
    });
  }

  const conversation: NativeCommercialContextConversation = {
    id: String(detail.conversation.id),
    publicId: detail.conversation.public_id,
    channel: detail.conversation.channel,
    provider: detail.conversation.provider,
    externalContactId: detail.conversation.external_contact_id,
    status: detail.conversation.status,
    aiEnabled: asBoolean(detail.conversation.ai_enabled),
    humanOwnerActive: asBoolean(detail.conversation.human_owner_active),
    lastMessageAt: detail.conversation.last_message_at
  };

  const customer: NativeCommercialContextCustomer | null = detail.customer
    ? {
        id: String(detail.customer.id),
        firstname: detail.customer.firstname,
        lastname: detail.customer.lastname,
        email: detail.customer.email,
        platformOrigin: detail.customer.platform_origin
      }
    : null;

  const recentMessages: NativeCommercialContextMessage[] = detail.messages
    .slice(-COMMERCIAL_CONTEXT_MAX_RECENT_MESSAGES)
    .map((message) => ({
      id: String(message.id),
      direction: message.direction,
      body: message.body,
      status: message.status,
      occurredAt: message.provider_timestamp ?? message.created_at
    }));

  const opportunity = detail.opportunity;
  const needProfile = detail.profile;

  const actions: NativeCommercialContextAction[] = detail.actions.map((action) => ({
    id: String(action.id),
    actionId: action.actionId,
    actionType: action.actionType,
    status: action.status,
    scheduledFor: action.scheduledFor,
    draftMessage: action.draftMessage,
    finalMessage: action.finalMessage
  }));

  const staleContext = hasStaleCommercialContext(currentTime, [conversation.lastMessageAt]);
  const humanOwnerActive = conversation.humanOwnerActive || Boolean(opportunity?.humanOwnerActive);
  const aiBlocked = !conversation.aiEnabled || Boolean(opportunity?.aiBlocked);

  // PR-03A: re-derive the same identity-conflict signal that
  // resolveOrCreateNativeCustomer computes on inbound, so that anything
  // reading CommercialContext (not just the inbound path itself) can see an
  // unresolved identity instead of treating `customer` as trustworthy.
  const findDistinctCustomers = input.findDistinctCustomers ?? findDistinctCustomersByNormalizedValue;
  let identityConflict: NativeCommercialContextIdentityConflict | null = null;
  if (conversation.externalContactId) {
    const distinct = await findDistinctCustomers("whatsapp", conversation.externalContactId);
    if (distinct.ok && distinct.customerIds.length > 1) {
      identityConflict = {
        type: "divergent_identity_links",
        candidateCustomerIds: distinct.customerIds,
        detectedAt: currentTime
      };
    } else if (distinct.ok && distinct.customerIds.length === 1 && customer && Number(distinct.customerIds[0]) !== Number(customer.id)) {
      identityConflict = {
        type: "customer_conversation_mismatch",
        candidateCustomerIds: [Number(distinct.customerIds[0]), Number(customer.id)],
        detectedAt: currentTime
      };
    }
  }

  const signals: NativeCommercialContextSignals = {
    hasCustomer: Boolean(customer),
    hasOpportunity: Boolean(opportunity),
    hasNeedProfile: Boolean(needProfile),
    hasRecentMessages: recentMessages.length > 0,
    humanOwnerActive,
    aiBlocked,
    staleContext,
    identityConflict: Boolean(identityConflict)
  };

  const warnings: NativeCommercialContextWarning[] = [];
  if (!signals.hasCustomer) warnings.push("missing_customer");
  if (!signals.hasOpportunity) warnings.push("missing_opportunity");
  if (!signals.hasNeedProfile) warnings.push("missing_need_profile");
  if (!signals.hasRecentMessages) warnings.push("missing_recent_messages");
  if (signals.staleContext) warnings.push("stale_context");
  if (signals.humanOwnerActive) warnings.push("human_owner_active");
  if (signals.aiBlocked) warnings.push("ai_blocked");
  if (identityConflict?.type === "divergent_identity_links") warnings.push("identity_conflict_divergent_customers");
  if (identityConflict?.type === "customer_conversation_mismatch") warnings.push("identity_conflict_customer_conversation_mismatch");

  const completeness = computeCompleteness({
    hasConversation: true,
    hasCustomer: signals.hasCustomer,
    hasOpportunity: signals.hasOpportunity,
    hasRecentMessages: signals.hasRecentMessages
  });

  return {
    contractName: COMMERCIAL_CONTEXT_CONTRACT_NAME,
    schemaVersion: COMMERCIAL_CONTEXT_SCHEMA_VERSION,
    status: completeness === "insufficient" ? "insufficient_context" : "success",
    completeness,
    customer,
    conversation,
    recentMessages,
    opportunity,
    needProfile,
    actions,
    signals,
    identityConflict,
    availableCapabilities,
    warnings,
    customer360: null,
    customer360State: "not_requested",
    customerSession: null,
    metadata: {
      source: "native_mariadb",
      conversationPublicId: input.conversationPublicId,
      currentTime
    }
  };
}
