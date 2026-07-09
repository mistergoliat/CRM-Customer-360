import type { CustomerOnboardingPostPlanResult } from "./customer-session";

// ACS-R1-04-T06.1, contract section 19. Builds the customer-facing text for
// a real onboarding/identity outcome - never invents success, never exposes
// customerId/candidates/HTTP internals/policy internals/stack traces. Only
// a fixed, neutral, allowlisted set of templates - no free text is ever
// interpolated from Customer Service's own error message.

const MESSAGES = {
  customerCreated: "Listo, creé tu ficha de cliente para continuar.",
  customerMatched: "Ya tenías una cuenta registrada - la usaremos para continuar.",
  linkCompleted: "Listo, vinculé este WhatsApp a tu cuenta.",
  linkAlready: "Este WhatsApp ya estaba vinculado a tu cuenta.",
  consentNeededCreate: "Para crear tu ficha de cliente necesito tu autorización explícita.",
  consentNeededLink: "Para vincular este WhatsApp a tu cuenta necesito tu autorización explícita.",
  neutralUnavailable: "En este momento no puedo completar esa operación. Intentemos de nuevo en unos minutos, o te derivo a un operador si prefieres.",
  neutralFailure: "No pude completar esa operación con los datos entregados. Puedes solicitar atención de un operador si necesitas ayuda."
} as const;

function missingInformationMessage(requiredFields: unknown): string {
  const fields = Array.isArray(requiredFields) ? requiredFields.filter((field): field is string => typeof field === "string") : [];
  const labels: Record<string, string> = { firstName: "tu nombre", lastName: "tu apellido", email: "tu correo", orderReference: "el número de tu pedido" };
  const named = fields.map((field) => labels[field]).filter((label): label is string => Boolean(label));
  if (named.length === 0) return "Para continuar necesito algunos datos más.";
  return `Para continuar necesito ${named.join(" y ")}.`;
}

/**
 * Returns a grounded customer-facing sentence for this turn's onboarding
 * outcome, or null when there is nothing concrete to ground (the LLM's own
 * draft stands untouched in that case).
 */
export function buildOnboardingGroundedMessage(result: CustomerOnboardingPostPlanResult): string | null {
  const outcome = result.capabilityOutcome;
  if (!outcome) return null;

  if (result.attemptedOperation === "create_customer") {
    if (outcome.status === "completed") {
      if (outcome.errorCode === "customer_creation_conflict") return MESSAGES.neutralFailure;
      const data = outcome.data as { status?: string } | null;
      return data?.status === "matched_existing" ? MESSAGES.customerMatched : MESSAGES.customerCreated;
    }
    if (outcome.status === "missing_information") return missingInformationMessage((outcome.data as { requiredFields?: unknown } | null)?.requiredFields);
    if (outcome.status === "denied" && typeof outcome.errorCode === "string" && outcome.errorCode.startsWith("consent_required")) return MESSAGES.consentNeededCreate;
    if (outcome.status === "denied") return MESSAGES.neutralFailure;
    if (outcome.status === "invalid_arguments") return MESSAGES.neutralFailure;
    if (outcome.status === "temporarily_blocked" || outcome.status === "failed") return MESSAGES.neutralUnavailable;
  }

  if (result.attemptedOperation === "link_external_identity") {
    if (outcome.status === "completed") {
      if (outcome.errorCode === "customer_link_conflict") return MESSAGES.neutralFailure;
      const data = outcome.data as { status?: string } | null;
      return data?.status === "already_linked" ? MESSAGES.linkAlready : MESSAGES.linkCompleted;
    }
    if (outcome.status === "missing_information") return missingInformationMessage((outcome.data as { requiredFields?: unknown } | null)?.requiredFields);
    if (outcome.status === "denied" && typeof outcome.errorCode === "string" && outcome.errorCode.startsWith("consent_required")) return MESSAGES.consentNeededLink;
    if (outcome.status === "denied") return MESSAGES.neutralFailure;
    if (outcome.status === "invalid_arguments") return MESSAGES.neutralFailure;
    if (outcome.status === "temporarily_blocked" || outcome.status === "failed") return MESSAGES.neutralUnavailable;
  }

  return null;
}
