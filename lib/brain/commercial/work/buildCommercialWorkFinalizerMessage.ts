import type { PersistedCommercialWork } from "./persistenceTypes";
import type { CommercialMissingRequirement, CommercialObjective } from "./types";
import { commercialObjectiveSupersessionFamily } from "./deriveCommercialObjectives";

export const COMMERCIAL_WORK_DISPOSITIONS = ["FINAL", "PARTIAL", "BLOCKED"] as const;
export type CommercialWorkDisposition = (typeof COMMERCIAL_WORK_DISPOSITIONS)[number];

const CANCELLED_FAMILY_CLAUSES: Record<string, string> = {
  selection: "dejé sin efecto tu selección",
  destination: "dejé sin efecto el destino",
  shipping: "dejé sin efecto el cálculo de despacho",
  quote: "dejé sin efecto la cotización"
};

/**
 * deriveCommercialObjectives.ts marks a cancelled objective's origin with a
 * CANCELLED blocker unconditionally, even when its own state machine
 * (transitions.ts) forces the final status to SUPERSEDED instead of
 * CANCELLED (a COMPLETED objective can only be superseded, never literally
 * cancelled - the calculation already happened). Checking the blocker
 * instead of the literal status is what lets a cancelled-while-COMPLETED
 * shipping calculation still read as "cancelled" here, not silently as a
 * normal, unremarked supersession.
 */
function wasCancelled(objective: CommercialObjective): boolean {
  return objective.status === "CANCELLED" || objective.blockers.some((blocker) => blocker.code === "CANCELLED");
}

/**
 * SALES-AGENT-R2-A08.6, Part 11. A family reads as "cancelled" only when it
 * has at least one CANCELLED objective and no remaining active (non-
 * cancelled/non-superseded) objective of that same family - a family that
 * was cancelled and then re-requested in the same or a later turn is active
 * again, not cancelled, and must never claim otherwise.
 */
function cancelledFamilyClauses(work: PersistedCommercialWork): string[] {
  const families = new Set(work.objectives.map((objective) => commercialObjectiveSupersessionFamily(objective.type)).filter((family) => family !== "other"));
  const clauses: string[] = [];
  for (const family of families) {
    const ofFamily = work.objectives.filter((objective) => commercialObjectiveSupersessionFamily(objective.type) === family);
    const hasCancelled = ofFamily.some(wasCancelled);
    const hasActive = ofFamily.some((objective) => objective.status !== "CANCELLED" && objective.status !== "SUPERSEDED");
    if (hasCancelled && !hasActive) {
      const clause = CANCELLED_FAMILY_CLAUSES[family];
      if (clause) clauses.push(clause);
    }
  }
  return clauses;
}

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

// SALES-AGENT-R2-ID-R2-A07. The three non-SUFFICIENT A06 decision statuses
// that land an objective on BLOCKED (not WAITING_CUSTOMER -
// commercialIdentityGate.ts) yet still deserve a customer-facing message:
// READY_TO_LINK (consent ask), IDENTITY_CONFLICT (safe, generic),
// ENTITY_VERIFICATION_REQUIRED (no real consumer yet, kept exhaustive).
// Distinct from waitingCustomerObjectives below, which only ever holds
// WAITING_CUSTOMER objectives.
const IDENTITY_BLOCKED_REQUIREMENTS = new Set<CommercialMissingRequirement>(["IDENTITY_LINK_PENDING", "IDENTITY_CONFLICT", "IDENTITY_VERIFICATION"]);

function identityBlockedObjectives(objectives: readonly CommercialObjective[]): CommercialObjective[] {
  return objectives.filter((objective) => objective.status === "BLOCKED" && objective.missingRequirements.some((requirement) => IDENTITY_BLOCKED_REQUIREMENTS.has(requirement)));
}

function buildIdentityBlockedMessage(objectives: readonly CommercialObjective[]): string {
  const first = objectives[0];
  if (first.missingRequirements.includes("IDENTITY_LINK_PENDING")) {
    return "Encontré una cuenta que coincide con los datos que verificamos. ¿Confirmas que la vinculemos a tu perfil para continuar?";
  }
  if (first.missingRequirements.includes("IDENTITY_CONFLICT")) {
    return "No pude confirmar tu identidad de forma automática porque encontré una inconsistencia en tus datos. Voy a derivar tu conversación con alguien del equipo para revisarlo.";
  }
  return "Necesito verificar algunos datos adicionales antes de continuar con esto.";
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
  // SALES-AGENT-R2-A08.6, Part 3/11. Checked first and exclusively: a whole-
  // work cancellation (evaluateCommercialWork.ts's deriveCommercialWorkStatus
  // sets this only when every objective is CANCELLED) is never described as
  // "completado" - that would be a truthful-but-misleading claim.
  if (work.status === "CANCELLED") {
    return { disposition: "FINAL", message: "Listo, cancelé tu solicitud." };
  }

  const objectives = activeObjectives(work);
  const completedObjectives = objectives.filter((objective) => objective.status === "COMPLETED");
  const waitingCustomerObjectives = objectives.filter((objective) => objective.status === "WAITING_CUSTOMER");
  const cancelClauses = cancelledFamilyClauses(work);

  const objectiveHasDurableStep = (objective: CommercialObjective): boolean =>
    work.steps.some((step) => step.objectiveIds.includes(objective.objectiveId) && DURABLE_CONTINUATION_STEP_STATUSES.has(step.status));

  const completedClauses = [...completedObjectives.map(completedClause).filter((clause): clause is string => Boolean(clause)), ...cancelClauses];
  const continuingObjectives = objectives.filter((objective) => objective.status !== "COMPLETED" && objectiveHasDurableStep(objective));
  const pendingClauses = continuingObjectives.map((objective) => pendingClause(objective, true)).filter((clause): clause is string => Boolean(clause));

  const isFullyComplete = objectives.length > 0 && objectives.every((objective) => objective.status === "COMPLETED");
  // A standalone cancellation (nothing else pending/waiting) is a complete,
  // truthful FINAL outcome on its own - e.g. "olvida el despacho" with
  // nothing else in flight - even though the cancelled objective itself is
  // filtered out of `objectives` above (activeObjectives excludes CANCELLED).
  const isCancelOnlyFinal = cancelClauses.length > 0 && pendingClauses.length === 0 && waitingCustomerObjectives.length === 0;
  if (isFullyComplete || work.status === "COMPLETED" || isCancelOnlyFinal) {
    const message = completedClauses.length > 0 ? `Listo. ${capitalize(completedClauses.join("; "))}.` : "Listo, tu solicitud quedó completada.";
    return { disposition: "FINAL", message };
  }

  if (completedClauses.length > 0 && pendingClauses.length > 0) {
    return { disposition: "PARTIAL", message: `${capitalize(completedClauses.join("; "))} y ${pendingClauses.join(", ")}.` };
  }

  if (waitingCustomerObjectives.length > 0) {
    const message =
      completedClauses.length > 0
        ? `${capitalize(completedClauses.join("; "))}. ${buildMissingInfoQuestion(waitingCustomerObjectives)}`
        : buildMissingInfoQuestion(waitingCustomerObjectives);
    return { disposition: "BLOCKED", message };
  }

  // SALES-AGENT-R2-ID-R2-A07. READY_TO_LINK/IDENTITY_CONFLICT/
  // ENTITY_VERIFICATION_REQUIRED land their objective on BLOCKED, not
  // WAITING_CUSTOMER (commercialIdentityGate.ts) - so they never reach the
  // branch above.
  const identityBlocked = identityBlockedObjectives(objectives);
  if (identityBlocked.length > 0) {
    const message = completedClauses.length > 0 ? `${capitalize(completedClauses.join("; "))}. ${buildIdentityBlockedMessage(identityBlocked)}` : buildIdentityBlockedMessage(identityBlocked);
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

/**
 * SALES-AGENT-R2-A11.1, Part 6. Distinguishes PRODUCT_AMBIGUOUS/PRODUCT_NOT_FOUND
 * (a real search_products execution ran - see buildCommercialWorkProjection.ts's
 * applyObjectiveState - and found 2+/0 matches) from PRODUCT (no reference was
 * ever given, the only case that still asks the old generic question) - takes
 * the full objectives, not a flattened string list, because PRODUCT_AMBIGUOUS's
 * wording needs the real candidate names attached to the objective that
 * carries them (objective.inputs.productCandidates), never invented ones.
 * WAITING_SYSTEM objectives never reach here (deriveCommercialWorkStatus keeps
 * them out of waitingCustomerObjectives), matching Part 12/13's requirement
 * that a catalog failure is never surfaced as a customer question.
 */
function buildMissingInfoQuestion(waitingCustomerObjectives: readonly CommercialObjective[]): string {
  const missing = waitingCustomerObjectives.flatMap((objective) => objective.missingRequirements);
  if (missing.includes("DESTINATION")) return "¿A qué comuna necesitas el despacho?";

  if (missing.includes("PRODUCT_AMBIGUOUS")) {
    const objective = waitingCustomerObjectives.find((item) => item.missingRequirements.includes("PRODUCT_AMBIGUOUS"));
    const options = productCandidatesList(objective?.inputs.productCandidates);
    return options
      ? `Encontré varias opciones para "${objective?.inputs.productReference ?? ""}": ${options}. ¿Cuál de estas te interesa?`
      : "Encontré varias opciones para ese producto. ¿Puedes darme más detalle (marca, modelo o peso) para saber cuál necesitas?";
  }
  if (missing.includes("PRODUCT_NOT_FOUND")) {
    const objective = waitingCustomerObjectives.find((item) => item.missingRequirements.includes("PRODUCT_NOT_FOUND"));
    const reference = objective?.inputs.productReference;
    return reference
      ? `No encontré "${reference}" en el catálogo. ¿Puedes confirmarme el nombre exacto del producto?`
      : "No encontré ese producto en el catálogo. ¿Puedes confirmarme el nombre exacto?";
  }
  if (missing.includes("PRODUCT") || missing.includes("PRODUCT_EVIDENCE")) return "¿Qué producto te interesa?";
  if (missing.includes("QUANTITY")) return "¿Cuántas unidades necesitas?";

  // SALES-AGENT-R2-A11.4. Real candidates only, from
  // buildCommercialWorkProjection.ts's applyObjectiveState (matchShippingOptionReference's
  // output) - never invented options.
  if (missing.includes("SHIPPING_OPTION_RECALCULATED")) {
    const objective = waitingCustomerObjectives.find((item) => item.missingRequirements.includes("SHIPPING_OPTION_RECALCULATED"));
    const options = shippingOptionsList(objective?.inputs.shippingOptionCandidates);
    return options
      ? `Los valores de despacho se actualizaron. Estas son las opciones vigentes: ${options}. ¿Cuál prefieres?`
      : "Los valores de despacho se actualizaron. ¿Puedes confirmarme de nuevo qué opción de envío prefieres?";
  }
  if (missing.includes("SHIPPING_OPTION_AMBIGUOUS")) {
    const objective = waitingCustomerObjectives.find((item) => item.missingRequirements.includes("SHIPPING_OPTION_AMBIGUOUS"));
    const options = shippingOptionsList(objective?.inputs.shippingOptionCandidates);
    return options
      ? `Hay varias opciones de despacho que podrían ser esa: ${options}. ¿Cuál prefieres?`
      : "Hay varias opciones de despacho que podrían coincidir. ¿Puedes darme más detalle (transportista o precio)?";
  }
  if (missing.includes("SHIPPING_OPTION_NOT_FOUND")) {
    return 'No encontré esa opción de despacho entre las disponibles. ¿Puedes indicarme el nombre del transportista o la posición (por ejemplo, "la primera")?';
  }

  return "¿Puedes darme un poco más de detalle para continuar?";
}

function shippingOptionsList(candidates: { carrierName: string; serviceType: string; totalCost: number }[] | undefined): string {
  return (candidates ?? []).map((candidate, index) => `${index + 1}) ${candidate.carrierName} ${candidate.serviceType} - $${candidate.totalCost}`).join(", ");
}

/**
 * SALES-AGENT-R2-A11.2-C. Real T12 evidence only - price is appended when
 * the candidate carried one (never invented/guessed for a candidate T12
 * itself could not price).
 */
function productCandidatesList(candidates: { name: string; price?: { amount: number; currency: string } | null }[] | undefined): string {
  return (candidates ?? [])
    .map((candidate, index) => `${index + 1}) ${candidate.name}${candidate.price ? ` - $${candidate.price.amount}` : ""}`)
    .join(", ");
}
