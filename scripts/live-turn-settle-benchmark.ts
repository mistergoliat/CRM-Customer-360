/**
 * SALES-AGENT-R3-V1.8.1. Real-provider structural benchmark for inbound turn
 * settling (release doc Section X). Real DeepSeek (BRAIN_MODEL_*), real
 * crm_test MariaDB, real webhook entry point (processNativeWhatsAppInbound)
 * for every fragment, real turn-settlement worker tick (runTurnSettleTick,
 * no injected provider). No real Meta send (BRAIN_META_SEND_ENABLED=false) -
 * per Section X, real WhatsApp/Meta delivery is not required for this
 * benchmark; typing/dispatch correctness with a real Meta call is validated
 * separately (Section Y / T12-T14, already proven deterministically with a
 * fake provider in tests/native/inboundTurnSettling.e2e.test.ts).
 *
 * Scenarios (Section X):
 *   A - single complete message
 *   B - three rapid fragments ("hola" / "como" / "estas")
 *   C - product request split across four fragments
 *   D - correction split across three fragments
 * Scenario E (new inbound injected mid-cognition) is deliberately NOT
 * reproduced here with a real, timing-fragile LLM call - it is already
 * proven deterministically in the e2e suite's [T9] test via a fake provider
 * whose invoke() itself injects the race at the exact right instant, which a
 * live script cannot guarantee against real, variable DeepSeek latency.
 *
 * Usage:
 *   npx tsx scripts/live-turn-settle-benchmark.ts
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadEnvFile, PROJECT_ROOT } from "./db-utils";

async function loadRuntimeEnv() {
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env.local"), false);
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env"), false);
  Object.assign(process.env, {
    NODE_ENV: "development",
    DB_HOST: "127.0.0.1",
    DB_PORT: "3306",
    DB_NAME: "crm_test",
    DB_USER: "crm_app",
    DB_PASSWORD: "una_clave_local",
    DB_URL: "",
    DATABASE_URL: "",
    DB_WRITE_ENABLED: "true",
    BRAIN_META_SEND_ENABLED: "false",
    BRAIN_OUTBOX_WORKER_ENABLED: "false",
    BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED: "false",
    BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false",
    BRAIN_AGENT_TOOL_LOOP_ENABLED: "false",
    BRAIN_MULTI_INTENT_PLANNER_ENABLED: "false",
    BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED: "false",
    BRAIN_WHATSAPP_TEST_MODE_ENABLED: "false",
    BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true",
    BRAIN_R3_INBOUND_TURN_SETTLE_DELAY_MS: "800",
    BRAIN_R3_INBOUND_TURN_SETTLE_MAX_MS: "5000"
  });
}

function newWaId() {
  return `5699${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 15);
}

async function main() {
  await loadRuntimeEnv();
  if (!process.env.BRAIN_MODEL_API_KEY || !process.env.BRAIN_MODEL_API_URL || !process.env.BRAIN_MODEL_NAME) {
    throw new Error("Missing BRAIN_MODEL_API_KEY/BRAIN_MODEL_API_URL/BRAIN_MODEL_NAME - required for the live LLM. Cannot claim PASS without it.");
  }

  const { getPool, safeQueryRows } = await import("../lib/db");
  const { processNativeWhatsAppInbound } = await import("../lib/brain/native-whatsapp/service");
  const { runTurnSettleTick } = await import("../lib/brain/commercial/turn-settlement");

  type TurnSettlementRowLite = { id: number; status: string; fragment_count: number };

  async function loadTurnRow(waId: string): Promise<TurnSettlementRowLite | null> {
    const result = await safeQueryRows<TurnSettlementRowLite>(
      "SELECT id, status, fragment_count FROM crm_inbound_turn_settlements WHERE wa_id = ? ORDER BY id DESC LIMIT 1",
      [waId]
    );
    return result.ok ? result.rows[0] ?? null : null;
  }

  async function loadOutboxMessage(waId: string): Promise<{ message_text: string | null; status: string } | null> {
    const result = await safeQueryRows<{ message_text: string | null; status: string }>(
      "SELECT message_text, status FROM brain_message_outbox WHERE wa_id = ? ORDER BY id DESC LIMIT 1",
      [waId]
    );
    return result.ok ? result.rows[0] ?? null : null;
  }

  async function runScenario(name: string, fragments: string[]) {
    process.env.BRAIN_SALES_AGENT_RUNTIME_ENABLED = "true";
    const waId = newWaId();
    process.env.BRAIN_SALES_AGENT_RUNTIME_WA_IDS = waId;
    process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = waId;

    const phoneNumberId = `phone-livebench-${randomUUID().slice(0, 8)}`;
    const firstFragmentAt = Date.now();

    for (const fragment of fragments) {
      await processNativeWhatsAppInbound({
        providerMessageId: `wamid.${randomUUID()}`,
        phoneNumberId,
        externalSenderId: waId,
        senderPhone: waId,
        senderName: "Live Benchmark Customer",
        messageType: "text",
        text: fragment,
        occurredAt: new Date().toISOString(),
        rawPayload: {}
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const lastFragmentAt = Date.now();

    // Wait past the quiet window before ticking - realistic worker cadence,
    // not a synthetic zero-delay call.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const tickStartedAt = Date.now();
    await runTurnSettleTick({ limit: 5 });
    const tickFinishedAt = Date.now();

    const turnRow = await loadTurnRow(waId);
    const outboxMessage = await loadOutboxMessage(waId);

    console.log(`\n=== Scenario ${name} ===`);
    console.log(`fragments: ${JSON.stringify(fragments)}`);
    console.log(`turn row: status=${turnRow?.status ?? "MISSING"} fragment_count=${turnRow?.fragment_count ?? "n/a"}`);
    console.log(`dispatched message: ${outboxMessage ? JSON.stringify(outboxMessage.message_text) : "(none)"} status=${outboxMessage?.status ?? "n/a"}`);
    console.log(`timing: fragments_span_ms=${lastFragmentAt - firstFragmentAt} settle_to_dispatch_ms=${tickFinishedAt - tickStartedAt} total_ms=${tickFinishedAt - firstFragmentAt}`);

    return {
      name,
      status: turnRow?.status ?? "MISSING",
      fragmentCount: turnRow?.fragment_count ?? 0,
      dispatched: Boolean(outboxMessage),
      totalMs: tickFinishedAt - firstFragmentAt
    };
  }

  const results = [];
  results.push(await runScenario("A - single message", ["Hola, buenas tardes"]));
  results.push(await runScenario("B - three rapid fragments", ["hola", "como", "estas"]));
  results.push(await runScenario("C - product request split", ["quiero una barra", "olimpica", "de 20kg", "para home gym"]));
  results.push(await runScenario("D - correction split", ["cotizame la de 20kg", "espera", "mejor la de 15kg"]));

  console.log("\n=== Summary ===");
  for (const result of results) {
    console.log(`${result.name}: status=${result.status} fragments=${result.fragmentCount} dispatched=${result.dispatched} total_ms=${result.totalMs}`);
  }

  const allSettledOrSuperseded = results.every((result) => result.status === "COMPLETED" || result.status === "SUPERSEDED");
  if (!allSettledOrSuperseded) {
    throw new Error("At least one scenario left its turn row PENDING/PROCESSING - see summary above.");
  }

  await getPool().end();
}

main().catch((error) => {
  console.error("[live-turn-settle-benchmark] fatal:", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
