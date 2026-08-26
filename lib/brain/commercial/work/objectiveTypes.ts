export const COMMERCIAL_OBJECTIVE_TYPES = [
  "DISCOVER_PRODUCTS",
  "COMPARE_PRODUCTS",
  "RECOMMEND_PRODUCTS",
  "SELECT_PRODUCTS",
  "CHANGE_QUANTITY",
  "SET_DESTINATION",
  "GET_SHIPPING_QUOTE",
  "SELECT_SHIPPING_OPTION",
  "CREATE_QUOTE",
  "WAIT_FOR_QUOTE_APPROVAL",
  "HANDOFF",
  // SALES-AGENT-R2-ID-R2-A11. "Repeat a previous purchase" - customer profile
  // purchase history resolved into a productReference, then handed to the
  // exact same catalog-resolution/select_products chain a fresh product
  // request already uses (never a parallel workflow).
  "REPEAT_PURCHASE"
] as const;

export type CommercialObjectiveType = (typeof COMMERCIAL_OBJECTIVE_TYPES)[number];
