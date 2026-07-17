import type { ContinuityFallbackClass } from "./salesTurnDisposition";

/**
 * ACS-R1-05-T06.2 (release spec section A7). Deterministic, commercial
 * fallback text - never an empty administrative placeholder like "Recibi tu
 * consulta.". Always built from real, already-known commercial context
 * (never inventing product, price, stock or a promised timeframe): what the
 * customer already told us, what could not be done right now, and what
 * happens next.
 */
export type ContinuityFallbackContext = {
  productQuery: string | null;
  usage: string | null;
  budgetMax: number | null;
  currency: string | null;
};

function formatBudget(budgetMax: number, currency: string | null): string {
  const amount = budgetMax.toLocaleString("es-CL");
  return currency ? `${amount} ${currency}` : amount;
}

function buildKnownNeedClause(context: ContinuityFallbackContext): string {
  const parts: string[] = [];
  if (context.productQuery) parts.push(`buscas ${context.productQuery}`);
  if (context.usage) parts.push(`para ${context.usage}`);
  if (context.budgetMax !== null) parts.push(`con un presupuesto de hasta ${formatBudget(context.budgetMax, context.currency)}`);

  if (parts.length === 0) return "";
  return `Ya tengo registrado que ${parts.join(" ")}. `;
}

export function buildContinuityFallbackMessage(fallbackClass: ContinuityFallbackClass, context: ContinuityFallbackContext): string {
  const knownNeed = buildKnownNeedClause(context);

  switch (fallbackClass) {
    case "catalog_unavailable":
      return `${knownNeed}No pude consultar el catálogo real en este momento, pero mantengo esos datos para seguir con la recomendación apenas pueda verificar precio y stock.`;
    case "model_unavailable":
      return `${knownNeed}Tuve un problema para procesar tu mensaje justo ahora. Guardé lo que me contaste y voy a retomarlo apenas pueda revisarlo con más detalle.`;
    case "invalid_model_result":
      return `${knownNeed}No logré preparar una respuesta confiable a partir de tu mensaje. Mantengo el contexto que ya tengo y sigo con esto apenas pueda revisarlo.`;
    case "unsafe_primary_draft":
      return `${knownNeed}Mi primera respuesta no pasó un control interno antes de enviarse, así que la reemplacé por esta. Sigo con tu consulta con la información que ya me diste.`;
    case "handoff_acknowledgement":
      return `${knownNeed}Voy a conectar tu conversación con alguien del equipo para que te ayude directamente con esto.`;
  }
}
