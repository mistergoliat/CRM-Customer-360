export * from "./types";
export * from "./repository";
export * from "./requestSelection";

export function isCustomerAddressesEnabled(): boolean {
  return process.env.BRAIN_CUSTOMER_ADDRESSES_ENABLED?.trim().toLowerCase() === "true";
}
