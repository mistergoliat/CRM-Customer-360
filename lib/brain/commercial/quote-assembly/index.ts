// Quote Input Assembler (SALES-AGENT-R1-T2). Deterministic, read-only:
// commercial_line_items + Catalog Service + customer identity ->
// QuoteServiceCreateRequest. No capability registration, no Quote Service
// mutation, no runtime wiring - see docs/integrations/quote-input-assembly.md.
export * from "./types";
export * from "./errors";
export * from "./opportunityCore";
export * from "./assembleQuoteInput";
