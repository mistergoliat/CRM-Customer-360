import type { CapabilityGatewayContext } from "../capability-gateway/types";
import type { CommercialWorkStep } from "../work/types";
import { getActionTypeForCapability } from "./actionCapabilityMapping";
import { buildCommercialActionRequestId } from "./requestIdentity";
import type {
  CommercialActionRequest,
  CreateQuoteActionInput,
  IssueQuoteActionInput,
  SelectProductsActionInput,
  SelectShippingOptionActionInput,
  SendQuoteEmailActionInput,
  SetShippingDestinationActionInput
} from "./types";

/**
 * Adapts a durable CommercialWork step to the same governed mutation
 * boundary used by the Agent Tool Loop. The step id is the causation anchor:
 * it remains stable across worker retries, so the request id and downstream
 * Quote Service idempotency key cannot drift between attempts.
 */
export function buildCommercialActionRequestFromWorkStep(input: {
  step: CommercialWorkStep;
  context: Pick<CapabilityGatewayContext, "conversationId" | "opportunityId" | "correlationId">;
  now?: () => Date;
}): CommercialActionRequest | null {
  if (input.context.conversationId === null || input.context.conversationId === undefined) return null;
  if (!input.step.capabilityName) return null;

  const actionType = getActionTypeForCapability(input.step.capabilityName);
  if (!actionType) return null;
  const causationId = input.step.stepId;
  const base = {
    conversationId: input.context.conversationId,
    opportunityId: input.context.opportunityId ?? null,
    correlationId: input.context.correlationId,
    causationId,
    source: "commercial_work" as const,
    createdAt: (input.now ?? (() => new Date()))().toISOString()
  };

  let requestInput: CommercialActionRequest["input"];
  switch (actionType) {
    case "SELECT_PRODUCTS":
      requestInput = {
        items: (input.step.input.items ?? []).map((item) => ({
          productId: item.productId,
          ...(item.combinationId ? { combinationId: item.combinationId } : {}),
          quantity: item.quantity
        }))
      } satisfies SelectProductsActionInput;
      break;
    case "SET_SHIPPING_DESTINATION":
      requestInput = { destination: input.step.input.destinationText ?? input.step.input.canonicalDestinationName ?? "" } satisfies SetShippingDestinationActionInput;
      break;
    case "SELECT_SHIPPING_OPTION":
      requestInput = { optionIndex: input.step.input.optionIndex as number } satisfies SelectShippingOptionActionInput;
      break;
    case "CREATE_QUOTE":
      requestInput = {} satisfies CreateQuoteActionInput;
      break;
    case "ISSUE_QUOTE":
      requestInput = {} satisfies IssueQuoteActionInput;
      break;
    case "SEND_QUOTE_EMAIL":
      requestInput = input.step.input.recipient ? { recipient: input.step.input.recipient } satisfies SendQuoteEmailActionInput : {};
      break;
  }

  return {
    ...base,
    actionType,
    input: requestInput as never,
    requestId: buildCommercialActionRequestId({ conversationId: input.context.conversationId, causationId, actionType, input: requestInput })
  } as CommercialActionRequest;
}
