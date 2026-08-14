import { safeQueryRows } from "@/lib/db";
import type { OpportunityCoreForQuoteAssembly } from "./types";

type OpportunityCoreRow = {
  id: number;
  customer_master_id: string | null;
  wa_id: string | null;
};

/**
 * SALES-AGENT-R1-T2. Minimal read over crm_opportunities - only the columns
 * quote assembly needs (customer_master_id to resolve a customerSnapshot,
 * wa_id as the already-established phone-equivalent identity). Deliberately
 * not a general-purpose "opportunities repository" addition - scoped to this
 * one caller, matching this module's own YAGNI boundary. Never used by any
 * Hub read model.
 */
export async function getOpportunityCoreForQuoteAssembly(opportunityId: number): Promise<OpportunityCoreForQuoteAssembly | null> {
  const result = await safeQueryRows<OpportunityCoreRow>(
    "SELECT id, customer_master_id, wa_id FROM crm_opportunities WHERE id = ? LIMIT 1",
    [opportunityId]
  );
  if (!result.ok || !result.rows[0]) return null;
  const row = result.rows[0];
  return {
    id: Number(row.id),
    customerMasterId: row.customer_master_id ?? null,
    waId: row.wa_id ?? null
  };
}
