import type { CustomerOnboardingPendingField } from "@/lib/domains/customer-onboarding";
import type { PersistedCommercialWork } from "./persistenceTypes";
import type { CommercialMissingRequirement, CommercialObjective } from "./types";
import { commercialObjectiveSupersessionFamily } from "./deriveCommercialObjectives";
import { deriveIdentityCollectionRequest, type OnboardingCollectionSnapshot } from "./identityCollectionRequest";

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
    // SALES-AGENT-R2-ID-R2-A11, PARTE 13. Two distinct completed outcomes for
    // the same objective type, distinguished by whether items ended up
    // resolved: a real historical purchase resolved through Catalog (reuses
    // describeSelectionObjective, same as SELECT_PRODUCTS, but names it as a
    // repeat purchase so the customer knows where it came from) vs. a
    // genuinely empty purchase history (never WAITING_CUSTOMER, never
    // re-triggers onboarding - just tells the truth and lets the
    // conversation move to ordinary discovery next turn).
    case "REPEAT_PURCHASE": {
      const description = describeSelectionObjective(objective);
      return description ? `Encontré tu compra anterior y dejé registrada ${description}` : "No encontré compras anteriores registradas para repetir";
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
    // SALES-AGENT-R2-ID-R2-A08, PARTE 12. HANDOFF's applyObjectiveState case
    // completes unconditionally (A07 doc section 7) but had no clause of its
    // own here before - a completed assisted-sale handoff produced no
    // customer-visible acknowledgement at all. Optional email enrichment
    // (see shouldOfferAssistedSaleEmailEnrichment below) is appended
    // separately, never inside this clause - PARTE 12/13 requires it to
    // never look like a requirement.
    case "HANDOFF":
      return "voy a conectar tu conversación con alguien del equipo para ayudarte directamente con esto";
    default:
      return null;
  }
}

// SALES-AGENT-R2-ID-R2-A08, PARTE 10/12. The three non-SUFFICIENT A06
// decision statuses that land an objective on BLOCKED (not WAITING_CUSTOMER
// - commercialIdentityGate.ts, ID-R2-A07, unmodified) yet still deserve a
// customer-facing message: READY_TO_LINK (consent ask), IDENTITY_CONFLICT
// (safe, generic - see release doc PARTE 9 on why no finer classification is
// possible here), ENTITY_VERIFICATION_REQUIRED (no real consumer yet, kept
// exhaustive). Distinct from waitingCustomerObjectives below, which only
// ever holds WAITING_CUSTOMER objectives.
const IDENTITY_BLOCKED_REQUIREMENTS = new Set<CommercialMissingRequirement>(["IDENTITY_LINK_PENDING", "IDENTITY_CONFLICT", "IDENTITY_VERIFICATION"]);

function identityBlockedObjectives(objectives: readonly CommercialObjective[]): CommercialObjective[] {
  return objectives.filter((objective) => objective.status === "BLOCKED" && objective.missingRequirements.some((requirement) => IDENTITY_BLOCKED_REQUIREMENTS.has(requirement)));
}

function buildIdentityBlockedMessage(objectives: readonly CommercialObjective[]): string {
  const first = objectives[0];
  if (first.missingRequirements.includes("IDENTITY_LINK_PENDING")) {
    // SALES-AGENT-R2-ID-R2-A09. Corrected wording: READY_TO_LINK (A04/A06)
    // is about bridging a verified PrestaShop candidate to the resolved
    // master, never about the WhatsApp channel itself (A08.1's root-cause
    // finding - the two are different mutations, see
    // link_prestashop_identity vs. link_external_identity). "vinculemos a
    // tu perfil" deliberately echoes LINK_PRESTASHOP_IDENTITY_PATTERN's own
    // vocabulary (consentEvidence.ts) so a natural affirmative reply is
    // likely to parse as consent for the RIGHT scope.
    return "Encontré una cuenta que coincide con los datos que verificamos. ¿Confirmas que la vinculemos a tu perfil para continuar?";
  }
  if (first.missingRequirements.includes("IDENTITY_CONFLICT")) {
    return "No pude confirmar tu identidad de forma automática porque encontré una inconsistencia en tus datos. Voy a derivar tu conversación con alguien del equipo para revisarlo.";
  }
  return "Necesito verificar algunos datos adicionales antes de continuar con esto.";
}

/**
 * SALES-AGENT-R2-ID-R2-A08, PARTE 12/13. Optional, never a blocker (the
 * handoff itself already completed by the time this runs - PARTE 12 is
 * explicit that a decline or a missing email must never hold it up). The
 * signal is the HANDOFF objective's mere existence in this turn's plan
 * (PARTE 13: "no inventar un nuevo intent classifier si CommercialWork ya
 * ofrece una señal suficiente") - never a new classifier. Fires only when
 * this conversation has no confirmed email evidence via the onboarding
 * pipeline yet; a customer already identified through a different path
 * (e.g. phone match, no onboarding row at all) may occasionally see this
 * redundantly - harmless, and cheaper than plumbing runtimeIdentity level
 * into this purely-message-building function for a secondary enrichment.
 * ponytail: coarse signal, tighten if a real duplicate-ask complaint shows up.
 */
function shouldOfferAssistedSaleEmailEnrichment(onboarding: OnboardingCollectionSnapshot | null): boolean {
  if (!onboarding) return true;
  return onboarding.pendingFields.includes("email");
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
    case "REPEAT_PURCHASE":
      return "estoy revisando tu compra anterior";
    default:
      return null;
  }
}

/**
 * SALES-AGENT-R2-ID-R2-A08, PARTE 2/19. `onboarding` is this turn's freshest
 * CustomerOnboardingState, already reduced to its privacy-safe projection by
 * the caller (runCommercialWorkInboundCycle.ts, from
 * runCustomerOnboardingPostPlanStage's result or, when the trigger did not
 * run this turn, the pre-plan session's own onboarding snapshot) - optional
 * so every existing caller/test that omits it keeps its exact current
 * behavior (falls back to the purpose's own required fields - see
 * identityCollectionRequest.ts).
 */
export function buildCommercialWorkFinalizerMessage(work: PersistedCommercialWork, onboarding: OnboardingCollectionSnapshot | null = null): CommercialWorkFinalizerResult {
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
    let message = completedClauses.length > 0 ? `Listo. ${capitalize(completedClauses.join("; "))}.` : "Listo, tu solicitud quedó completada.";
    // PARTE 12/13: optional, appended only after the handoff itself already
    // completed - never a condition for completion.
    if (completedObjectives.some((objective) => objective.type === "HANDOFF") && shouldOfferAssistedSaleEmailEnrichment(onboarding)) {
      message += " Si quieres, para que el equipo te pueda contactar con más contexto, compárteme tu correo electrónico (es opcional).";
    }
    return { disposition: "FINAL", message };
  }

  if (completedClauses.length > 0 && pendingClauses.length > 0) {
    return { disposition: "PARTIAL", message: `${capitalize(completedClauses.join("; "))} y ${pendingClauses.join(", ")}.` };
  }

  if (waitingCustomerObjectives.length > 0) {
    const message =
      completedClauses.length > 0
        ? `${capitalize(completedClauses.join("; "))}. ${buildMissingInfoQuestion(waitingCustomerObjectives, onboarding)}`
        : buildMissingInfoQuestion(waitingCustomerObjectives, onboarding);
    return { disposition: "BLOCKED", message };
  }

  // SALES-AGENT-R2-ID-R2-A08, PARTE 10/12. READY_TO_LINK/IDENTITY_CONFLICT/
  // ENTITY_VERIFICATION_REQUIRED land their objective on BLOCKED, not
  // WAITING_CUSTOMER (commercialIdentityGate.ts, ID-R2-A07, unmodified) - so
  // they never reach the branch above. Before A08 they fell all the way to
  // the generic "necesito un momento más" fallback at the end of this
  // function (see release doc PARTE 1) - this is the fix.
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
function buildMissingInfoQuestion(waitingCustomerObjectives: readonly CommercialObjective[], onboarding: OnboardingCollectionSnapshot | null): string {
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
  // SALES-AGENT-R2-ID-R2-A11, PARTE 8/9. Real previously-purchased products
  // only (objective.inputs.historicalPurchaseCandidates, A10's Customer
  // Profile boundary) - never invented, never the current-catalog
  // productCandidates list above (a different, later stage in the chain).
  if (missing.includes("REPEAT_PURCHASE_AMBIGUOUS")) {
    const objective = waitingCustomerObjectives.find((item) => item.missingRequirements.includes("REPEAT_PURCHASE_AMBIGUOUS"));
    const options = historicalPurchaseCandidatesList(objective?.inputs.historicalPurchaseCandidates);
    return options
      ? `Encontré varias compras anteriores que podrían ser esa: ${options}. ¿Cuál de estas quieres repetir?`
      : "Encontré varias compras anteriores. ¿Puedes decirme cuál de esos productos quieres repetir?";
  }
  if (missing.includes("PRODUCT") || missing.includes("PRODUCT_EVIDENCE")) return "¿Qué producto te interesa?";
  if (missing.includes("QUANTITY")) return "¿Cuántas unidades necesitas?";

  // SALES-AGENT-R2-ID-R2-A08 (PARTE 3/4/11/21, supersedes A07's minimal
  // version). Grounded in deriveIdentityCollectionRequest - onboarding's own
  // pendingFields when an onboarding row already exists this turn (excludes
  // whatever the customer already gave, and reflects the real purpose-driven
  // minimum), the purpose's required fields when it does not yet, or a
  // create-account consent ask once every field is in hand - never A06's
  // requiredEvidence directly (see release doc PARTE 1: it can be empty on a
  // brand-new conversation).
  if (missing.includes("IDENTITY_EVIDENCE")) {
    const objective = waitingCustomerObjectives.find((item) => item.missingRequirements.includes("IDENTITY_EVIDENCE"));
    const request = objective ? deriveIdentityCollectionRequest(objective, onboarding) : { kind: "NONE" as const };
    if (request.kind === "ASK_FIELDS") return buildAskFieldsMessage(request.fields);
    if (request.kind === "ASK_CREATE_CONSENT") return "Con esos datos puedo crear tu cuenta para continuar. ¿Confirmas que autorizas que creemos tu cuenta?";
    return "Para continuar necesito confirmar algunos datos tuyos. ¿Puedes ayudarme con eso?";
  }
  if (missing.includes("IDENTITY_AMBIGUOUS")) {
    return "Encontré más de una coincidencia con tus datos. ¿Puedes confirmarme tu correo electrónico o el número de tu pedido para identificarte con seguridad?";
  }

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

// SALES-AGENT-R2-ID-R2-A08 (PARTE 3/23). One clause per pending field,
// joined naturally - PARTE 23: multiple missing fields are asked together in
// one turn, never one-by-one artificially.
const PENDING_FIELD_CLAUSE: Record<CustomerOnboardingPendingField, string> = {
  email: "tu correo electrónico",
  orderReference: "el número de tu pedido",
  firstName: "tu nombre",
  lastName: "tu apellido"
};

function buildAskFieldsMessage(fields: readonly CustomerOnboardingPendingField[]): string {
  if (fields.length === 0) return "Para continuar necesito confirmar algunos datos tuyos. ¿Puedes ayudarme con eso?";
  const clauses = fields.map((field) => PENDING_FIELD_CLAUSE[field]);
  const joined = clauses.length === 1 ? clauses[0] : `${clauses.slice(0, -1).join(", ")} y ${clauses[clauses.length - 1]}`;
  return `Para continuar necesito que me confirmes ${joined}.`;
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

/** SALES-AGENT-R2-ID-R2-A11. Real historical purchases only (A10's Customer Profile boundary) - never a price/current-catalog claim, that stage has not run yet. */
function historicalPurchaseCandidatesList(candidates: { historicalName: string }[] | undefined): string {
  return (candidates ?? []).map((candidate, index) => `${index + 1}) ${candidate.historicalName}`).join(", ");
}
