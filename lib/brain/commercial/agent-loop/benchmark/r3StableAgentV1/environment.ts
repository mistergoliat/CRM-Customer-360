import { resolveNamedDatabaseConnection } from "@/lib/database-config";
import {
  setupBenchmarkEnvironment,
  seedDurableBenchmarkConversation,
  seedDurableBenchmarkMasterCustomer,
  seedDurableBenchmarkOpportunity,
  type BenchmarkCarrierBehavior,
  type BenchmarkEnvironment
} from "../environment";

/**
 * R3 Stable Agent Acceptance Harness V1 FIX1. The legacy
 * setupBenchmarkEnvironment() (../environment.ts) returns a synthetic,
 * never-persisted opportunityId/conversationId - fine for the legacy C01-C12
 * corpus (never exercises a capability that writes to
 * crm_capability_executions, whose opportunity_id/conversation_id columns
 * are real foreign keys - migration 022), but wrong for the R3 golden corpus:
 * TS-005 seeds a real completed calculate_shipping execution via
 * executeGovernedCapability() directly in its `setup`, which INSERTs into
 * crm_capability_executions with this environment's conversationId/
 * opportunityId as FK targets - a synthetic id fails that FK, which is the
 * root cause of "benchmark fixture setup: failed to seed ... (status=
 * persistence_failed)".
 *
 * Fix: wrap the legacy environment (unchanged, still used as-is for the
 * Catalog/Carrier/commune fakes) with the same real conversation/
 * master_customer/crm_opportunities rows SALES-AGENT-R2-A07.5 already
 * proved out for create_quote (work/benchmark/environment.ts) - same
 * seedDurableBenchmark*() calls, not a second implementation.
 *
 * This wrapper is intentionally NOT folded into the base
 * setupBenchmarkEnvironment(): that function is shared with the legacy
 * corpus, which runs against DB_NAME=main_management
 * (tests/agent-loop/benchmark/offlineHarnessEndToEnd.test.ts) - making real
 * DB inserts unconditional there would break it. This wrapper is the R3-only
 * entry point, so it is the one that carries the explicit safety gate below.
 */
export type R3BenchmarkEnvironment = BenchmarkEnvironment & {
  waId: string;
  masterCustomerId: number;
};

/**
 * Task safety requirement: this function inserts real rows, so it must never
 * run anywhere but the local crm_test fixture database. Aborts (throws)
 * rather than silently falling back to main_management or any other
 * database.
 */
function assertCrmTestDurableFixtureIsSafe(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      `R3 benchmark durable fixture refused: NODE_ENV must be "test" (got "${process.env.NODE_ENV ?? "unset"}"). Never seeds durable rows outside NODE_ENV=test.`
    );
  }
  const connection = resolveNamedDatabaseConnection("app");
  if (connection.database !== "crm_test") {
    throw new Error(
      `R3 benchmark durable fixture refused: database must be "crm_test" (got "${connection.database ?? "unset"}"). Never falls back to main_management or any other database.`
    );
  }
}

export async function setupR3BenchmarkEnvironment(carrierBehavior: BenchmarkCarrierBehavior = "success"): Promise<R3BenchmarkEnvironment> {
  assertCrmTestDurableFixtureIsSafe();

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
    // FIX1 section 3: same convention SALES-AGENT-R2-A07.5 already established
    // for this exact table set - the conversation/master_customer/
    // crm_opportunities rows are left in crm_test (never deleted), identified
    // only by their unique "benchmark-fixture*" markers
    // (uniqueBenchmarkToken() in ../environment.ts). crm_capability_executions
    // rows written against them carry the same FK and are left too. No
    // teardown DELETE is attempted here: crm_capability_executions'
    // opportunity_id/conversation_id FKs are ON DELETE SET NULL (migration
    // 022), so deleting would be FK-safe, but doing it correctly also means
    // deleting every crm_request_facts row keyed by this opportunityId's
    // request anchors - a second cleanup surface with its own risk of
    // deleting a fact this run didn't own. Leaving fixtures behind, uniquely
    // marked, is the same tradeoff already accepted for R2 - not repeated
    // here as a new deviation.
    teardown: legacy.teardown
  };
}
