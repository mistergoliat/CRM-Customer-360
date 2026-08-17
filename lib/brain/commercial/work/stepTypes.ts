export const COMMERCIAL_WORK_STEP_TYPES = [
  "SEARCH_PRODUCTS",
  "GET_PRODUCT_DETAILS",
  "RECOMMEND_PRODUCTS",
  "SELECT_PRODUCTS",
  "SET_SHIPPING_DESTINATION",
  "CALCULATE_SHIPPING",
  "SELECT_SHIPPING_OPTION",
  "CREATE_QUOTE",
  "HANDOFF"
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
  "create_quote"
] as const;

export type CommercialWorkStepCapability = (typeof COMMERCIAL_WORK_STEP_CAPABILITIES)[number];
