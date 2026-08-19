/**
 * SALES-AGENT-R2-A08.5, Part 31. WhatsApp allowlisted CommercialWork (R2)
 * smoke (WA-R2-01..06).
 *
 * Real code path: processNativeWhatsAppInbound (the exact function the real
 * webhook route calls after persisting an inbound event) -> real DB -> real
 * live LLM (BRAIN_MODEL_*) -> runCommercialWorkInboundCycle -> real
 * dispatch/outbox write. This dev environment's Meta webhook is not publicly
 * reachable (confirmed in LLM-R1-T09B), so a literal phone-to-phone round
 * trip is not achievable regardless of this script - it drives the same
 * entry point the webhook calls immediately after persisting an inbound
 * event, same discipline as whatsapp-multi-intent-smoke.ts (T09B).
 *
 * By default NO real Meta API call is made (BRAIN_META_SEND_ENABLED=false) -
 * the outgoing message is read directly from the planned brain_message_outbox
 * row. Pass --real-send to additionally run one real outbox tick
 * (dryRun=false) against the allowlisted wa_id, so a genuine WhatsApp message
 * is delivered - this is the one intentional exception in this repo's
 * smoke-script convention, explicit and opt-in only.
 *
 * Usage:
 *   npx tsx scripts/manual-test/whatsapp-r2-smoke.ts
 *   npx tsx scripts/manual-test/whatsapp-r2-smoke.ts --case=WA-R2-01,WA-R2-03
 *   npx tsx scripts/manual-test/whatsapp-r2-smoke.ts --real-send --to=<real allowlisted wa_id>
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
    BRAIN_META_SEND_ENABLED: "false", // hard safety default: flipped only via runRealSendTick below, opt-in
    BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED: "true",
    // The full Agent Tool Loop (never the narrow multi-intent one - left
    // unset/false) is what seed turns route through when R2 is deliberately
    // left off for them (see inject()'s useCommercialWork param) - it has
    // real search_products access, which R2's planner does not.
    BRAIN_AGENT_TOOL_LOOP_ENABLED: "true",
    BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
    BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true",
    BRAIN_EXECUTION_GATE_ENABLED: "true",
    BRAIN_OUTBOX_BRIDGE_ENABLED: "true",
    BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "true",
    BRAIN_AUTONOMOUS_REPLY_ENABLED: "true"
  });
}

async function main() {
  await loadRuntimeEnv();
  if (!process.env.BRAIN_MODEL_API_KEY || !process.env.BRAIN_MODEL_API_URL || !process.env.BRAIN_MODEL_NAME) {
    throw new Error("Missing BRAIN_MODEL_API_KEY/BRAIN_MODEL_API_URL/BRAIN_MODEL_NAME in .env - required for the live LLM.");
  }

  const { safeQueryRows, getPool } = await import("../../lib/db");
  const { processNativeWhatsAppInbound } = await import("../../lib/brain/native-whatsapp/service");
  const { setupBenchmarkEnvironment, seedBenchmarkSelection, BENCHMARK_PRODUCTS } = await import("../../lib/brain/commercial/agent-loop/benchmark/environment");
  const { resetCommuneResolverForTests } = await import("../../lib/brain/commercial/capability-gateway/shippingDestinationCapability");
  const { resetCalculateShippingCarrierServiceForTests } = await import("../../lib/brain/commercial/capability-gateway/calculateShippingCapability");
  const { runOutboxTick } = await import("../../lib/brain/messaging/autonomousOutboxTick");

  const caseFilter = readArg("case")?.split(",").map((value) => value.trim());
  const shouldRun = (id: string) => !caseFilter || caseFilter.includes(id);
  const realSend = readFlag("real-send");
  const realSendTarget = readArg("to");
  if (realSend && !realSendTarget) {
    throw new Error("--real-send requires --to=<allowlisted wa_id> (a real, reachable WhatsApp number you control).");
  }

  const catalogEnv = await setupBenchmarkEnvironment();
  resetCommuneResolverForTests();
  resetCalculateShippingCarrierServiceForTests();
  const CLASSIC = BENCHMARK_PRODUCTS["31"];

  type Evidence = Record<string, unknown>;
  const report: Array<{ caseId: string; evidence: Evidence }> = [];

  function uniqueWaId(seed: string): string {
    const digits = `${Date.now()}${seed}`.replace(/\D/g, "").slice(-8).padStart(8, "0");
    return `569${digits}`;
  }

  /**
   * useCommercialWork:false routes this specific turn through the full Agent
   * Tool Loop instead of R2 - needed for a seed/search turn, since
   * RecentCatalogContext only counts a capability execution as usable
   * SELECT_PRODUCTS evidence when it is time-correlated to a real customer
   * inbound message (recentCatalogContext.ts's own subquery) - R2's planner
   * has no search intent of its own to produce that correlated execution.
   */
  async function inject(waId: string, text: string, useCommercialWork: boolean = true) {
    process.env.BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS = useCommercialWork ? waId : "";
    const startedAt = Date.now();
    const result = await processNativeWhatsAppInbound({
      providerMessageId: `wamid.r2-smoke-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      phoneNumberId: "phone-r2-smoke",
      externalSenderId: waId,
      senderPhone: waId,
      senderName: "Cliente R2 Smoke",
      messageType: "text",
      text,
      occurredAt: new Date().toISOString(),
      rawPayload: { simulated: true }
    });
    const elapsedMs = Date.now() - startedAt;
    return { result, elapsedMs };
  }

  async function seedMinimalOpportunity(conversationId: number, waId: string): Promise<void> {
    await safeQueryRows(
      `INSERT INTO crm_opportunities (
         opportunity_key, conversation_case_id, wa_id, channel, primary_intent, status,
         requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json
       ) VALUES (?, ?, ?, 'whatsapp', 'unknown', 'new', '{}', '[]', '[]', '[]', '{}')`,
      [`r2-smoke-${conversationId}`, String(conversationId), waId]
    );
  }

  async function readOpportunityId(conversationId: number): Promise<number | null> {
    const rows = await safeQueryRows<{ id: number }>("SELECT id FROM crm_opportunities WHERE conversation_case_id = ? ORDER BY id DESC LIMIT 1", [String(conversationId)]);
    return rows.ok && rows.rows[0] ? Number(rows.rows[0].id) : null;
  }

  async function readOutboxMessage(conversationId: number): Promise<{ id: number; message_text: string | null; status: string } | null> {
    const rows = await safeQueryRows<{ id: number; message_text: string | null; status: string }>(
      "SELECT id, message_text, status FROM brain_message_outbox WHERE conversation_case_id = ? ORDER BY id DESC LIMIT 1",
      [conversationId]
    );
    return rows.ok ? (rows.rows[0] ?? null) : null;
  }

  async function readCommercialWorkEvent(correlationId: string): Promise<Record<string, unknown> | null> {
    const rows = await safeQueryRows<{ payload_json: string }>(
      "SELECT payload_json FROM commercial_event WHERE event_type = 'commercial_work_inbound_cycle_completed' AND correlation_id = ? ORDER BY id DESC LIMIT 1",
      [correlationId]
    );
    if (!rows.ok || !rows.rows[0]) return null;
    return JSON.parse(rows.rows[0].payload_json) as Record<string, unknown>;
  }

  async function readCommercialWork(opportunityId: number | null) {
    if (!opportunityId) return { work: null, objectives: [], steps: [] };
    const workRows = await safeQueryRows<Record<string, unknown>>(
      "SELECT public_id, status, version FROM crm_commercial_work WHERE opportunity_id = ? ORDER BY id DESC LIMIT 1",
      [opportunityId]
    );
    const work = workRows.ok ? (workRows.rows[0] ?? null) : null;
    if (!work) return { work: null, objectives: [], steps: [] };
    const commercialWorkId = await safeQueryRows<{ id: number }>("SELECT id FROM crm_commercial_work WHERE public_id = ? LIMIT 1", [work.public_id]);
    const id = commercialWorkId.ok ? commercialWorkId.rows[0]?.id : null;
    const [objectives, steps] = await Promise.all([
      id ? safeQueryRows<Record<string, unknown>>("SELECT type, status FROM crm_commercial_work_objectives WHERE commercial_work_id = ?", [id]) : Promise.resolve({ ok: false as const, rows: [] }),
      id ? safeQueryRows<Record<string, unknown>>("SELECT step_type, status FROM crm_commercial_work_steps WHERE commercial_work_id = ?", [id]) : Promise.resolve({ ok: false as const, rows: [] })
    ]);
    return { work, objectives: objectives.ok ? objectives.rows : [], steps: steps.ok ? steps.rows : [] };
  }

  async function readCapabilityExecutions(correlationId: string) {
    const rows = await safeQueryRows<{ capability_name: string; execution_status: string }>(
      "SELECT capability_name, execution_status FROM crm_capability_executions WHERE correlation_id = ? ORDER BY id ASC",
      [correlationId]
    );
    return rows.ok ? rows.rows : [];
  }

  async function readAgentActions(conversationId: number) {
    const rows = await safeQueryRows<{ action_type: string; status: string; draft_message: string | null }>(
      "SELECT action_type, status, draft_message FROM crm_agent_actions WHERE conversation_case_id = ? ORDER BY id ASC",
      [conversationId]
    );
    return rows.ok ? rows.rows : [];
  }

  async function describeTurn(label: string, waId: string, text: string) {
    const { result, elapsedMs } = await inject(waId, text);
    if (result.duplicate) throw new Error(`${label}: unexpected duplicate inbound`);
    const conversationId = result.conversationId as number;
    const correlationId = result.correlationId as string;
    const opportunityId = await readOpportunityId(conversationId);
    const [outboxMessage, commercialWorkEvent, capabilityExecutions, commercialWork, agentActions] = await Promise.all([
      readOutboxMessage(conversationId),
      readCommercialWorkEvent(correlationId),
      readCapabilityExecutions(correlationId),
      readCommercialWork(opportunityId),
      readAgentActions(conversationId)
    ]);
    return { label, waId, customerMessage: text, correlationId, conversationId, opportunityId, elapsedMs, outboxMessage, commercialWorkEvent, capabilityExecutions, commercialWork, agentActions };
  }

  // ============================ WA-R2-01 ============================
  if (shouldRun("WA-R2-01")) {
    const waId = uniqueWaId("01");
    const seed = await inject(waId, "hola", false);
    await seedMinimalOpportunity(seed.result.conversationId as number, waId);
    const turn = await describeTurn("WA-R2-01 open catalog search", waId, "busco una barra olimpica");
    report.push({ caseId: "WA-R2-01", evidence: turn });
  }

  // ============================ WA-R2-02 ============================
  if (shouldRun("WA-R2-02")) {
    const waId = uniqueWaId("02");
    const seed = await inject(waId, "hola, tienen la barra olimpica classic 20kg?", false);
    const conversationId = seed.result.conversationId as number;
    await seedMinimalOpportunity(conversationId, waId);
    const turn = await describeTurn("WA-R2-02 selection", waId, "dame 2 Classic");
    report.push({ caseId: "WA-R2-02", evidence: turn });
  }

  // ============================ WA-R2-03 ============================
  if (shouldRun("WA-R2-03")) {
    const waId = uniqueWaId("03");
    const seed = await inject(waId, "hola, tienen la barra olimpica classic 20kg?", false);
    const conversationId = seed.result.conversationId as number;
    await seedMinimalOpportunity(conversationId, waId);
    const turn = await describeTurn("WA-R2-03 selection + shipping", waId, "quiero 2 Classic y despacho a Nunoa");
    report.push({ caseId: "WA-R2-03", evidence: turn });
  }

  // ============================ WA-R2-04 ============================
  if (shouldRun("WA-R2-04")) {
    const waId = uniqueWaId("04");
    const seed = await inject(waId, "hola, tienen la barra olimpica classic 20kg?", false);
    const conversationId = seed.result.conversationId as number;
    await seedMinimalOpportunity(conversationId, waId);
    await describeTurn("WA-R2-04 seed selection", waId, "quiero 2 Classic");
    const turn = await describeTurn("WA-R2-04 correction", waId, "mejor 3");
    report.push({ caseId: "WA-R2-04", evidence: turn });
  }

  // ============================ WA-R2-05 ============================
  if (shouldRun("WA-R2-05")) {
    const waId = uniqueWaId("05");
    const seed = await inject(waId, "hola", false);
    const conversationId = seed.result.conversationId as number;
    await seedMinimalOpportunity(conversationId, waId);
    const opportunityId = await readOpportunityId(conversationId);
    if (opportunityId) await seedBenchmarkSelection(opportunityId, [{ productId: CLASSIC.productId, quantity: 2 }]);
    const turn = await describeTurn("WA-R2-05 missing destination", waId, "cuanto sale el despacho");
    report.push({ caseId: "WA-R2-05", evidence: turn });
  }

  // ============================ WA-R2-06 ============================
  if (shouldRun("WA-R2-06")) {
    const waId = uniqueWaId("06");
    const seed = await inject(waId, "hola", false);
    const conversationId = seed.result.conversationId as number;
    await seedMinimalOpportunity(conversationId, waId);
    await safeQueryRows("UPDATE conversation SET human_owner_active = 1 WHERE id = ?", [conversationId]);
    const turn = await describeTurn("WA-R2-06 handoff/control stop", waId, "quiero 2 Classic");
    report.push({ caseId: "WA-R2-06", evidence: turn });
  }

  console.log("\n================ SALES-AGENT-R2-A08.5 WHATSAPP SMOKE REPORT ================\n");
  console.log(JSON.stringify({ report }, null, 2));

  if (realSend && realSendTarget) {
    console.log(`\n[r2-smoke] --real-send: running one real outbox tick against wa_id=${realSendTarget} ...`);
    process.env.BRAIN_META_SEND_ENABLED = "true";
    const tickResult = await runOutboxTick({
      batchSize: 5,
      lockSeconds: 60,
      workerId: `r2-smoke-real-send-${Date.now()}`,
      dryRun: false,
      allowedWaIds: [realSendTarget]
    });
    console.log("[r2-smoke] real outbox tick result:", JSON.stringify(tickResult, null, 2));
  } else {
    console.log("\n[r2-smoke] --real-send not passed: no real Meta API call was made. Pass --real-send --to=<wa_id> to actually deliver a WhatsApp message.");
  }

  await catalogEnv.teardown();
  await getPool().end();
}

main().catch((error) => {
  console.error("[r2-smoke] fatal:", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
