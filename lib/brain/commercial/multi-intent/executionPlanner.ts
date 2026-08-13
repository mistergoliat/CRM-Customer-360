import type { PlannedActionStep, ResolvedIntent } from "./types";

/**
 * LLM-R1-T09A, Part 7/8 (CommercialExecutionPlanner). Deterministic, no LLM
 * call, no model-supplied ordering. Receives only already-validated intents
 * and already-resolved requirements (requirementResolver.ts) and produces a
 * canonical, backend-ordered list of real Capability Gateway capabilities to
 * run - never a capability for a requirement that is not "ready" or that a
 * dependency already failed.
 *
 * Fixed dependency rules (Part 8):
 *   select_products        - no dependency, runs whenever its own intent is "ready".
 *   set_shipping_destination - runs only when the customer stated a destination
 *                               THIS turn (DESTINATION source === "explicit");
 *                               a durable destination is reused silently, same
 *                               discipline as the legacy loop's own prompt rule
 *                               (buildAgentStepPromptPackage.ts SHIPPING_DESTINATION_RULE_LINES).
 *   calculate_shipping     - runs only when get_shipping_quote is "ready"
 *                             (PRODUCT_SELECTION + DESTINATION both resolved).
 *                             Depends on this turn's own select_products
 *                             outcome ONLY when PRODUCT_SELECTION's source is
 *                             "same_turn_intent" - a durably-satisfied selection
 *                             has no same-turn dependency at all (test 13:
 *                             "successful independent intent se conserva si
 *                             otra queda waiting" - the inverse case, an
 *                             independent durable selection, must not be
 *                             blocked by an unrelated same-turn failure either).
 *
 * select_products always precedes set_shipping_destination/calculate_shipping
 * in the returned list - the order the task's own examples use throughout.
 */
export function planCommercialActions(resolvedIntents: ResolvedIntent[]): PlannedActionStep[] {
  const steps: PlannedActionStep[] = [];

  const selectProductsIntent = resolvedIntents.find((resolved) => resolved.intent.type === "select_products" && resolved.status === "ready");
  if (selectProductsIntent && selectProductsIntent.intent.type === "select_products") {
    const productRequirement = selectProductsIntent.requirements.find((requirement) => requirement.type === "PRODUCT");
    const quantityRequirement = selectProductsIntent.requirements.find((requirement) => requirement.type === "QUANTITY");
    const product = productRequirement?.status === "resolved" ? (productRequirement.value as { productId: string; combinationId?: string }) : null;
    const quantity = quantityRequirement?.status === "resolved" ? (quantityRequirement.value as number) : null;
    if (product && quantity) {
      steps.push({
        capability: "select_products",
        forIntentIndex: selectProductsIntent.intentIndex,
        arguments: { items: [{ productId: product.productId, ...(product.combinationId ? { combinationId: product.combinationId } : {}), quantity }] }
      });
    }
  }

  for (const resolved of resolvedIntents) {
    if (resolved.intent.type !== "get_shipping_quote" || resolved.status !== "ready") continue;

    const destinationRequirement = resolved.requirements.find((requirement) => requirement.type === "DESTINATION");
    const productSelectionRequirement = resolved.requirements.find((requirement) => requirement.type === "PRODUCT_SELECTION");

    const destinationStatedThisTurn = destinationRequirement?.status === "resolved" && destinationRequirement.source === "explicit";
    const dependsOnSameTurnSelection = productSelectionRequirement?.status === "resolved" && productSelectionRequirement.source === "same_turn_intent";
    const dependsOnIntentIndex = dependsOnSameTurnSelection && selectProductsIntent ? selectProductsIntent.intentIndex : undefined;

    if (destinationStatedThisTurn && destinationRequirement?.status === "resolved") {
      // Independent of product selection - setting the destination commune
      // never depends on select_products, so this step never carries
      // dependsOnIntentIndex (unlike calculate_shipping below).
      steps.push({
        capability: "set_shipping_destination",
        forIntentIndex: resolved.intentIndex,
        arguments: { destination: destinationRequirement.value as string }
      });
    }

    steps.push({
      capability: "calculate_shipping",
      forIntentIndex: resolved.intentIndex,
      arguments: {},
      ...(dependsOnIntentIndex !== undefined ? { dependsOnIntentIndex } : {})
    });
  }

  return steps;
}
