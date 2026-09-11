import { getPool, queryRows } from "@/lib/db";
import {
  setupBenchmarkEnvironment,
  seedBenchmarkSelection,
  seedBenchmarkShippingDestination,
  seedDurableBenchmarkConversation,
  seedDurableBenchmarkMasterCustomer,
  seedDurableBenchmarkOpportunity,
  type BenchmarkCarrierBehavior
} from "../../agent-loop/benchmark/environment";

/**
 * SALES-AGENT-R2-A07.5. The legacy T08 benchmark environment
 * (setupBenchmarkEnvironment) fakes Catalog/Carrier/commune resolution but
 * deliberately never inserts a real crm_opportunities row (its opportunityId
 * is a synthetic, never-persisted number) - fine for the Agent Tool Loop,
 * but create_quote's real assembleQuoteInput() needs a real
 * crm_opportunities row (customer_master_id, wa_id) and a real
 * master_customer row to resolve a customer snapshot. This wraps the legacy
 * environment unchanged for Catalog/Carrier/commune fakes, and adds the
 * real conversation/master_customer/crm_opportunities rows R2 needs -
 * seeded via seedDurableBenchmark*() (agent-loop/benchmark/environment.ts),
 * the same durable-row insert logic the R3 Stable Agent Acceptance Harness
 * V1 fixture (r3StableAgentV1/environment.ts) now reuses, so this business
 * logic lives in exactly one place (R3 FIX1).
 */

export type R2BenchmarkEnvironment = {
  baseUrl: string;
  opportunityId: number;
  conversationId: number;
  waId: string;
  masterCustomerId: number;
  teardown: () => Promise<void>;
};

export async function setupR2BenchmarkEnvironment(carrierBehavior: BenchmarkCarrierBehavior = "success"): Promise<R2BenchmarkEnvironment> {
  const legacy = await setupBenchmarkEnvironment(carrierBehavior);
  const conversation = await seedDurableBenchmarkConversation();
  const masterCustomerId = await seedDurableBenchmarkMasterCustomer();
  const opportunityId = await seedDurableBenchmarkOpportunity({ waId: conversation.waId, masterCustomerId });

  return {
    baseUrl: legacy.baseUrl,
    opportunityId,
    conversationId: conversation.id,
    waId: conversation.waId,
    masterCustomerId,
    teardown: legacy.teardown
  };
}

export async function setConversationControl(conversationId: number, control: { humanOwnerActive?: boolean; aiEnabled?: boolean }): Promise<void> {
  if (typeof control.humanOwnerActive === "boolean") {
    await getPool().execute(`UPDATE conversation SET human_owner_active = ? WHERE id = ?`, [control.humanOwnerActive ? 1 : 0, conversationId]);
  }
  if (typeof control.aiEnabled === "boolean") {
    await getPool().execute(`UPDATE conversation SET ai_enabled = ? WHERE id = ?`, [control.aiEnabled ? 1 : 0, conversationId]);
  }
}

export async function readConversationControl(conversationId: number): Promise<{ humanOwnerActive: boolean; aiEnabled: boolean }> {
  const rows = await queryRows<{ human_owner_active: number | boolean; ai_enabled: number | boolean }>(
    "SELECT human_owner_active, ai_enabled FROM conversation WHERE id = ? LIMIT 1",
    [conversationId]
  );
  const row = rows[0];
  if (!row) return { humanOwnerActive: false, aiEnabled: true };
  return { humanOwnerActive: Boolean(row.human_owner_active), aiEnabled: Boolean(row.ai_enabled) };
}

export { seedBenchmarkSelection, seedBenchmarkShippingDestination };
