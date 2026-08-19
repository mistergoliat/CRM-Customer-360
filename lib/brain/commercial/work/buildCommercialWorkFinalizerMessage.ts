import type { PersistedCommercialWork } from "./persistenceTypes";
import type { CommercialObjective } from "./types";

export const COMMERCIAL_WORK_DISPOSITIONS = ["FINAL", "PARTIAL", "BLOCKED"] as const;
export type CommercialWorkDisposition = (typeof COMMERCIAL_WORK_DISPOSITIONS)[number];

export type CommercialWorkFinalizerResult = {
  disposition: CommercialWorkDisposition;
  message: string;
};

const DURABLE_CONTINUATION_STEP_STATUSES = new Set(["READY", "RUNNING", "RETRY_SCHEDULED", "WAITING_SYSTEM"]);

function activeObjectives(work: PersistedCommercialWork): CommercialObjective[] {
  return work.objectives.filter((objective) => objective.status !== "CANCELLED" && objective.status !== "SUPERSEDED");
}

/**
 * SALES-AGENT-R2-A08.5, Parts 10/11. Grounds every customer-visible claim in
 * the persisted aggregate's own fields (inputs/status) - never LLM narration,
 * never an external fact lookup this function doesn't already have. A
 * future-tense claim ("estoy terminando...") is only ever emitted when a
 * matching step is durably READY/RUNNING/RETRY_SCHEDULED/WAITING_SYSTEM in
 * `work` at the moment this function runs - the same evidence-first
 * discipline lib/brain/commercial/agent-loop/commercialMutationClaims.ts
 * already enforces for the legacy loop, generalized to three dispositions
 * instead of one binary unbacked-claim check.
 *
 * Known limitation (documented, not fixed here): the aggregate carries
 * product IDs/free-text references, never catalog product names - a
 * selection confirmation names the customer's own words when available
 * (objective.inputs.productReference) and otherwise a bare item count,
 * rather than inventing a product name it does not have.
 */
export function describeSelectionObjective(objective: CommercialObjective): string | null {
  const items = objective.inputs.items;
  if (items && items.length > 0) {
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    return items.length === 1
      ? `${totalQuantity} unidad(es) del producto seleccionado`
      : `tu seleccion de ${items.length} productos (${totalQuantity} unidades en total)`;
  }
  if (objective.inputs.productReference) {
    const quantity = objective.inputs.quantity;
    return quantity ? `${quantity} unidad(es) de ${objective.inputs.productReference}` : objective.inputs.productReference;
  }
  return null;
}

function describeDestinationObjective(objective: CommercialObjective): string | null {
  return objective.inputs.canonicalDestinationName ?? objective.inputs.destinationText ?? null;
}

function completedClause(objective: CommercialObjective): string | null {
  switch (objective.type) {
    case "SELECT_PRODUCTS": {
      const description = describeSelectionObjective(objective);
      return description ? `Dejé registrada ${description}` : null;
    }
    case "SET_DESTINATION": {
      const destination = describeDestinationObjective(objective);
      return destination ? `tu destino queda registrado como ${destination}` : null;
    }
    case "GET_SHIPPING_QUOTE":
      return "ya tengo calculado el despacho";
    case "SELECT_SHIPPING_OPTION":
      return "tu opción de despacho quedó confirmada";
    case "CREATE_QUOTE":
      return "tu cotización quedó creada";
    default:
      return null;
  }
}

function pendingClause(objective: CommercialObjective, hasDurableContinuation: boolean): string | null {
  if (!hasDurableContinuation) return null;
  switch (objective.type) {
    case "SELECT_PRODUCTS":
      return "estoy terminando de confirmar tu selección";
    case "SET_DESTINATION":
      return "estoy registrando tu destino";
    case "GET_SHIPPING_QUOTE":
      return "estoy terminando el cálculo de despacho";
    case "SELECT_SHIPPING_OPTION":
      return "estoy confirmando tu opción de despacho";
    case "CREATE_QUOTE":
      return "estoy terminando de generar tu cotización";
    default:
      return null;
  }
}

export function buildCommercialWorkFinalizerMessage(work: PersistedCommercialWork): CommercialWorkFinalizerResult {
  const objectives = activeObjectives(work);
  const completedObjectives = objectives.filter((objective) => objective.status === "COMPLETED");
  const waitingCustomerObjectives = objectives.filter((objective) => objective.status === "WAITING_CUSTOMER");

  const objectiveHasDurableStep = (objective: CommercialObjective): boolean =>
    work.steps.some((step) => step.objectiveIds.includes(objective.objectiveId) && DURABLE_CONTINUATION_STEP_STATUSES.has(step.status));

  const completedClauses = completedObjectives.map(completedClause).filter((clause): clause is string => Boolean(clause));
  const continuingObjectives = objectives.filter((objective) => objective.status !== "COMPLETED" && objectiveHasDurableStep(objective));
  const pendingClauses = continuingObjectives.map((objective) => pendingClause(objective, true)).filter((clause): clause is string => Boolean(clause));

  const isFullyComplete = objectives.length > 0 && objectives.every((objective) => objective.status === "COMPLETED");
  if (isFullyComplete || work.status === "COMPLETED") {
    const message = completedClauses.length > 0 ? `Listo. ${capitalize(completedClauses.join("; "))}.` : "Listo, tu solicitud quedó completada.";
    return { disposition: "FINAL", message };
  }

  if (completedClauses.length > 0 && pendingClauses.length > 0) {
    return { disposition: "PARTIAL", message: `${capitalize(completedClauses.join("; "))} y ${pendingClauses.join(", ")}.` };
  }

  if (waitingCustomerObjectives.length > 0) {
    const missing = waitingCustomerObjectives.flatMap((objective) => objective.missingRequirements);
    const message =
      completedClauses.length > 0
        ? `${capitalize(completedClauses.join("; "))}. ${buildMissingInfoQuestion(missing)}`
        : buildMissingInfoQuestion(missing);
    return { disposition: "BLOCKED", message };
  }

  if (work.status === "HANDOFF") {
    return { disposition: "BLOCKED", message: "Voy a conectar tu conversación con alguien del equipo para que te ayude directamente con esto." };
  }

  if (pendingClauses.length > 0) {
    return { disposition: "PARTIAL", message: `${capitalize(pendingClauses.join(", "))}.` };
  }

  return { disposition: "BLOCKED", message: "Necesito un momento más para revisar tu consulta antes de responderte con seguridad." };
}

function capitalize(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function buildMissingInfoQuestion(missing: readonly string[]): string {
  if (missing.includes("DESTINATION")) return "¿A qué comuna necesitas el despacho?";
  if (missing.includes("PRODUCT") || missing.includes("PRODUCT_EVIDENCE")) return "¿Qué producto te interesa?";
  if (missing.includes("QUANTITY")) return "¿Cuántas unidades necesitas?";
  return "¿Puedes darme un poco más de detalle para continuar?";
}
