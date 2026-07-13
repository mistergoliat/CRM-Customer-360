import { createHash } from "node:crypto";
import { auditCustomerOnboardingEvent } from "./audit";
import { buildCustomerOnboardingContext, extractEmailCandidates, getCustomerOnboardingDisplayName, isExplicitCustomerConfirmation } from "./context";
import { buildOperationalDecision, assessCustomerOnboardingToolPolicy } from "./policy";
import type {
  AiSdrOperationalDecision,
  CustomerConversationLinkRecord,
  CustomerLookupResult,
  CustomerOnboardingRunInput,
  CustomerOnboardingRunResult,
  CustomerOnboardingStateRecord,
  CustomerOnboardingToolRun
} from "./types";
import {
  loadCustomerOnboardingSnapshot,
  persistCustomerOnboardingState
} from "./state";
import { createCustomerTool } from "@/lib/brain/tools/customers/create-customer";
import { getCustomerContext } from "@/lib/brain/tools/customers/get-customer-context";
import { linkCustomerToConversation } from "@/lib/brain/tools/customers/link-customer-to-conversation";
import { lookupCustomerByEmail } from "@/lib/brain/tools/customers/lookup-customer-by-email";
import type { PlatformOrigin } from "@/lib/domains/customers/platform-origin";
import type { CustomerOnboardingCustomerContext } from "./types";

function toIsoString(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function stableDecisionId(input: CustomerOnboardingRunInput, action: string, state: string) {
  const hash = createHash("sha256");
  hash.update([
    input.correlationId,
    String(input.conversationCaseId ?? ""),
    String(input.messageId ?? ""),
    action,
    state,
    input.messageText
  ].join("|"));
  return `customer-onboarding-${hash.digest("hex").slice(0, 24)}`;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

function extractSuggestedName(messageText: string) {
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

function buildDecision(input: {
  intent: string;
  action: AiSdrOperationalDecision["action"];
  tool: AiSdrOperationalDecision["tool"];
  args?: Record<string, unknown>;
  requiresCustomerConfirmation?: boolean;
  requiresHumanApproval?: boolean;
  confidence?: number;
  reason: string;
  policyTags?: string[];
}): AiSdrOperationalDecision {
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

function buildToolRun<TStatus extends "requested" | "executed" | "failed" | "blocked">(
  tool: AiSdrOperationalDecision["tool"],
  status: TStatus,
  request: Record<string, unknown>,
  result: Record<string, unknown>,
  warnings: string[] = []
): CustomerOnboardingToolRun<TStatus, Record<string, unknown>> {
  return {
    tool: tool ?? "get_customer_context",
    status,
    request,
    result,
    warnings
  } as CustomerOnboardingToolRun<TStatus, Record<string, unknown>>;
}

function buildResponseText(state: string, name: string | null, email: string | null) {
  if (state === "ask_email") {
    return "Para continuar necesito el correo asociado a tu cuenta.";
  }
  if (state === "offer_customer_creation") {
    return "No encontre una cuenta con ese correo. Quieres que cree una cuenta nueva?";
  }
  if (state === "creation_confirmed") {
    return "Para crearla necesito tu nombre y apellido.";
  }
  if (state === "customer_found") {
    return name ? `Encontré tu cuenta a nombre de ${name}. Continuemos.` : email ? `Encontré tu cuenta con el correo ${email}. Continuemos.` : "Encontré tu cuenta. Continuemos.";
  }
  if (state === "customer_created") {
    return "Listo, cree tu cuenta y quedo vinculada a esta conversacion.";
  }
  if (state === "handoff") {
    return "No pude completar el flujo de forma segura. Voy a derivarlo para revision.";
  }
  return null;
}

async function persistDecisionState(input: {
  run: CustomerOnboardingRunInput;
  state: CustomerOnboardingStateRecord["state"];
  pendingAction: CustomerOnboardingStateRecord["pendingAction"];
  pendingCustomerConfirmation: boolean;
  email?: string | null;
  firstname?: string | null;
  lastname?: string | null;
  customerId?: string | null;
  customerPlatformOrigin?: PlatformOrigin | null;
  linkStatus?: string | null;
  lastDecisionId: string;
  lastToolName?: string | null;
  lastToolStatus?: string | null;
  lastToolResult?: Record<string, unknown> | null;
  lastResponseText?: string | null;
  reason?: string | null;
  confidence?: number | null;
  warnings?: string[];
  context?: Record<string, unknown>;
}) {
  return persistCustomerOnboardingState({
    conversationCaseId: input.run.conversationCaseId ?? input.run.messageId ?? input.run.correlationId,
    waId: input.run.waId,
    state: input.state,
    pendingAction: input.pendingAction,
    pendingCustomerConfirmation: input.pendingCustomerConfirmation,
    email: input.email ?? null,
    firstname: input.firstname ?? null,
    lastname: input.lastname ?? null,
    customerId: input.customerId ?? null,
    customerPlatformOrigin: input.customerPlatformOrigin ?? null,
    linkStatus: input.linkStatus ?? null,
    lastDecisionId: input.lastDecisionId,
    lastToolName: input.lastToolName ?? null,
    lastToolStatus: input.lastToolStatus ?? null,
    lastToolResult: input.lastToolResult ?? null,
    lastResponseText: input.lastResponseText ?? null,
    reason: input.reason ?? null,
    confidence: input.confidence ?? null,
    warnings: input.warnings ?? [],
    context: input.context ?? {},
    currentTime: toIsoString(input.run.currentTime)
  });
}

function normalizeLookupWarnings(result: CustomerLookupResult) {
  return result.warnings ?? [];
}

export async function runCustomerOnboardingLoop(input: CustomerOnboardingRunInput): Promise<CustomerOnboardingRunResult> {
  const currentTime = toIsoString(input.currentTime);
  const snapshot = await loadCustomerOnboardingSnapshot(input.conversationCaseId ?? input.messageId ?? input.correlationId);
  const currentState = snapshot.state;
  const currentLink = snapshot.link;
  const normalizedEmailResult = extractEmailCandidates(input.messageText);
  const explicitConfirmation = isExplicitCustomerConfirmation(input.messageText);
  const browserContext = input.brainContext ?? {};
  const onboardingContext = buildCustomerOnboardingContext({
    inboundMessage: {
      channel: "whatsapp",
      source: "manual_test",
      contextMode: "minimal",
      waId: input.waId ?? "",
      phoneNumberId: "unknown",
      messageId: input.messageId ?? "unknown",
      messageText: input.messageText,
      conversationCaseId: input.conversationCaseId ?? undefined,
      options: {
        dryRun: true,
        executeActions: false,
        returnInstructionsForN8n: true,
        debug: false,
        runAgentDryRun: false,
        buildExecutionPlanDryRun: false
      },
      metadata: {}
    },
    brainContext: browserContext as never,
    currentState,
    currentLink,
    customerContext: null
  });

  const warnings = uniqueStrings([...snapshot.warnings, ...(normalizedEmailResult.status === "ambiguous" ? ["ambiguous_email"] : [])]);
  const toolRuns: Array<CustomerOnboardingRunResult["toolRuns"][number]> = [];
  const auditEvents: string[] = [];
  const confirmedCustomer = explicitConfirmation.status === "explicit";
  const linkedCustomerId = currentLink?.customerId ?? currentState?.customerId ?? null;
  let state = currentState?.state ?? "unresolved";
  let pendingAction = currentState?.pendingAction ?? null;
  let pendingCustomerConfirmation = currentState?.pendingCustomerConfirmation ?? false;
  let responseText: string | null = null;
  let decisionReason = "No onboarding action was required.";
  let decisionAction: AiSdrOperationalDecision["action"] = "no_action";
  let decisionTool: AiSdrOperationalDecision["tool"] = null;
  let decisionIntent = "no_customer_onboarding";
  let customer = null;
  let customerContext: CustomerOnboardingCustomerContext | null = null;
  let dataQuality: CustomerOnboardingCustomerContext["dataQuality"] = {
    status: "unavailable" as const,
    warnings: [] as string[],
    source: "customer_master"
  };
  let link: CustomerConversationLinkRecord | null = currentLink ?? null;

  const currentLinkedCustomerContext = linkedCustomerId ? await getCustomerContext({ customerId: linkedCustomerId, conversationCaseId: input.conversationCaseId }) : null;
  if (currentLinkedCustomerContext) {
    customerContext = currentLinkedCustomerContext;
    customer = currentLinkedCustomerContext.customer;
    dataQuality = currentLinkedCustomerContext.dataQuality;
  }

  if (currentLink && currentLink.customerId) {
    const linkedEmail = currentLinkedCustomerContext?.customer?.email ?? currentState?.email ?? null;
    if (normalizedEmailResult.status === "single" && linkedEmail && normalizedEmailResult.emails[0] !== linkedEmail.toLowerCase()) {
      decisionAction = "handoff";
      decisionTool = null;
      decisionIntent = "email_conflict";
      state = "handoff";
      pendingAction = null;
      pendingCustomerConfirmation = false;
      responseText = "Veo una diferencia entre el correo que tengo y el que me compartiste. Voy a derivarlo para revision.";
      decisionReason = "Linked customer email conflicts with the inbound email.";
      warnings.push("email_conflict");
      auditEvents.push("ai_sdr.handoff.requested");
    } else {
      decisionAction = "continue_sales_flow";
      decisionTool = "get_customer_context";
      decisionIntent = "customer_already_linked";
      state = "completed";
      pendingAction = null;
      pendingCustomerConfirmation = false;
      responseText = buildResponseText("customer_found", getCustomerOnboardingDisplayName(customer), customer?.email ?? null);
      decisionReason = "Conversation already has a linked customer.";
    }
  } else if (normalizedEmailResult.status === "ambiguous") {
    decisionAction = "handoff";
    decisionTool = null;
    decisionIntent = "ambiguous_email";
    state = "blocked";
    pendingAction = null;
    pendingCustomerConfirmation = false;
    responseText = "Recibi mas de un correo. Cual debo usar para tu cuenta?";
    decisionReason = "Multiple emails were found in the message.";
    warnings.push("ambiguous_email");
    auditEvents.push("ai_sdr.handoff.requested");
  } else if (normalizedEmailResult.status === "absent" && !pendingCustomerConfirmation) {
    decisionAction = "ask_email";
    decisionTool = null;
    decisionIntent = "missing_email";
    state = "email_requested";
    pendingAction = "lookup_customer";
    pendingCustomerConfirmation = false;
    responseText = buildResponseText("ask_email", null, null);
    decisionReason = "Email is required to continue.";
  } else if (normalizedEmailResult.status === "single") {
    const email = normalizedEmailResult.emails[0];
    decisionAction = "lookup_customer";
    decisionTool = "lookup_customer_by_email";
    decisionIntent = "email_received";
    pendingAction = "lookup_customer";
    pendingCustomerConfirmation = false;
    responseText = null;

    const lookupRequested = buildToolRun("lookup_customer_by_email", "requested", { email, conversationCaseId: input.conversationCaseId }, { status: "requested", email });
    toolRuns.push(lookupRequested);
    auditEvents.push("ai_sdr.tool.requested");

    const lookupResult = await lookupCustomerByEmail({
      email,
      conversationCaseId: input.conversationCaseId,
      correlationId: input.correlationId
    });
    toolRuns.push(
      buildToolRun(
        "lookup_customer_by_email",
        "executed",
        { email, conversationCaseId: input.conversationCaseId },
        lookupResult,
        normalizeLookupWarnings(lookupResult)
      )
    );
    auditEvents.push("ai_sdr.tool.executed");

    if (lookupResult.status === "found" && lookupResult.customer) {
      customer = lookupResult.customer;
      customerContext = await getCustomerContext({ customerId: lookupResult.customer.id, conversationCaseId: input.conversationCaseId });
      dataQuality = customerContext.dataQuality;
      responseText = buildResponseText("customer_found", getCustomerOnboardingDisplayName(lookupResult.customer), lookupResult.customer.email ?? email);
      state = "customer_found";
      decisionAction = "link_customer";
      pendingAction = null;
      const linkResult = await linkCustomerToConversation({
        customerId: lookupResult.customer.id,
        conversationCaseId: input.conversationCaseId ?? input.messageId ?? input.correlationId,
        source: "ai_sdr",
        confidence: "high",
        correlationId: input.correlationId
      });
      link = linkResult.link ?? link;
      if (linkResult.status === "conflict") {
        state = "handoff";
        decisionAction = "handoff";
        decisionIntent = "link_conflict";
        responseText = "Ya existe una vinculacion distinta para esta conversacion. Voy a derivarlo para revision.";
        warnings.push("conversation_case_already_linked");
        auditEvents.push("ai_sdr.handoff.requested");
      } else if (linkResult.status === "unavailable") {
        state = "blocked";
        decisionAction = "handoff";
        decisionIntent = "link_unavailable";
        responseText = "No pude completar el vinculo en este momento. Voy a derivarlo para revision.";
        warnings.push(...linkResult.warnings);
        auditEvents.push("ai_sdr.handoff.requested");
      } else {
        state = "customer_linked";
        decisionAction = "link_customer";
        decisionIntent = "customer_found";
        pendingAction = null;
        responseText = buildResponseText("customer_found", getCustomerOnboardingDisplayName(lookupResult.customer), lookupResult.customer.email ?? email);
        auditEvents.push("customer.linked");
      }
      if (linkResult.status !== "unavailable") {
        const persisted = await persistDecisionState({
          run: input,
          state,
          pendingAction,
          pendingCustomerConfirmation,
          email,
          firstname: customer?.firstname ?? null,
          lastname: customer?.lastname ?? null,
          customerId: customer?.id ?? null,
          customerPlatformOrigin: customer?.platformOrigin ?? null,
          linkStatus: link?.linkStatus ?? null,
          lastDecisionId: stableDecisionId(input, decisionAction, state),
          lastToolName: "lookup_customer_by_email",
          lastToolStatus: "executed",
          lastToolResult: lookupResult as Record<string, unknown>,
          lastResponseText: responseText,
          reason: decisionReason,
          confidence: 0.92,
          warnings,
          context: {
            email,
            lookupStatus: lookupResult.status,
            correlationId: input.correlationId
          }
        });
        return {
          ok: true,
          state: persisted.state,
          decision: buildDecision({
            intent: decisionIntent,
            action: decisionAction,
            tool: decisionTool,
            args: { email, customerId: customer?.id ?? null, conversationCaseId: input.conversationCaseId },
            requiresCustomerConfirmation: false,
            requiresHumanApproval: false,
            confidence: 0.92,
            reason: decisionReason,
            policyTags: ["exact_email_lookup", "exact_link"]
          }),
          toolRuns,
          responseText,
          warnings,
          errors: [],
          customer,
          customerContext,
          dataQuality,
          link,
          persisted: persisted.ok,
          auditEvents,
          metadata: {
            correlationId: input.correlationId,
            state,
            currentTime
          }
        };
      }
    } else if (lookupResult.status === "not_found") {
      decisionAction = "offer_customer_creation";
      decisionTool = null;
      decisionIntent = "customer_not_found";
      state = "creation_offered";
      pendingAction = "create_customer";
      pendingCustomerConfirmation = true;
      responseText = buildResponseText("offer_customer_creation", null, email);
      decisionReason = "No exact customer match was found.";
      auditEvents.push("customer.creation.offered");
    } else {
      decisionAction = "handoff";
      decisionTool = null;
      decisionIntent = "lookup_conflict";
      state = "blocked";
      pendingAction = null;
      pendingCustomerConfirmation = false;
      responseText = "Encontramos mas de una cuenta posible. Voy a derivarlo para revision.";
      decisionReason = "Lookup returned a conflict.";
      warnings.push("lookup_conflict");
      auditEvents.push("ai_sdr.handoff.requested");
    }
  } else if (pendingCustomerConfirmation || state === "creation_offered") {
    decisionIntent = "customer_creation_confirmation";
    if (!confirmedCustomer) {
      decisionAction = "no_action";
      decisionTool = null;
      state = "creation_offered";
      pendingAction = "create_customer";
      pendingCustomerConfirmation = true;
      responseText = "Quedo atento a tu confirmacion para crear la cuenta.";
      decisionReason = "Creation was not explicitly confirmed.";
    } else {
      const suggestedName = extractSuggestedName(input.messageText) ?? (onboardingContext.customerContext?.customer
        ? {
            firstname: onboardingContext.customerContext.customer.firstname || null,
            lastname: onboardingContext.customerContext.customer.lastname || null
          }
        : null);
      const email = currentState?.email ?? normalizedEmailResult.emails[0] ?? null;
      if (!email) {
        decisionAction = "ask_email";
        decisionTool = null;
        state = "email_requested";
        pendingAction = "lookup_customer";
        pendingCustomerConfirmation = false;
        responseText = buildResponseText("ask_email", null, null);
        decisionReason = "Creation confirmation arrived without an email.";
      } else if (!suggestedName?.firstname || !suggestedName?.lastname) {
        decisionAction = "create_customer";
        decisionTool = null;
        state = "creation_confirmed";
        pendingAction = "create_customer";
        pendingCustomerConfirmation = true;
        responseText = buildResponseText("creation_confirmed", null, email);
        decisionReason = "Customer confirmation received but the name is incomplete.";
      } else {
        decisionAction = "create_customer";
        decisionTool = "create_customer";
        state = "customer_created";
        pendingAction = "link_customer";
        pendingCustomerConfirmation = false;
        responseText = null;

        const policy = assessCustomerOnboardingToolPolicy("create_customer", {
          customerConfirmed: true,
          conflict: false,
          dbWriteEnabled: input.writeEnabled ?? true
        });
        if (!policy.allowed) {
          decisionAction = "handoff";
          decisionTool = null;
          state = "blocked";
          responseText = "No pude completar la creacion en este momento. Voy a derivarlo para revision.";
          decisionReason = policy.reason;
          warnings.push("db_write_disabled");
          auditEvents.push("ai_sdr.handoff.requested");
        } else {
          const createRequested = buildToolRun("create_customer", "requested", {
            firstname: suggestedName.firstname,
            lastname: suggestedName.lastname,
            email,
            platformOrigin: "whatsapp",
            customerConfirmed: true
          }, {
            status: "requested",
            email,
            firstname: suggestedName.firstname,
            lastname: suggestedName.lastname
          });
          toolRuns.push(createRequested);
          auditEvents.push("ai_sdr.tool.requested");

          try {
            const created = await createCustomerTool({
              firstname: suggestedName.firstname,
              lastname: suggestedName.lastname,
              email,
              platformOrigin: "whatsapp",
              customerConfirmed: true,
              conversationCaseId: input.conversationCaseId,
              correlationId: input.correlationId
            });
            toolRuns.push(buildToolRun("create_customer", "executed", {
              firstname: suggestedName.firstname,
              lastname: suggestedName.lastname,
              email
            }, created, created.warnings));
            auditEvents.push("ai_sdr.tool.executed");
            customer = created.customer;
            customerContext = customer?.id ? await getCustomerContext({ customerId: customer.id, conversationCaseId: input.conversationCaseId }) : null;
            dataQuality = customerContext?.dataQuality ?? dataQuality;
            const linked = customer?.id
              ? await linkCustomerToConversation({
                  customerId: customer.id,
                  conversationCaseId: input.conversationCaseId ?? input.messageId ?? input.correlationId,
                  source: "ai_sdr",
                  confidence: "high",
                  correlationId: input.correlationId
                })
              : null;
            link = linked?.link ?? link;
            if (linked && linked.status === "conflict") {
              state = "handoff";
              decisionAction = "handoff";
              responseText = "Cre la cuenta, pero ya existia otro vinculo para esta conversacion. Voy a derivarlo para revision.";
              decisionReason = "Customer created but conversation link conflicted.";
              warnings.push("conversation_case_already_linked");
              auditEvents.push("ai_sdr.handoff.requested");
            } else if (linked && linked.status === "unavailable") {
              state = "blocked";
              decisionAction = "handoff";
              responseText = "Cre la cuenta, pero no pude completar el vinculo. Voy a derivarlo para revision.";
              decisionReason = "Customer created but link persistence failed.";
              warnings.push(...linked.warnings);
              auditEvents.push("ai_sdr.handoff.requested");
            } else {
              state = "completed";
              responseText = "Listo, cree tu cuenta y quedo vinculada a esta conversacion.";
              decisionReason = "Customer created and linked successfully.";
            }
          } catch (error) {
            toolRuns.push(
              buildToolRun(
                "create_customer",
                "failed",
                {
                  firstname: suggestedName.firstname,
                  lastname: suggestedName.lastname,
                  email
                },
                {
                  status: "failed",
                  error: error instanceof Error ? error.message : String(error)
                },
                [error instanceof Error ? error.message : String(error)]
              )
            );
            auditEvents.push("ai_sdr.tool.failed");
            state = "handoff";
            decisionAction = "handoff";
            decisionTool = null;
            pendingAction = null;
            pendingCustomerConfirmation = false;
            responseText = "No pude completar la creacion en este momento. Voy a derivarlo para revision.";
            decisionReason = error instanceof Error ? error.message : String(error);
            auditEvents.push("ai_sdr.handoff.requested");
          }
        }
      }
    }
  } else {
    decisionAction = "continue_sales_flow";
    decisionTool = "get_customer_context";
    decisionIntent = "no_customer_onboarding";
    state = currentState?.state ?? "unresolved";
    pendingAction = currentState?.pendingAction ?? null;
    pendingCustomerConfirmation = currentState?.pendingCustomerConfirmation ?? false;
    responseText = null;
    if (!customerContext && linkedCustomerId) {
      customerContext = await getCustomerContext({ customerId: linkedCustomerId, conversationCaseId: input.conversationCaseId });
      customer = customerContext.customer;
      dataQuality = customerContext.dataQuality;
    }
  }

  const policy = assessCustomerOnboardingToolPolicy(decisionAction, {
    customerConfirmed: confirmedCustomer,
    conflict: decisionAction === "handoff",
    dbWriteEnabled: input.writeEnabled ?? true
  });
  const finalReason = decisionAction === "handoff" ? decisionReason : policy.reason;
  const decisionId = stableDecisionId(input, decisionAction, state);
  const decision = buildDecision({
    intent: decisionIntent,
    action: decisionAction,
    tool: decisionTool,
    args: {
      conversationCaseId: input.conversationCaseId,
      email: normalizedEmailResult.status === "single" ? normalizedEmailResult.emails[0] : currentState?.email ?? null
    },
    requiresCustomerConfirmation: decisionAction === "create_customer",
    requiresHumanApproval: decisionAction === "handoff",
    confidence: decisionAction === "handoff" ? 0.2 : 0.85,
    reason: finalReason,
    policyTags: policy.policyTags
  });

  await auditCustomerOnboardingEvent({
    action: "ai_sdr.decision.created",
    customerId: customer?.id ?? currentState?.customerId ?? null,
    conversationCaseId: input.conversationCaseId,
    payload: {
      decisionId,
      action: decision.action,
      tool: decision.tool,
      result: state,
      reason: decision.reason,
      confidence: decision.confidence,
      correlationId: input.correlationId
    }
  });
  if (decision.action === "handoff") {
    auditEvents.push("ai_sdr.handoff.requested");
  }

  const persisted = await persistDecisionState({
    run: input,
    state,
    pendingAction,
    pendingCustomerConfirmation,
    email: normalizedEmailResult.status === "single" ? normalizedEmailResult.emails[0] : currentState?.email ?? null,
    firstname: customer?.firstname ?? extractSuggestedName(input.messageText)?.firstname ?? currentState?.firstname ?? null,
    lastname: customer?.lastname ?? extractSuggestedName(input.messageText)?.lastname ?? currentState?.lastname ?? null,
    customerId: customer?.id ?? currentState?.customerId ?? null,
    customerPlatformOrigin: customer?.platformOrigin ?? currentState?.customerPlatformOrigin ?? null,
    linkStatus: link?.linkStatus ?? currentState?.linkStatus ?? null,
    lastDecisionId: decisionId,
    lastToolName: decisionTool ?? null,
    lastToolStatus: toolRuns.length > 0 ? toolRuns[toolRuns.length - 1]?.status ?? null : "requested",
    lastToolResult: toolRuns.length > 0 ? toolRuns[toolRuns.length - 1]?.result ?? null : null,
    lastResponseText: responseText,
    reason: decisionReason,
    confidence: decision.confidence,
    warnings,
    context: {
      conversationCaseId: input.conversationCaseId,
      waId: input.waId,
      messageId: input.messageId,
      emails: normalizedEmailResult.emails,
      emailStatus: normalizedEmailResult.status,
      confirmationStatus: explicitConfirmation.status,
      correlationId: input.correlationId
    }
  });

  return {
    ok: true,
    state: persisted.state,
    decision,
    toolRuns,
    responseText,
    warnings,
    errors: [],
    customer,
    customerContext,
    dataQuality,
    link,
    persisted: persisted.ok,
    auditEvents,
    metadata: {
      correlationId: input.correlationId,
      decisionId,
      currentTime,
      state
    }
  };
}
