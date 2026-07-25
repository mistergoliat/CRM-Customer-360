import type { FollowUpReason } from "./types";

/**
 * Fixed, human-readable Spanish labels for the fixed, short reason codes
 * this domain actually writes (see runFollowupTick.ts / optOutStore.ts /
 * runCommercialExecutionBridge.ts). An unmapped code falls back to itself -
 * every code here is already a short, non-secret, non-PII fixed string (or,
 * for failure_reason, an exception message already redacted by
 * redactErrorMessage.ts before it was persisted) - never raw prose that
 * needs hiding.
 */
const REASON_LABELS: Record<string, string> = {
  customer_opted_out: "Cliente se dio de baja",
  missing_wa_id: "Sin wa_id",
  customer_replied_since_schedule: "Cliente respondió antes del seguimiento",
  human_owner_active: "Dueño humano activo",
  ai_paused: "IA pausada",
  conversation_closed: "Conversación cerrada",
  conversation_not_found: "Conversación no encontrada",
  follow_up_disabled: "Seguimiento deshabilitado por configuración",
  max_attempts_reached: "Máximo de intentos alcanzado",
  opportunity_too_old: "Oportunidad demasiado antigua",
  follow_up_stale_execution_exhausted: "Ejecución abandonada sin intentos restantes",
  missing_schedule: "Sin fecha programada (reconciliado)",
  missing_customer_identity: "Sin identidad de cliente",
  configuration_unavailable: "Configuración no disponible",
  window_unreachable: "Ventana horaria inalcanzable",
  no_action: "Sin acción"
};

const STATUS_LABELS: Record<string, string> = {
  planned: "Planificado",
  executing: "En ejecución",
  executed: "Ejecutado",
  cancelled: "Cancelado",
  failed: "Fallido",
  blocked: "Bloqueado",
  // Decision 8 (approved audit): exact required label - requires_review has
  // no operator approval route anywhere in the Hub today.
  requires_review: "Requiere revisión — sin flujo de aprobación disponible",
  expired: "Expirado"
};

// Decision 7 (approved audit): exact required badge label.
export const MISSING_CONFIGURATION_BADGE_LABEL = "Sin configuración asociada";

export function labelForFollowUpStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function labelForReasonCode(code: string | null): string {
  if (!code) return "";
  return REASON_LABELS[code] ?? code;
}

export function buildFollowUpReason(cancelReason: string | null, failureReason: string | null): FollowUpReason {
  if (cancelReason) return { type: "cancel", code: cancelReason, label: labelForReasonCode(cancelReason) };
  if (failureReason) return { type: "failure", code: failureReason, label: labelForReasonCode(failureReason) };
  return { type: null, code: null, label: "" };
}
