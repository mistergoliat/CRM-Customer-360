/**
 * LLM-R1-T09B. WhatsApp allowlisted multi-intent smoke (WA01-WA07).
 *
 * Real code path: processNativeWhatsAppInbound (the exact function the real
 * webhook route calls after persisting an inbound event) -> real DB -> real
 * live LLM (deepseek-v4-flash, thinking=disabled for the allowlisted
 * multi-intent path) -> real dispatch/outbox write. No real Meta API call is
 * ever made (BRAIN_META_SEND_ENABLED=false, this script never runs the
 * outbox worker) - this dev environment's Meta webhook is not wired to it at
 * all (see whatsapp_real_send_constraints in memory), so a literal
 * phone-to-phone round trip is not achievable here regardless; the outgoing
 * response is read directly from the planned brain_message_outbox row.
 *
 * Real: DB persistence (select_products/set_shipping_destination/pending
 * intent facts), commune resolver (real pc_pos.comuna), Carrier MS
 * (http://ms.pesaschile.cl, reachable). Fixture-only: Catalog Service (the
 * real instance at CATALOG_SERVICE_BASE_URL is not reachable in this
 * environment - a documented, pre-existing, out-of-scope infra issue, not a
 * T09B defect - substituted with the same local HTTP fixture
 * lib/brain/commercial/agent-loop/benchmark/environment.ts already uses for
 * T09A's own live-validated benchmark).
 *
 * Usage:
 *   npx tsx scripts/manual-test/whatsapp-multi-intent-smoke.ts
 *   npx tsx scripts/manual-test/whatsapp-multi-intent-smoke.ts --case=WA01,WA03
 */
import path from "node:path";
import { loadLocalEnv, loadEnvFile, PROJECT_ROOT } from "../db-utils";

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : null;
}

function readFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

async function loadRuntimeEnv() {
  await loadLocalEnv();
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env.local"), false);
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env"), false);
  Object.assign(process.env, {
    DB_WRITE_ENABLED: "true",
    BRAIN_META_SEND_ENABLED: "false", // hard safety: no real Meta call is ever made by this script
    BRAIN_AGENT_TOOL_LOOP_ENABLED: "true",
    BRAIN_MULTI_INTENT_PLANNER_ENABLED: "true"
  });
}

type CapturedEvent = Record<string, unknown>;

/** Captures this process's own structured console.info observability events (multi_intent_*) for the duration of one scenario - never intercepts anything else, restores console.info afterward. */
function captureConsoleInfo(): { events: CapturedEvent[]; stop: () => void } {
  const events: CapturedEvent[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    const [first] = args;
    if (first && typeof first === "object" && typeof (first as Record<string, unknown>).event === "string" && String((first as Record<string, unknown>).event).startsWith("multi_intent_")) {
      events.push(first as CapturedEvent);
    }
    original(...args);
  };
  return { events, stop: () => { console.info = original; } };
}

async function main() {
  await loadRuntimeEnv();
  if (!process.env.BRAIN_MODEL_API_KEY || !process.env.BRAIN_MODEL_API_URL || !process.env.BRAIN_MODEL_NAME) {
    throw new Error("Missing BRAIN_MODEL_API_KEY/BRAIN_MODEL_API_URL/BRAIN_MODEL_NAME in .env - required for the live LLM.");
  }

  const { safeQueryRows, getPool } = await import("../../lib/db");
  const { processNativeWhatsAppInbound } = await import("../../lib/brain/native-whatsapp/service");
  const { setupBenchmarkEnvironment, seedBenchmarkSelection, seedBenchmarkShippingDestination, BENCHMARK_PRODUCTS } = await import(
    "../../lib/brain/commercial/agent-loop/benchmark/environment"
  );
  const { resetCommuneResolverForTests } = await import("../../lib/brain/commercial/capability-gateway/shippingDestinationCapability");
  const { resetCalculateShippingCarrierServiceForTests } = await import("../../lib/brain/commercial/capability-gateway/calculateShippingCapability");
  const { loadPendingCommercialIntents } = await import("../../lib/brain/commercial/multi-intent/pendingIntentState");

  const caseFilter = readArg("case")?.split(",").map((value) => value.trim());
  const shouldRun = (id: string) => !caseFilter || caseFilter.includes(id);

  /**
   * --fake-commune: supplementary mode only, off by default. The primary run
   * (default) keeps the REAL commune resolver and REAL Carrier MS (Part 7:
   * "No bypass: ... commune resolver ... Carrier MS") - a real, pre-existing,
   * out-of-scope environment gap was found this way (LOGISTICS_DB_ENABLED is
   * not configured in this dev environment, so the real commune resolver
   * cannot reach pc_pos.comuna at all - see the release doc's "Non-blocking
   * finding"). This flag exists only to independently confirm the
   * multi-intent CODE path itself is sound once a commune resolves - it
   * reuses T09A's own already-live-validated benchmark fixture
   * (setupBenchmarkEnvironment's fake resolver/Carrier), never a claim that
   * this is what the primary, default run does.
   */
  const useFakeCommune = readFlag("fake-commune");

  // Local Catalog Service fixture always (Part 8's own scope note - see file
  // header: the real instance is unreachable here). Commune resolver +
  // Carrier MS are REAL unless --fake-commune was explicitly passed.
  const catalogEnv = await setupBenchmarkEnvironment();
  if (!useFakeCommune) {
    resetCommuneResolverForTests();
    resetCalculateShippingCarrierServiceForTests();
  } else {
    console.log("[t09b-smoke] --fake-commune: using T09A's fixture commune/Carrier data, NOT the real pc_pos/Carrier MS integration.");
  }
  const CLASSIC = BENCHMARK_PRODUCTS["31"];
  const PRO = BENCHMARK_PRODUCTS["32"];

  type Evidence = Record<string, unknown>;
  const report: Array<{ caseId: string; evidence: Evidence }> = [];

  function uniqueWaId(seed: string): string {
    // A synthetic, never-real number - 569 + 8 digits, same shape convention tests/e2e-autonomous-harness.ts's own newIdentity() uses.
    const digits = `${Date.now()}${seed}`.replace(/\D/g, "").slice(-8).padStart(8, "0");
    return `569${digits}`;
  }

  async function inject(waId: string, text: string) {
    process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = waId;
    const capture = captureConsoleInfo();
    const startedAt = Date.now();
    const result = await processNativeWhatsAppInbound({
      providerMessageId: `wamid.t09b-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      phoneNumberId: "phone-t09b-smoke",
      externalSenderId: waId,
      senderPhone: waId,
      senderName: "Cliente T09B Smoke",
      messageType: "text",
      text,
      occurredAt: new Date().toISOString(),
      rawPayload: { simulated: true }
    });
    const elapsedMs = Date.now() - startedAt;
    capture.stop();
    return { result, events: capture.events, elapsedMs };
  }

  async function readOutboxMessage(conversationId: number): Promise<string | null> {
    const rows = await safeQueryRows<{ message_text: string | null }>(
      "SELECT message_text FROM brain_message_outbox WHERE conversation_case_id = ? ORDER BY id DESC LIMIT 1",
      [conversationId]
    );
    return rows.ok ? (rows.rows[0]?.message_text ?? null) : null;
  }

  async function readAgentToolLoopEvent(correlationId: string): Promise<Record<string, unknown> | null> {
    const rows = await safeQueryRows<{ payload_json: string }>(
      "SELECT payload_json FROM commercial_event WHERE event_type = 'agent_tool_loop_completed' AND correlation_id = ? ORDER BY id DESC LIMIT 1",
      [correlationId]
    );
    if (!rows.ok || !rows.rows[0]) return null;
    return JSON.parse(rows.rows[0].payload_json) as Record<string, unknown>;
  }

  async function readCapabilityExecutions(correlationId: string) {
    const rows = await safeQueryRows<{ capability_name: string; execution_status: string; response_summary_json: string | null }>(
      "SELECT capability_name, execution_status, response_summary_json FROM crm_capability_executions WHERE correlation_id = ? ORDER BY id ASC",
      [correlationId]
    );
    return rows.ok ? rows.rows : [];
  }

  async function readOpportunityId(conversationId: number): Promise<number | null> {
    const rows = await safeQueryRows<{ id: number }>("SELECT id FROM crm_opportunities WHERE conversation_case_id = ? ORDER BY id DESC LIMIT 1", [String(conversationId)]);
    return rows.ok && rows.rows[0] ? Number(rows.rows[0].id) : null;
  }

  /**
   * Pre-existing gap, discovered live by this smoke, out of scope for T09B
   * (see docs/releases/LLM-R1-T09B-whatsapp-allowlisted-multi-intent-smoke.md
   * "Non-blocking finding"): the whole Agent Tool Loop family (legacy AND
   * multi-intent, neither modified by this gap) never creates a
   * crm_opportunities row itself - only the legacy persistCommercialState
   * pipeline does, which this family bypasses entirely. Every prior
   * benchmark/test in this repo (including T09A's own) side-stepped this by
   * injecting a synthetic opportunityId directly into the loop, never
   * through a real conversation - this is the first harness to use the real
   * processNativeWhatsAppInbound entry point, so it is the first to surface
   * it. Seeds a minimal, REAL, DB-linked row (never a disconnected synthetic
   * id) so select_products/set_shipping_destination/calculate_shipping can
   * genuinely execute end-to-end for this smoke's own scenarios.
   */
  async function seedMinimalOpportunity(conversationId: number, waId: string): Promise<void> {
    await safeQueryRows(
      `INSERT INTO crm_opportunities (
         opportunity_key, conversation_case_id, wa_id, channel, primary_intent, status,
         requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json
       ) VALUES (?, ?, ?, 'whatsapp', 'unknown', 'new', '{}', '[]', '[]', '[]', '{}')`,
      [`t09b-smoke-${conversationId}`, String(conversationId), waId]
    );
  }

  async function readDurableFacts(opportunityId: number | null) {
    if (!opportunityId) return [];
    const rows = await safeQueryRows<{ fact_key: string; value_json: string; status: string }>(
      "SELECT fact_key, value_json, status FROM crm_request_facts WHERE request_id = ? AND superseded_at IS NULL ORDER BY fact_key ASC",
      [`opportunity:${opportunityId}`]
    );
    return rows.ok ? rows.rows.map((row) => ({ factKey: row.fact_key, value: JSON.parse(row.value_json), status: row.status })) : [];
  }

  async function describeTurn(label: string, waId: string, text: string) {
    const { result, events, elapsedMs } = await inject(waId, text);
    if (result.duplicate) throw new Error(`${label}: unexpected duplicate inbound`);
    const conversationId = result.conversationId as number;
    const correlationId = result.correlationId as string;
    const opportunityId = await readOpportunityId(conversationId);
    const [outboxMessage, agentToolLoopEvent, capabilityExecutions, durableFacts, pendingIntents] = await Promise.all([
      readOutboxMessage(conversationId),
      readAgentToolLoopEvent(correlationId),
      readCapabilityExecutions(correlationId),
      readDurableFacts(opportunityId),
      loadPendingCommercialIntents(opportunityId)
    ]);
    return {
      label,
      waId,
      customerMessage: text,
      correlationId,
      conversationId,
      opportunityId,
      elapsedMs,
      multiIntentEvents: events,
      outboxMessage,
      agentToolLoopEvent,
      capabilityExecutions,
      durableFacts,
      pendingIntents
    };
  }

  /**
   * select_products' evidence gate (Part 5/6 of the architecture doc -
   * requirementResolver.ts) requires PRODUCT to already be observed via
   * RecentCatalogContext or a durable selection - identical discipline to
   * the legacy loop's own select_products evidence gate. A customer's
   * genuine first-ever message naming a product by a short name like
   * "classic" has no such evidence yet in real life either (the agent must
   * have shown them the product first) - so every scenario below that names
   * "classic" first seeds one real search turn (multi-intent OFF, so the
   * legacy loop's search_products tool actually runs and persists real
   * RecentCatalogContext evidence), exactly mirroring how a real
   * conversation would unfold and how T09A's own MI01-MI06 corpus already
   * seeds recentCatalogContext for the same reason.
   */
  async function seedClassicSearchEvidence(waId: string): Promise<number> {
    process.env.BRAIN_MULTI_INTENT_PLANNER_ENABLED = "false";
    const seed = await inject(waId, "hola, tienen la barra olimpica classic 20kg?");
    process.env.BRAIN_MULTI_INTENT_PLANNER_ENABLED = "true";
    const conversationId = seed.result.conversationId as number;
    await seedMinimalOpportunity(conversationId, waId);
    return conversationId;
  }

  // ============================ WA01 ============================
  if (shouldRun("WA01")) {
    const waId = uniqueWaId("01");
    await seedClassicSearchEvidence(waId);
    const turn = await describeTurn("WA01 selection", waId, "quiero 2 de la classic");
    report.push({ caseId: "WA01", evidence: turn });
  }

  // ============================ WA02 ============================
  if (shouldRun("WA02")) {
    const waId = uniqueWaId("02");
    process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = waId;
    const opportunitySeed = await inject(waId, "hola"); // establishes the conversation before seeding the opportunity + durable state directly
    const conversationId = opportunitySeed.result.conversationId as number;
    await seedMinimalOpportunity(conversationId, waId);
    const opportunityId = await readOpportunityId(conversationId);
    if (!opportunityId) throw new Error("WA02: no opportunity created for the seed turn");
    await seedBenchmarkSelection(opportunityId, [{ productId: CLASSIC.productId, quantity: 1 }]);
    const turn = await describeTurn("WA02 shipping (durable selection)", waId, "cuánto sale el despacho a Ñuñoa");
    report.push({ caseId: "WA02", evidence: turn });
  }

  // ============================ WA03 ============================
  if (shouldRun("WA03")) {
    const waId = uniqueWaId("03");
    await seedClassicSearchEvidence(waId);
    const turn = await describeTurn("WA03 multi-intent complete", waId, "quiero 2 de la classic y cuánto sale el despacho a Ñuñoa");
    report.push({ caseId: "WA03", evidence: turn });
  }

  // ============================ WA04 + WA05 ============================
  let wa05Pending: Record<string, unknown> | null = null;
  if (shouldRun("WA04") || shouldRun("WA05")) {
    const waId = uniqueWaId("04");
    await seedClassicSearchEvidence(waId);
    const turn4 = await describeTurn("WA04 multi-intent partial (missing destination)", waId, "quiero 2 de la classic y cuánto sale el despacho");
    if (shouldRun("WA04")) report.push({ caseId: "WA04", evidence: turn4 });

    if (shouldRun("WA05")) {
      const turn5 = await describeTurn("WA05 continuation (destination reply)", waId, "Ñuñoa");
      report.push({ caseId: "WA05", evidence: turn5 });
      wa05Pending = { beforeTurn5: turn4.pendingIntents, afterTurn5: turn5.pendingIntents };
    }
  }

  // ============================ WA06 ============================
  if (shouldRun("WA06")) {
    const waId = uniqueWaId("06");
    // Turn 1: legacy path (multi-intent OFF), real search_products call seeds RecentCatalogContext with two real candidates.
    process.env.BRAIN_MULTI_INTENT_PLANNER_ENABLED = "false";
    const seedTurn = await inject(waId, "muéstrame las barras olímpicas que tienen");
    process.env.BRAIN_MULTI_INTENT_PLANNER_ENABLED = "true";
    await seedMinimalOpportunity(seedTurn.result.conversationId as number, waId);
    const turn = await describeTurn("WA06 ambiguous product", waId, "dame la barra");
    report.push({ caseId: "WA06", evidence: { ...turn, seedTurnConversationId: seedTurn.result.conversationId, seedTurnCorrelationId: seedTurn.result.correlationId } });
  }

  // ============================ WA07 ============================
  if (shouldRun("WA07")) {
    const waId = uniqueWaId("07");
    process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = waId;
    const seedTurn = await inject(waId, "hola");
    await seedMinimalOpportunity(seedTurn.result.conversationId as number, waId);
    const turn = await describeTurn("WA07 unsupported intent", waId, "quiero que me lo dejen reservado para mi hermano");
    report.push({ caseId: "WA07", evidence: turn });
  }

  console.log("\n================ LLM-R1-T09B WHATSAPP SMOKE REPORT ================\n");
  console.log(JSON.stringify({ report, wa05PendingIntentTransition: wa05Pending, productFixture: { classic: CLASSIC, pro: PRO } }, null, 2));

  await catalogEnv.teardown();
  await getPool().end();
}

main().catch((error) => {
  console.error("[t09b-smoke] fatal:", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
