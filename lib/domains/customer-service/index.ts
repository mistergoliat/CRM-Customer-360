// Customer Service boundary (ACS-R1-04-T04.1). Domain, port and pure
// authority policies for create_customer / link_external_identity /
// record_customer_interest. NOT connected to the inbound runtime, the LLM,
// the Capability Gateway or Customer 360 - see docs/CAPABILITY_MATRIX.md
// ("Customer Service Port") and docs/releases/ACS-R1-04-customer-identity-onboarding.md.
// Wiring is ACS-R1-04-T06.
export * from "./types";
export * from "./ports";
export * from "./authority-policy";
export * from "./service";
