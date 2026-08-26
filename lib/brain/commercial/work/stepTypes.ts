export const COMMERCIAL_WORK_STEP_TYPES = [
  "SEARCH_PRODUCTS",
  "GET_PRODUCT_DETAILS",
  "RECOMMEND_PRODUCTS",
  "SELECT_PRODUCTS",
  "SET_SHIPPING_DESTINATION",
  "CALCULATE_SHIPPING",
  "SELECT_SHIPPING_OPTION",
  "CREATE_QUOTE",
  "HANDOFF",
  // SALES-AGENT-R2-ID-R2-A11. Read-only: loads this customer's purchase
  // history via the ID-R2-A10 Customer Profile boundary. Never mutates
  // anything; a REPEAT_PURCHASE objective only ever derives this step before
  // it has a productReference - once history resolves one, the objective
  // falls through to the same SEARCH_PRODUCTS/SELECT_PRODUCTS steps any other
  // product request uses.
  "LOAD_PURCHASE_HISTORY"
] as const;

export type CommercialWorkStepType = (typeof COMMERCIAL_WORK_STEP_TYPES)[number];

export const COMMERCIAL_WORK_STEP_CAPABILITIES = [
  "search_products",
  "get_product_details",
  "recommend_catalog_products",
  "select_products",
  "set_shipping_destination",
  "calculate_shipping",
  "select_shipping_option",
  "create_quote",
  "get_customer_purchase_history"
] as const;

export type CommercialWorkStepCapability = (typeof COMMERCIAL_WORK_STEP_CAPABILITIES)[number];
