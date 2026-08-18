import { randomUUID } from "node:crypto";
import { getPool, queryRows } from "@/lib/db";
import {
  setupBenchmarkEnvironment,
  seedBenchmarkSelection,
  seedBenchmarkShippingDestination,
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
 * real conversation/master_customer/crm_opportunities rows R2 needs.
 */

export type R2BenchmarkEnvironment = {
  baseUrl: string;
  opportunityId: number;
  conversationId: number;
  waId: string;
  masterCustomerId: number;
  teardown: () => Promise<void>;
};

function unique(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function seedConversation(): Promise<{ id: number; waId: string }> {
  const waId = unique("wa");
  const [result] = await getPool().execute(
    `INSERT INTO conversation (
      public_id, channel, provider, channel_account_id, external_contact_id,
      status, owner_type, ai_enabled, human_owner_active
    ) VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0)`,
    [randomUUID(), unique("phone"), waId]
  );
  return { id: Number((result as { insertId: number }).insertId), waId };
}

async function seedMasterCustomer(): Promise<number> {
  const email = `${unique("r2-benchmark")}@example.invalid`;
  const [result] = await getPool().execute(
    `INSERT INTO master_customer (firstname, lastname, email, platform_origin) VALUES ('R2', 'Benchmark', ?, 'hub')`,
    [email]
  );
  return Number((result as { insertId: number }).insertId);
}

async function seedOpportunity(input: { waId: string; masterCustomerId: number }): Promise<number> {
  const [result] = await getPool().execute(
    `INSERT INTO crm_opportunities (
      opportunity_key, wa_id, channel, primary_intent, status, customer_master_id,
      requirements_json, missing_requirements_json, product_interests_json,
      objections_json, signals_json
    ) VALUES (?, ?, 'whatsapp', 'sales', 'open', ?, JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_OBJECT())`,
    [unique("r2-benchmark-opportunity"), input.waId, input.masterCustomerId]
  );
  return Number((result as { insertId: number }).insertId);
}

export async function setupR2BenchmarkEnvironment(carrierBehavior: BenchmarkCarrierBehavior = "success"): Promise<R2BenchmarkEnvironment> {
  const legacy = await setupBenchmarkEnvironment(carrierBehavior);
  const conversation = await seedConversation();
  const masterCustomerId = await seedMasterCustomer();
  const opportunityId = await seedOpportunity({ waId: conversation.waId, masterCustomerId });

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
