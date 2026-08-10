import type { CommuneCatalogLookupResult } from "./types";

// Boundary the commune-resolution domain depends on. The one productive
// implementation is lib/integrations/logistics/pc-pos-adapter.ts - the domain
// never imports mysql2, pc_pos, or any DB credential directly (T13C section 9).
export interface CommuneCatalogPort {
  /** normalizedName must already be a comparisonKey() value - the port matches, it does not normalize. */
  findByNormalizedName(normalizedName: string): Promise<CommuneCatalogLookupResult>;
}
