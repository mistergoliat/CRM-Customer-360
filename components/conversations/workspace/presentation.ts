import type { ChipTone } from "@/lib/status";
import type { AiControlMode, ConversationMessageOrigin, ConversationMessageState } from "@/lib/domains/conversations/thread";

// Pure presentation maps shared by workspace components (type-only imports keep this client-safe).

export const MESSAGE_STATE_LABEL: Record<ConversationMessageState, string> = {
  received: "Recibido",
  planned: "Borrador",
  queued: "En cola",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Falló"
};

export function messageKindLabel(messageType?: string | null): string | null {
  const normalized = (messageType ?? "").trim().toLowerCase();
  if (normalized === "template") return "Plantilla";
  if (normalized === "text") return null;
  return normalized ? normalized : null;
}

export function messageStateTone(state: ConversationMessageState): ChipTone {
  switch (state) {
    case "failed":
      return "red";
    case "read":
    case "delivered":
      return "green";
    case "sent":
      return "blue";
    case "planned":
    case "queued":
      return "amber";
    default:
      return "gray";
  }
}

export function originLabel(origin: ConversationMessageOrigin, operatorName: string | null): string {
  switch (origin) {
    case "customer":
      return "Cliente";
    case "ai":
      return "IA";
    case "operator":
      return operatorName ?? "Operador";
    case "system":
      return "Sistema";
  }
}

export const CONTROL_MODE_PRESENTATION: Record<AiControlMode, { label: string; tone: ChipTone }> = {
  ai_autonomous: { label: "IA autónoma", tone: "green" },
  human: { label: "Humano", tone: "blue" },
  paused: { label: "Pausado", tone: "amber" }
};
