import { isDbWriteEnabled } from "@/lib/write-access";
import { queryRows } from "@/lib/db";
import { createCustomer } from "@/lib/domains/customers";
import { getCustomerContext } from "@/lib/brain/tools/customers/get-customer-context";
import { lookupCustomerByEmail } from "@/lib/brain/tools/customers/lookup-customer-by-email";
import { auditLog } from "@/lib/audit";
import { assessCustomerOnboardingToolPolicy, buildOperationalDecision } from "@/lib/brain/commercial/customer-onboarding/policy";
import { extractEmailCandidates, getCustomerOnboardingDisplayName, isExplicitCustomerConfirmation, localPublicId, normalizeIso, uniqueStrings } from "./utils";
import {
  appendConversationMessage,
  createConversation,
  getConversationByPublicId,
  insertAiAgentDecision,
  insertAiAgentExecution,
  insertAiToolExecution,
  listLocalAiSdrConversations,
  loadConversationRuntimeState,
  saveConversationRuntimeState
} from "./repository";
import type {
  LocalAiSdrAction,
  LocalAiSdrConversationState,
  LocalAiSdrDecision,
  LocalAiSdrDetail,
  LocalAiSdrOverview,
  LocalAiSdrState,
  LocalAiSdrToolName,
  LocalAiSdrTurnInput,
  LocalAiSdrTurnResult
} from "./types";
const DEFAULT_CHANNEL_ACCOUNT = "local_whatsapp";
const DEFAULT_EXECUTION_MODE = "simulate";

function parseNameFromMessage(messageText: string) {
  const normalized = messageText.replace(/[.,;:]/g, " ").replace(/\s+/g, " ").trim();
  const named = normalized.match(/(?:soy|me llamo|mi nombre es|nombre)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]{2,})\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]{2,})/i);
  if (named) {
    return { firstname: named[1], lastname: named[2] };
  }
  const words = normalized
    .split(/\s+/)
    .filter((word) => /^[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}$/.test(word) && word.length > 2)
    .slice(0, 2);
  if (words.length >= 2) {
    return { firstname: words[0], lastname: words[1] };
  }
  return null;
}

function buildToolDecision(input: {
  intent: string;
  action: LocalAiSdrAction;
  tool: LocalAiSdrToolName | null;
  args?: Record<string, unknown>;
  requiresCustomerConfirmation?: boolean;
  requiresHumanApproval?: boolean;
  confidence?: number;
  reason: string;
  policyTags?: string[];
}): LocalAiSdrDecision {
  return buildOperationalDecision({
    intent: input.intent,
    action: input.action,
    tool: input.tool,
    args: input.args,
    requiresCustomerConfirmation: input.requiresCustomerConfirmation,
    requiresHumanApproval: input.requiresHumanApproval,
    confidence: input.confidence,
    reason: input.reason,
    policyTags: input.policyTags
  });
}

function buildState(base: Partial<LocalAiSdrConversationState> = {}): LocalAiSdrConversationState {
  return {
    state: "unresolved",
    pendingAction: null,
    email: null,
    firstname: null,
    lastname: null,
    customerId: null,
    customerEmail: null,
    customerName: null,
    customerPlatformOrigin: null,
    linkStatus: null,
    lastDecisionId: null,
    lastToolName: null,
    lastToolStatus: null,
    lastToolResult: null,
    lastResponseText: null,
    reason: null,
    confidence: null,
    warnings: [],
    context: {},
    ...base
  };
}

function buildResponseText(state: LocalAiSdrState, name: string | null, email: string | null) {
  if (state === "email_requested") {
    return "Para continuar necesito el correo asociado a tu cuenta.";
  }
  if (state === "creation_offered") {
    return "No encontré una cuenta con ese correo. ¿Quieres que cree una cuenta nueva?";
  }
  if (state === "creation_confirmed") {
    return "Para crearla necesito tu nombre y apellido.";
  }
  if (state === "customer_found" || state === "customer_linked" || state === "completed") {
    if (name) return `Encontré tu cuenta a nombre de ${name}. Continuemos.`;
    if (email) return `Encontré tu cuenta con el correo ${email}. Continuemos.`;
    return "Encontré tu cuenta. Continuemos.";
  }
  if (state === "customer_created") {
    return "Listo, creé tu cuenta y quedó vinculada a esta conversación.";
  }
  if (state === "handoff" || state === "blocked") {
    return "No pude completar el flujo de forma segura. Voy a derivarlo para revisión.";
  }
  return "Quedo atento a tu siguiente mensaje.";
}

async function persistAudit(action: Parameters<typeof auditLog>[0]["action"], conversationId: string, payload: Record<string, unknown> = {}) {
  await auditLog({
    action,
    entityType: "ai_sdr_runtime",
    entityId: conversationId,
    after: payload
  });
}

async function ensureConversation(input: LocalAiSdrTurnInput) {
  if (input.conversationId) {
    const existing = await getConversationByPublicId(input.conversationId);
    if (existing?.conversation) return { publicId: input.conversationId, detail: existing };
  }
  const created = await createConversation({
    waId: input.waId ?? input.externalContactId ?? null,
    externalContactId: input.externalContactId ?? input.waId ?? null,
    channelAccountId: input.channelAccountId ?? DEFAULT_CHANNEL_ACCOUNT
  });
  const detail = created.detail ?? (await getConversationByPublicId(created.publicId));
  return { publicId: created.publicId, detail };
}

function buildLatestDetail(detail: LocalAiSdrDetail | null, state: LocalAiSdrConversationState): LocalAiSdrDetail | null {
  if (!detail) return null;
  return {
    ...detail,
    state,
    conversation: detail.conversation
      ? {
          ...detail.conversation,
          state: state.state,
          pendingAction: state.pendingAction,
          customerId: state.customerId ?? detail.conversation.customerId,
          customerName: state.customerName ?? detail.conversation.customerName,
          customerEmail: state.customerEmail ?? detail.conversation.customerEmail,
          customerPlatformOrigin: state.customerPlatformOrigin ?? detail.conversation.customerPlatformOrigin,
          warnings: uniqueStrings([...(detail.conversation.warnings ?? []), ...(state.warnings ?? [])])
        }
      : null,
    warnings: uniqueStrings([...(detail.warnings ?? []), ...(state.warnings ?? [])])
  };
}

async function recordToolLifecycle(input: {
  executionPublicId: string;
  decisionPublicId: string | null;
  toolName: LocalAiSdrToolName;
  request: Record<string, unknown>;
  result: Record<string, unknown>;
  status: "requested" | "executed" | "failed";
  idempotencyKey: string;
  startedAt: string;
  completedAt: string;
  errorMessage?: string | null;
}) {
  return insertAiToolExecution({
    executionPublicId: input.executionPublicId,
    decisionPublicId: input.decisionPublicId,
    toolName: input.toolName,
    inputPayload: input.request,
    outputPayload: input.result,
    status: input.status,
    idempotencyKey: input.idempotencyKey,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    errorMessage: input.errorMessage ?? null
  });
}

export async function getLocalAiSdrOverview(selectedConversationId?: string | null): Promise<LocalAiSdrOverview> {
  const conversations = await listLocalAiSdrConversations(20);
  const selectedId = selectedConversationId ?? conversations[0]?.publicId ?? null;
  const selectedConversation = selectedId ? await getConversationByPublicId(selectedId) : null;
  return {
    conversations,
    selectedConversationId: selectedId,
    selectedConversation,
    writeEnabled: isDbWriteEnabled(),
    executionMode: process.env.AI_SDR_EXECUTION_MODE ?? DEFAULT_EXECUTION_MODE,
    warnings: selectedConversation?.warnings ?? []
  };
}

export async function createLocalAiSdrConversation(input: { waId?: string | null; externalContactId?: string | null; customerId?: string | number | null; channelAccountId?: string | null }) {
  const created = await createConversation({
    waId: input.waId ?? input.externalContactId ?? null,
    externalContactId: input.externalContactId ?? input.waId ?? null,
    channelAccountId: input.channelAccountId ?? DEFAULT_CHANNEL_ACCOUNT,
    customerId: input.customerId ?? null
  });
  return getLocalAiSdrOverview(created.publicId);
}

export async function runLocalAiSdrTurn(input: LocalAiSdrTurnInput): Promise<LocalAiSdrTurnResult> {
  const currentTime = normalizeIso(input.currentTime);
  const currentTimeDb = currentTime.slice(0, 23).replace("T", " ");
  const conversation = await ensureConversation(input);
  const conversationId = conversation.publicId;
  const currentDetail = conversation.detail;
  const currentState = (await loadConversationRuntimeState(conversationId)) ?? buildState();
  const inboundMessageId = input.idempotencyKey ?? input.messageId ?? localPublicId("msg", [conversationId, input.messageText, currentTime]);
  const emails = extractEmailCandidates(input.messageText);
  const confirmation = isExplicitCustomerConfirmation(input.messageText);
  const warnings = uniqueStrings([
    ...(currentState.warnings ?? []),
    ...(emails.status === "ambiguous" ? ["ambiguous_email"] : []),
    ...(currentDetail?.warnings ?? [])
  ]);

  if (!isDbWriteEnabled()) {
    const state = buildState({
      ...currentState,
      state: "handoff",
      pendingAction: null,
      lastResponseText: "No pude completar la creación en este momento. Voy a derivarlo para revisión.",
      reason: "DB writes disabled",
      warnings: uniqueStrings([...warnings, "db_write_disabled"])
    });
    return {
      ok: false,
      conversationId,
      responseText: state.lastResponseText,
      decision: buildToolDecision({
        intent: "db_write_disabled",
        action: "handoff",
        tool: null,
        args: { conversationId },
        requiresHumanApproval: true,
        confidence: 0.2,
        reason: "DB writes are disabled.",
        policyTags: ["db_write_disabled"]
      }),
      state,
      customer: currentDetail?.customer ?? null,
      detail: buildLatestDetail(currentDetail, state),
      warnings: state.warnings,
      errors: ["DB_WRITE_DISABLED"]
    };
  }

  const execution = await insertAiAgentExecution({
    conversationPublicId: conversationId,
    triggerMessageId: inboundMessageId,
    customerId: currentDetail?.conversation?.customerId ?? null,
    triggerType: "inbound_message",
    executionMode: process.env.AI_SDR_EXECUTION_MODE ?? DEFAULT_EXECUTION_MODE,
    status: "running",
    startedAt: currentTime
  });
  if (!execution.ok || !execution.execution) {
    return {
      ok: false,
      conversationId,
      responseText: null,
      decision: buildToolDecision({
        intent: "execution_persistence_failed",
        action: "handoff",
        tool: null,
        args: { conversationId },
        requiresHumanApproval: true,
        confidence: 0.1,
        reason: execution.error ?? "execution_persistence_failed",
        policyTags: ["persistence_error"]
      }),
      state: currentState,
      customer: currentDetail?.customer ?? null,
      detail: currentDetail,
      warnings,
      errors: [execution.error ?? "execution_persistence_failed"]
    };
  }

  const executionPublicId = execution.execution.public_id;
  const resultState = buildState({ ...currentState });
  let decisionIntent = "no_customer_onboarding";
  let decisionAction: LocalAiSdrAction = "no_action";
  let decisionTool: LocalAiSdrToolName | null = null;
  let responseText: string | null = null;
  let customer = currentDetail?.customer ?? null;
  let customerContext = customer ? await getCustomerContext({ customerId: customer.id, email: customer.email, conversationCaseId: conversationId }) : null;
  let latestToolOutput: Record<string, unknown> = {};
  let latestToolName: LocalAiSdrToolName | null = null;
  let latestToolStatus: string | null = null;

  const conversationHasLinkedCustomer = Boolean(currentDetail?.conversation?.customerId && currentDetail.customer);
  const linkedEmail = currentDetail?.customer?.email ?? currentState.customerEmail ?? null;

  if (conversationHasLinkedCustomer) {
    if (emails.status === "single" && linkedEmail && emails.emails[0] !== linkedEmail.trim().toLowerCase()) {
      decisionIntent = "email_conflict";
      decisionAction = "handoff";
      decisionTool = null;
      responseText = "Veo una diferencia entre el correo que tengo y el que me compartiste. Voy a derivarlo para revisión.";
      resultState.state = "handoff";
      resultState.pendingAction = null;
      resultState.reason = "Linked customer email conflicts with the inbound email.";
      resultState.warnings = uniqueStrings([...warnings, "email_conflict"]);
    } else {
      decisionIntent = "customer_already_linked";
      decisionAction = "continue_sales_flow";
      decisionTool = "get_customer_context";
      responseText = buildResponseText("completed", getCustomerOnboardingDisplayName(customer), customer?.email ?? null);
      resultState.state = "completed";
      resultState.pendingAction = null;
      resultState.reason = "Conversation already has a linked customer.";
      resultState.customerId = customer?.id ?? currentState.customerId;
      resultState.customerEmail = customer?.email ?? currentState.customerEmail;
      resultState.customerName = getCustomerOnboardingDisplayName(customer);
      resultState.customerPlatformOrigin = customer?.platformOrigin ?? currentState.customerPlatformOrigin;
      latestToolName = "get_customer_context";
      latestToolStatus = "executed";
      latestToolOutput = customerContext ? { status: "partial", warnings: customerContext.warnings } : { status: "unavailable" };
    }
  } else if (emails.status === "ambiguous") {
    decisionIntent = "ambiguous_email";
    decisionAction = "handoff";
    decisionTool = null;
    responseText = "Recibí más de un correo. ¿Cuál debo usar para tu cuenta?";
    resultState.state = "blocked";
    resultState.pendingAction = null;
    resultState.reason = "Multiple emails were found in the message.";
    resultState.warnings = uniqueStrings([...warnings, "ambiguous_email"]);
  } else if (emails.status === "absent" && currentState.pendingAction !== "create_customer") {
    decisionIntent = "missing_email";
    decisionAction = "ask_email";
    decisionTool = null;
    responseText = buildResponseText("email_requested", null, null);
    resultState.state = "email_requested";
    resultState.pendingAction = "lookup_customer";
    resultState.reason = "Email is required to continue.";
  } else if (emails.status === "single") {
    const email = emails.emails[0];
    decisionIntent = "email_received";
    decisionAction = "lookup_customer";
      decisionTool = "lookup_customer_by_email";
      responseText = null;
      resultState.state = "email_received";
      resultState.pendingAction = "lookup_customer";
      resultState.email = email;
      resultState.reason = "Email received and lookup started.";
    const lookupRequested = await recordToolLifecycle({
      executionPublicId,
      decisionPublicId: null,
      toolName: "lookup_customer_by_email",
      request: { email, conversationId },
      result: { status: "requested", email },
      status: "requested",
      idempotencyKey: localPublicId("lookup", [conversationId, email]),
      startedAt: currentTime,
      completedAt: currentTime
    });
    void lookupRequested;
    await persistAudit("ai_sdr.tool.requested", conversationId, { tool: "lookup_customer_by_email", email });

    const lookupResult = await lookupCustomerByEmail({ email, conversationCaseId: conversationId, correlationId: inboundMessageId });
    latestToolName = "lookup_customer_by_email";
    latestToolStatus = "executed";
    latestToolOutput = lookupResult as Record<string, unknown>;
    await recordToolLifecycle({
      executionPublicId,
      decisionPublicId: null,
      toolName: "lookup_customer_by_email",
      request: { email, conversationId },
      result: lookupResult as Record<string, unknown>,
      status: "executed",
      idempotencyKey: localPublicId("lookup", [conversationId, email]),
      startedAt: currentTime,
      completedAt: currentTime
    });
    await persistAudit("ai_sdr.tool.executed", conversationId, { tool: "lookup_customer_by_email", email, status: lookupResult.status });

    if (lookupResult.status === "found" && lookupResult.customer) {
      customer = lookupResult.customer;
      const existingDetail = await getConversationByPublicId(conversationId);
      if (existingDetail?.conversation?.customerId && existingDetail.conversation.customerId !== customer.id) {
        decisionIntent = "link_conflict";
        decisionAction = "handoff";
        decisionTool = null;
        resultState.state = "handoff";
        resultState.pendingAction = null;
        resultState.reason = "Conversation already linked to a different customer.";
        resultState.warnings = uniqueStrings([...warnings, "conversation_customer_conflict"]);
        responseText = "Ya existe una vinculación distinta para esta conversación. Voy a derivarlo para revisión.";
        await persistAudit("customer.link.failed", conversationId, {
          customerId: customer.id,
          conversationId,
          source: "local_ai_sdr",
          reason: "conversation_customer_conflict"
        });
      } else {
        await queryRows("UPDATE conversation SET customer_id = ?, updated_at = ? WHERE public_id = ?", [customer.id, currentTimeDb, conversationId]);
        decisionIntent = "customer_found";
        decisionAction = "link_customer";
        decisionTool = "link_customer_to_conversation";
        resultState.state = "customer_linked";
        resultState.pendingAction = null;
        resultState.customerId = customer.id;
        resultState.customerEmail = customer.email;
        resultState.customerName = getCustomerOnboardingDisplayName(customer);
        resultState.customerPlatformOrigin = customer.platformOrigin;
        resultState.linkStatus = "linked";
        resultState.reason = "Exact email match linked to the conversation.";
        responseText = buildResponseText("customer_linked", resultState.customerName, customer.email);
        latestToolName = "link_customer_to_conversation";
        latestToolStatus = "executed";
        latestToolOutput = {
          status: "linked",
          customerId: customer.id,
          conversationId
        };
        await recordToolLifecycle({
          executionPublicId,
          decisionPublicId: null,
          toolName: "link_customer_to_conversation",
          request: { customerId: customer.id, conversationId, source: "local_ai_sdr", confidence: "high" },
          result: latestToolOutput,
          status: "executed",
          idempotencyKey: localPublicId("link", [conversationId, customer.id]),
          startedAt: currentTime,
          completedAt: currentTime
        });
        await persistAudit("ai_sdr.tool.executed", conversationId, {
          tool: "link_customer_to_conversation",
          customerId: customer.id,
          conversationId,
          source: "local_ai_sdr"
        });
        await persistAudit("customer.linked", conversationId, {
          customerId: customer.id,
          conversationId,
          email,
          source: "local_ai_sdr",
          confidence: "high",
          timestamp: currentTime
        });
      }
      customerContext = await getCustomerContext({ customerId: customer.id, email: customer.email, conversationCaseId: conversationId });
      latestToolOutput = { ...latestToolOutput, customerId: customer.id, linked: resultState.state === "customer_linked" };
    } else if (lookupResult.status === "not_found") {
      decisionIntent = "customer_not_found";
      decisionAction = "offer_customer_creation";
      decisionTool = null;
      resultState.state = "creation_offered";
      resultState.pendingAction = "create_customer";
      resultState.email = lookupResult.normalizedEmail;
      resultState.reason = "No exact customer match was found.";
      responseText = buildResponseText("creation_offered", null, lookupResult.normalizedEmail);
      await persistAudit("customer.creation.offered", conversationId, {
        email: lookupResult.normalizedEmail,
        source: "local_ai_sdr"
      });
    } else {
      decisionIntent = "lookup_conflict";
      decisionAction = "handoff";
      decisionTool = null;
      resultState.state = "blocked";
      resultState.pendingAction = null;
      resultState.reason = "Lookup returned a conflict.";
      resultState.warnings = uniqueStrings([...warnings, "lookup_conflict"]);
      responseText = "Encontramos más de una cuenta posible. Voy a derivarlo para revisión.";
    }
  } else if (currentState.pendingAction === "create_customer" || currentState.state === "creation_offered") {
    decisionIntent = "customer_creation_confirmation";
    const confirmed = confirmation.status === "explicit";
    if (!confirmed) {
      decisionAction = "no_action";
      decisionTool = null;
      resultState.state = "creation_offered";
      resultState.pendingAction = "create_customer";
      resultState.reason = "Creation was not explicitly confirmed.";
      responseText = "Quedo atento a tu confirmación para crear la cuenta.";
    } else {
      const suggestedName = parseNameFromMessage(input.messageText) ?? (currentState.firstname && currentState.lastname ? { firstname: currentState.firstname, lastname: currentState.lastname } : null);
      const email = currentState.email ?? emails.emails[0] ?? null;
      if (!email) {
        decisionAction = "ask_email";
        decisionTool = null;
        resultState.state = "email_requested";
        resultState.pendingAction = "lookup_customer";
        resultState.reason = "Creation confirmation arrived without an email.";
        responseText = buildResponseText("email_requested", null, null);
      } else if (!suggestedName?.firstname || !suggestedName?.lastname) {
        decisionAction = "create_customer";
        decisionTool = null;
        resultState.state = "creation_confirmed";
        resultState.pendingAction = "create_customer";
        resultState.email = email;
        resultState.reason = "Customer confirmation received but the name is incomplete.";
        responseText = buildResponseText("creation_confirmed", null, email);
      } else {
        decisionAction = "create_customer";
        decisionTool = "create_customer";
        resultState.state = "customer_created";
        resultState.pendingAction = "link_customer";
        resultState.email = email;
        resultState.firstname = suggestedName.firstname;
        resultState.lastname = suggestedName.lastname;
        resultState.reason = "Customer created and linked successfully.";

        const policy = assessCustomerOnboardingToolPolicy("create_customer", {
          customerConfirmed: true,
          conflict: false,
          dbWriteEnabled: true
        });
        if (!policy.allowed) {
          decisionAction = "handoff";
          decisionTool = null;
          resultState.state = "handoff";
          resultState.pendingAction = null;
          resultState.reason = policy.reason;
          resultState.warnings = uniqueStrings([...warnings, "creation_not_allowed"]);
          responseText = "No pude completar la creación en este momento. Voy a derivarlo para revisión.";
        } else {
          try {
            await recordToolLifecycle({
              executionPublicId,
              decisionPublicId: null,
              toolName: "create_customer",
              request: {
                firstname: suggestedName.firstname,
                lastname: suggestedName.lastname,
                email,
                platformOrigin: "whatsapp",
                customerConfirmed: true
              },
              result: { status: "requested", email },
              status: "requested",
              idempotencyKey: localPublicId("create", [conversationId, email, suggestedName.firstname, suggestedName.lastname]),
              startedAt: currentTime,
              completedAt: currentTime
            });
            await persistAudit("ai_sdr.tool.requested", conversationId, { tool: "create_customer", email });
            const created = await createCustomer({
              firstname: suggestedName.firstname,
              lastname: suggestedName.lastname,
              email,
              platformOrigin: "whatsapp"
            });
            customer = created.customer;
            customerContext = customer ? await getCustomerContext({ customerId: customer.id, email: customer.email, conversationCaseId: conversationId }) : null;
            resultState.customerId = customer?.id ?? null;
            resultState.customerEmail = customer?.email ?? email;
            resultState.customerName = getCustomerOnboardingDisplayName(customer);
            resultState.customerPlatformOrigin = customer?.platformOrigin ?? "whatsapp";
            latestToolName = "create_customer";
            latestToolStatus = "executed";
            latestToolOutput = { status: "created", customerId: customer?.id ?? null };
            await recordToolLifecycle({
              executionPublicId,
              decisionPublicId: null,
              toolName: "create_customer",
              request: {
                firstname: suggestedName.firstname,
                lastname: suggestedName.lastname,
                email,
                platformOrigin: "whatsapp",
                customerConfirmed: true
              },
              result: { status: "created", customerId: customer?.id ?? null },
              status: "executed",
              idempotencyKey: localPublicId("create", [conversationId, email, suggestedName.firstname, suggestedName.lastname]),
              startedAt: currentTime,
              completedAt: currentTime
            });
            await persistAudit("ai_sdr.tool.executed", conversationId, {
              tool: "create_customer",
              customerId: customer?.id ?? null,
              email
            });
            await queryRows("UPDATE conversation SET customer_id = ?, updated_at = ? WHERE public_id = ?", [customer?.id ?? null, currentTimeDb, conversationId]);
            await persistAudit("customer.created", conversationId, {
              customerId: customer?.id ?? null,
              source: "local_ai_sdr",
              changedFields: ["firstname", "lastname", "email", "platform_origin"],
              platformOrigin: "whatsapp"
            });
            await persistAudit("customer.linked", conversationId, {
              customerId: customer?.id ?? null,
              conversationId,
              source: "local_ai_sdr",
              confidence: "high",
              timestamp: currentTime
            });
            resultState.state = "customer_linked";
            resultState.pendingAction = null;
            resultState.linkStatus = "linked";
            responseText = buildResponseText("customer_created", resultState.customerName, customer?.email ?? email);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            latestToolStatus = "failed";
            latestToolOutput = { status: "failed", error: message };
            resultState.state = "handoff";
            resultState.pendingAction = null;
            resultState.reason = message;
            resultState.warnings = uniqueStrings([...warnings, message]);
            responseText = "No pude completar la creación en este momento. Voy a derivarlo para revisión.";
            await persistAudit("ai_sdr.tool.failed", conversationId, { tool: "create_customer", error: message });
            await persistAudit("ai_sdr.handoff.requested", conversationId, { reason: message });
          }
        }
      }
    }
  } else {
    decisionIntent = "continue_sales_flow";
    decisionAction = "continue_sales_flow";
    decisionTool = "get_customer_context";
    responseText = customer ? buildResponseText("completed", getCustomerOnboardingDisplayName(customer), customer.email) : null;
    resultState.state = currentState.state ?? "unresolved";
    resultState.pendingAction = currentState.pendingAction ?? null;
    resultState.reason = "No onboarding action was required.";
  }

  const finalDecision = buildToolDecision({
    intent: decisionIntent,
    action: decisionAction,
    tool: decisionTool,
    args: {
      conversationId,
      email: resultState.email ?? (emails.status === "single" ? emails.emails[0] : null)
    },
    requiresCustomerConfirmation: decisionAction === "create_customer",
    requiresHumanApproval: decisionAction === "handoff",
    confidence: decisionAction === "handoff" ? 0.2 : 0.85,
    reason: resultState.reason ?? "Local simulator decision",
    policyTags: assessCustomerOnboardingToolPolicy(decisionAction, {
      customerConfirmed: confirmation.status === "explicit",
      conflict: decisionAction === "handoff",
      dbWriteEnabled: true
    }).policyTags
  });

  resultState.lastDecisionId = localPublicId("decision", [conversationId, finalDecision.action, finalDecision.intent, currentTime]);
  resultState.lastToolName = latestToolName;
  resultState.lastToolStatus = latestToolStatus;
  resultState.lastToolResult = latestToolOutput;
  resultState.lastResponseText = responseText;
  resultState.confidence = finalDecision.confidence;
  resultState.warnings = uniqueStrings([...warnings, ...(resultState.warnings ?? [])]);

  const decision = await insertAiAgentDecision({
    executionPublicId,
    intent: finalDecision.intent,
    action: finalDecision.action,
    toolName: finalDecision.tool,
    confidence: finalDecision.confidence,
    requiresCustomerConfirmation: finalDecision.requiresCustomerConfirmation,
    requiresHumanApproval: finalDecision.requiresHumanApproval,
    policyTags: finalDecision.policyTags,
    arguments: finalDecision.arguments,
    reasonSummary: finalDecision.reason
  });

  if (decision.ok && decision.decision) {
    resultState.lastDecisionId = decision.decision.public_id;
  }

  await saveConversationRuntimeState({
    conversationPublicId: conversationId,
    state: resultState
  });

  await appendConversationMessage({
    conversationPublicId: conversationId,
    provider: "local_ai_sdr",
    providerMessageId: inboundMessageId,
    direction: "inbound",
    senderType: "customer",
    messageType: "text",
    body: input.messageText,
    status: "received",
    occurredAt: currentTime
  });

  if (responseText) {
    await appendConversationMessage({
      conversationPublicId: conversationId,
      provider: "local_ai_sdr",
      providerMessageId: localPublicId("reply", [conversationId, inboundMessageId, currentTime]),
      direction: "outbound",
      senderType: "ai_sdr",
      messageType: "text",
      body: responseText,
      status: "sent",
      occurredAt: currentTime
    });
  }

  await queryRows(
    "UPDATE ai_agent_execution SET status = ?, completed_at = ?, error_code = ?, error_message = ? WHERE public_id = ?",
    [resultState.state === "handoff" || resultState.state === "blocked" ? "completed_with_handoff" : "completed", currentTimeDb, null, null, executionPublicId]
  );

  await persistAudit("ai_sdr.decision.created", conversationId, {
    decisionId: resultState.lastDecisionId,
    action: finalDecision.action,
    tool: finalDecision.tool,
    result: resultState.state,
    reason: finalDecision.reason,
    confidence: finalDecision.confidence
  });

  const detail = await getConversationByPublicId(conversationId);
  const latestDetail = buildLatestDetail(detail, resultState);
  return {
    ok: true,
    conversationId,
    responseText,
    decision: finalDecision,
    state: resultState,
    customer,
    detail: latestDetail,
    warnings: resultState.warnings,
    errors: []
  };
}
