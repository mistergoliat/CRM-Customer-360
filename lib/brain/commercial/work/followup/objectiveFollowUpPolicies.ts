import { createHash } from "node:crypto";
import type { CommercialObjective, CommercialWorkBlockerCode } from "../types";
import type { CommercialObjectiveType } from "../objectiveTypes";

export const OBJECTIVE_FOLLOW_UP_POLICIES = ["MISSING_INFORMATION", "SELECTION_INACTIVE", "QUOTE_PENDING"] as const;
export type ObjectiveFollowUpPolicy = (typeof OBJECTIVE_FOLLOW_UP_POLICIES)[number];

export type ObjectiveFollowUpWaitingReason =
  | CommercialWorkBlockerCode
  | "MISSING_PRODUCT"
  | "MISSING_PRODUCT_EVIDENCE"
  | "MISSING_QUANTITY"
  | "MISSING_DESTINATION"
  | "MISSING_SELECTION"
  | "MISSING_SHIPPING"
  | "MISSING_QUOTE"
  | "WAITING_CONFIRMATION"
  | "QUOTE_APPROVAL"
  | "UNKNOWN_WAITING_CUSTOMER_REASON";

export type ObjectiveFollowUpPolicyDefinition = {
  policy: ObjectiveFollowUpPolicy;
  eligibleObjectiveTypes: CommercialObjectiveType[];
  waitingReasons: ObjectiveFollowUpWaitingReason[];
  delaySequenceMinutes: number[];
  maxAttempts: number;
  stopConditions: string[];
  humanEscalationBehavior: "cancel_on_handoff" | "none";
};

export const OBJECTIVE_FOLLOW_UP_POLICY_REGISTRY: Record<ObjectiveFollowUpPolicy, ObjectiveFollowUpPolicyDefinition> = {
  MISSING_INFORMATION: {
    policy: "MISSING_INFORMATION",
    eligibleObjectiveTypes: ["SELECT_PRODUCTS", "SET_DESTINATION", "GET_SHIPPING_QUOTE", "CREATE_QUOTE"],
    waitingReasons: [
      "MISSING_PRODUCT",
      "MISSING_PRODUCT_EVIDENCE",
      "PRODUCT_AMBIGUOUS",
      "PRODUCT_NOT_FOUND",
      "MISSING_QUANTITY",
      "MISSING_DESTINATION",
      "MISSING_SELECTION",
      "MISSING_SHIPPING",
      "MISSING_QUOTE",
      "WAITING_CUSTOMER"
    ],
    delaySequenceMinutes: [60, 24 * 60],
    maxAttempts: 2,
    stopConditions: ["customer_replied", "objective_invalid", "handoff", "ai_disabled", "opt_out", "opportunity_terminal"],
    humanEscalationBehavior: "cancel_on_handoff"
  },
  SELECTION_INACTIVE: {
    policy: "SELECTION_INACTIVE",
    eligibleObjectiveTypes: ["SELECT_PRODUCTS", "CHANGE_QUANTITY"],
    waitingReasons: ["WAITING_CONFIRMATION", "MISSING_PRODUCT", "MISSING_QUANTITY", "WAITING_CUSTOMER"],
    delaySequenceMinutes: [3 * 60, 24 * 60],
    maxAttempts: 2,
    stopConditions: ["customer_replied", "objective_invalid", "handoff", "ai_disabled", "opt_out", "opportunity_terminal"],
    humanEscalationBehavior: "cancel_on_handoff"
  },
  QUOTE_PENDING: {
    policy: "QUOTE_PENDING",
    eligibleObjectiveTypes: ["WAIT_FOR_QUOTE_APPROVAL"],
    waitingReasons: ["QUOTE_APPROVAL", "WAITING_CUSTOMER"],
    delaySequenceMinutes: [3 * 60, 24 * 60, 3 * 24 * 60],
    maxAttempts: 3,
    stopConditions: ["customer_replied", "objective_invalid", "quote_expired_or_superseded", "handoff", "ai_disabled", "opt_out", "opportunity_terminal"],
    humanEscalationBehavior: "cancel_on_handoff"
  }
};

export function isObjectiveFollowUpPolicy(value: string | null | undefined): value is ObjectiveFollowUpPolicy {
  return (OBJECTIVE_FOLLOW_UP_POLICIES as readonly string[]).includes(value ?? "");
}

export function getObjectiveFollowUpPolicyDefinition(policy: ObjectiveFollowUpPolicy): ObjectiveFollowUpPolicyDefinition {
  return OBJECTIVE_FOLLOW_UP_POLICY_REGISTRY[policy];
}

export function deriveObjectiveWaitingReason(objective: CommercialObjective): ObjectiveFollowUpWaitingReason {
  const blocker = objective.blockers.find((item) => item.source === "objective" || item.objectiveId === objective.objectiveId);
  if (blocker?.code) return blocker.code;

  const missing = objective.missingRequirements[0];
  if (missing === "PRODUCT") return "MISSING_PRODUCT";
  if (missing === "PRODUCT_EVIDENCE") return "MISSING_PRODUCT_EVIDENCE";
  if (missing === "QUANTITY") return "MISSING_QUANTITY";
  if (missing === "DESTINATION") return "MISSING_DESTINATION";
  if (missing === "SELECTION") return "MISSING_SELECTION";
  if (missing === "SHIPPING") return "MISSING_SHIPPING";
  if (missing === "QUOTE") return "MISSING_QUOTE";

  if (objective.type === "WAIT_FOR_QUOTE_APPROVAL") return "QUOTE_APPROVAL";
  if (objective.status === "WAITING_CUSTOMER") return "WAITING_CUSTOMER";
  return "UNKNOWN_WAITING_CUSTOMER_REASON";
}

export function mapObjectiveToFollowUpPolicy(objective: CommercialObjective): ObjectiveFollowUpPolicy | null {
  const waitingReason = deriveObjectiveWaitingReason(objective);

  if (objective.type === "WAIT_FOR_QUOTE_APPROVAL") return "QUOTE_PENDING";
  if (objective.type === "SELECT_PRODUCTS" || objective.type === "CHANGE_QUANTITY") {
    if (waitingReason === "WAITING_CUSTOMER" || waitingReason === "WAITING_CONFIRMATION") return "SELECTION_INACTIVE";
    return "MISSING_INFORMATION";
  }
  if (objective.type === "SET_DESTINATION" || objective.type === "GET_SHIPPING_QUOTE" || objective.type === "CREATE_QUOTE") {
    return "MISSING_INFORMATION";
  }
  return null;
}

export function buildObjectiveFollowUpSequenceKey(input: {
  commercialWorkPublicId: string;
  commercialObjectivePublicId: string;
  policy: ObjectiveFollowUpPolicy;
}): string {
  const digest = createHash("sha256")
    .update(`${input.commercialWorkPublicId}|${input.commercialObjectivePublicId}|${input.policy}`)
    .digest("hex")
    .slice(0, 32);
  return `objective-followup-${digest}`;
}

export function buildObjectiveFollowUpMessage(input: {
  policy: ObjectiveFollowUpPolicy;
  waitingReason: ObjectiveFollowUpWaitingReason;
  objective: CommercialObjective;
}): string {
  if (input.policy === "QUOTE_PENDING") {
    return "Hola, queria saber si pudiste revisar la cotizacion y si quieres que sigamos con el pedido.";
  }
  if (input.waitingReason === "MISSING_DESTINATION") {
    return "Hola, para avanzar con el despacho necesito que me confirmes la comuna de destino.";
  }
  if (input.waitingReason === "MISSING_SELECTION" || input.waitingReason === "MISSING_PRODUCT") {
    return "Hola, para avanzar necesito que me confirmes que producto quieres considerar.";
  }
  if (input.waitingReason === "PRODUCT_AMBIGUOUS") {
    return "Hola, encontré varias opciones para el producto que buscas. ¿Me confirmas cuál de ellas te interesa?";
  }
  if (input.waitingReason === "PRODUCT_NOT_FOUND") {
    return "Hola, no encontré ese producto en el catálogo. ¿Puedes confirmarme el nombre exacto?";
  }
  return "Hola, quedo pendiente tu confirmacion para poder avanzar con la solicitud.";
}
