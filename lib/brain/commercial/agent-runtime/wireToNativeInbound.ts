import { createOutboxPlannedRecord } from "../../messaging/outbox";
import { createPrestashopProductRepository, createSalesConsultativeOperationsRepository } from "../sales-consultative";
import { createHttpAgentProvider } from "./provider/httpProvider";
import { runCommercialAgentTurn } from "./loop";
import { buildAgentToolRegistry } from "./tools/registry";
import type { AgentTurnResult } from "./types";

export type NativeInboundAgentTriggerInput = {
  conversationId: number;
  conversationPublicId: string;
  customerMasterId: number | null;
  waId: string | null;
  phoneNumberId: string | null;
  messageText: string;
  messageId: number | string | null;
  correlationId: string;
  currentTime: string;
};

export type NativeInboundAgentTriggerResult =
  | { ran: false; reason: "disabled" | "model_not_configured" }
  | { ran: true; turn: AgentTurnResult; outboxStatus: "planned" | "existing" | "skipped"; outboxId: number | string | null };

function isAgentEnabled() {
  return process.env.BRAIN_COMMERCIAL_AGENT_ENABLED?.trim().toLowerCase() === "true";
}

function isModelConfigured() {
  return Boolean(process.env.BRAIN_MODEL_API_URL?.trim() && process.env.BRAIN_MODEL_API_KEY?.trim());
}

/**
 * Optional, flag-gated hook from the native WhatsApp inbound path into the
 * genuine commercial agent loop. Disabled by default (BRAIN_COMMERCIAL_AGENT_ENABLED
 * unset/false), matching every other capability in this codebase (BRAIN_META_SEND_ENABLED,
 * BRAIN_AUTONOMOUS_REPLY_ENABLED, etc.) -- the existing native inbound test suite
 * ("native inbound path does not invoke consultative engine or outbox writers")
 * keeps passing unchanged because this hook is a no-op until explicitly enabled.
 *
 * Never throws: a failure here must not undo the already-committed inbound
 * persistence (ADR-007 continuity). Caller should treat the result as
 * best-effort and log/observe it, not branch the inbound response on it.
 */
export async function maybeRunCommercialAgentForInboundTurn(input: NativeInboundAgentTriggerInput): Promise<NativeInboundAgentTriggerResult> {
  if (!isAgentEnabled()) {
    return { ran: false, reason: "disabled" };
  }
  if (!isModelConfigured()) {
    return { ran: false, reason: "model_not_configured" };
  }

  const operationsRepository = createSalesConsultativeOperationsRepository();
  const registry = buildAgentToolRegistry({
    productRepository: createPrestashopProductRepository(),
    operationsRepository
  });

  const turn = await runCommercialAgentTurn(
    {
      conversationId: input.conversationId,
      customerMasterId: input.customerMasterId,
      conversationPublicId: input.conversationPublicId,
      messageText: input.messageText,
      messageId: input.messageId,
      correlationId: input.correlationId,
      currentTime: input.currentTime
    },
    { provider: createHttpAgentProvider(), registry }
  );

  if (!turn.responseText || !input.waId) {
    return { ran: true, turn, outboxStatus: "skipped", outboxId: null };
  }

  const outbox = await createOutboxPlannedRecord({
    dedupeKeyInput: {
      source: "brain",
      actionType: "send_whatsapp_message",
      channel: "whatsapp",
      waId: input.waId,
      conversationCaseId: input.conversationId,
      messageText: turn.responseText,
      sourceRequestId: turn.turnId
    },
    status: "planned",
    source: "brain",
    sourceRequestId: turn.turnId,
    sourceAgentName: "commercial-agent-runtime",
    sourceAgentVersion: "brain.commercial.agent-runtime.v1",
    waId: input.waId,
    phoneNumberId: input.phoneNumberId,
    conversationCaseId: input.conversationId,
    messageText: turn.responseText,
    metaPayloadJson: {
      model_version: turn.modelName,
      turnId: turn.turnId,
      finalDecision: turn.finalDecision
    }
  });

  return {
    ran: true,
    turn,
    outboxStatus: outbox.ok ? (outbox.existing ? "existing" : "planned") : "skipped",
    outboxId: outbox.row?.id ?? null
  };
}
