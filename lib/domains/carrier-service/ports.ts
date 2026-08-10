import type { CarrierQuoteInput, CarrierQuoteResult } from "./types";

/** Boundary the commercial domain depends on. The one real implementation is lib/integrations/carrier-service/httpCarrierServiceAdapter.ts. */
export interface CarrierService {
  quoteAll(input: CarrierQuoteInput): Promise<CarrierQuoteResult>;
}
