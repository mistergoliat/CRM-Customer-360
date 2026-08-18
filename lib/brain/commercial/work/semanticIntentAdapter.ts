import type { ResolvedIntent } from "@/lib/brain/commercial/multi-intent/types";
import type { CommercialObjectiveSeed } from "./types";

export function commercialObjectiveSeedsFromResolvedIntent(resolved: ResolvedIntent): CommercialObjectiveSeed[] {
  const seeds: CommercialObjectiveSeed[] = [];
  const requirement = (type: string) => resolved.requirements.find((item) => item.type === type);

  if (resolved.intent.type === "select_products") {
    const product = requirement("PRODUCT");
    const quantity = requirement("QUANTITY");
    const quantityValue = quantity?.status === "resolved" && typeof quantity.value === "number" ? quantity.value : undefined;

    if (product?.status === "resolved" && quantityValue !== undefined) {
      const value = product.value as { productId: string; combinationId?: string };
      seeds.push({
        type: "SELECT_PRODUCTS",
        origin: "customer_requested",
        inputs: { items: [{ productId: value.productId, combinationId: value.combinationId ?? null, quantity: quantityValue }] }
      });
      return seeds;
    }

    seeds.push({
      type: "SELECT_PRODUCTS",
      origin: "customer_requested",
      inputs: {
        ...(resolved.intent.productReference ? { productReference: resolved.intent.productReference } : {}),
        ...(quantityValue !== undefined ? { quantity: quantityValue } : {}),
        ...(product?.status === "ambiguous" ? { productEvidenceAvailable: false } : {})
      }
    });
    return seeds;
  }

  if (resolved.intent.type === "get_shipping_quote") {
    const destination = requirement("DESTINATION");
    if (destination?.status === "resolved" && destination.source === "explicit" && typeof destination.value === "string") {
      seeds.push({ type: "SET_DESTINATION", origin: "customer_requested", inputs: { destinationText: destination.value } });
    }
    seeds.push({
      type: "GET_SHIPPING_QUOTE",
      origin: "customer_requested",
      inputs: destination?.status === "resolved" && typeof destination.value === "string" ? { destinationText: destination.value } : {}
    });
  }

  return seeds;
}

export function commercialObjectiveSeedsFromResolvedIntents(resolvedIntents: readonly ResolvedIntent[]): CommercialObjectiveSeed[] {
  return resolvedIntents.filter((resolved) => resolved.intent.type !== "unsupported").flatMap(commercialObjectiveSeedsFromResolvedIntent);
}
