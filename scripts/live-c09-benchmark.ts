/**
 * SALES-AGENT-R2-A08.5, Parts 14-17/23. Live-model C09 comparison (legacy
 * Agent Tool Loop vs the real R2 CommercialWork production entry point -
 * runCommercialWorkInboundCycle, including its real finalizer/dispatch,
 * unlike A07.5's runR2Scenario which stopped at the executor), plus the
 * simple-case (C01/C02/C06/C07/C08-equivalent) and multi-turn (A/B/C/D)
 * batches. Real DeepSeek (BRAIN_MODEL_*), real crm_test DB, real dispatch -
 * fixture-only Catalog Service (setupBenchmarkEnvironment, same discipline
 * as LLM-R1-T09B/A07.5), real commune resolver + Carrier MS. No real Meta
 * send here - that is whatsapp-r2-smoke.ts's job.
 *
 * Usage:
 *   npx tsx scripts/live-c09-benchmark.ts --runs=10
 *   npx tsx scripts/live-c09-benchmark.ts --runs=10 --skip-simple --skip-multiturn
 */
import path from "node:path";
import { loadLocalEnv, loadEnvFile, PROJECT_ROOT } from "./db-utils";

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
    DB_HOST: "127.0.0.1",
    DB_PORT: "3306",
    DB_NAME: "crm_test",
    DB_USER: "crm_app",
    DB_PASSWORD: "una_clave_local",
    DB_URL: "",
    DB_WRITE_ENABLED: "true",
    BENCHMARK_LIVE_LLM_ENABLED: "true"
  });
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function main() {
  await loadRuntimeEnv();
  if (!process.env.BRAIN_MODEL_API_KEY || !process.env.BRAIN_MODEL_API_URL || !process.env.BRAIN_MODEL_NAME) {
    throw new Error("Missing BRAIN_MODEL_API_KEY/BRAIN_MODEL_API_URL/BRAIN_MODEL_NAME - required for the live LLM. Cannot claim PASS without it.");
  }

  const runs = Number.parseInt(readArg("runs") ?? "10", 10);
  const skipSimple = readFlag("skip-simple");
  const skipMultiTurn = readFlag("skip-multiturn");

  const { getPool, safeQueryRows } = await import("../lib/db");
  const { runBenchmarkCase } = await import("../lib/brain/commercial/agent-loop/benchmark/runCorpus");
  const { BENCHMARK_CORPUS } = await import("../tests/fixtures/agent-loop-benchmark/corpus");
  const { resolveLiveBenchmarkProviderConfig } = await import("../lib/brain/commercial/agent-loop/benchmark/liveProvider");
  const { setupBenchmarkEnvironment } = await import("../lib/brain/commercial/agent-loop/benchmark/environment");
  const { resetCommuneResolverForTests } = await import("../lib/brain/commercial/capability-gateway/shippingDestinationCapability");
  const { resetCalculateShippingCarrierServiceForTests } = await import("../lib/brain/commercial/capability-gateway/calculateShippingCapability");
  const { processNativeWhatsAppInbound } = await import("../lib/brain/native-whatsapp/service");

  Object.assign(process.env, {
    BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED: "true",
    // Seed turns route through the full Agent Tool Loop (real search_products
    // access) when useCommercialWork=false is passed to inject() below -
    // R2's planner has no search intent of its own.
    BRAIN_AGENT_TOOL_LOOP_ENABLED: "true",
    BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
    BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true",
    BRAIN_EXECUTION_GATE_ENABLED: "true",
    BRAIN_OUTBOX_BRIDGE_ENABLED: "true",
    BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "true",
    BRAIN_AUTONOMOUS_REPLY_ENABLED: "true",
    BRAIN_META_SEND_ENABLED: "false"
  });

  const liveConfigResolution = resolveLiveBenchmarkProviderConfig();
  if (!liveConfigResolution.ok) {
    throw new Error(`Live LLM config not available: ${liveConfigResolution.reason}. Cannot claim PASS without it.`);
  }
  const liveConfig = liveConfigResolution.config;
  console.log(`[live-c09] model=${liveConfig.model} thinking=${liveConfig.thinking ?? "provider_default"} runs=${runs}`);

  const catalogEnv = await setupBenchmarkEnvironment();
  resetCommuneResolverForTests();
  resetCalculateShippingCarrierServiceForTests();

  function uniqueWaId(seed: string): string {
    const digits = `${Date.now()}${seed}${Math.random().toString().slice(2, 6)}`.replace(/\D/g, "").slice(-8).padStart(8, "0");
    return `569${digits}`;
  }

  /**
   * useCommercialWork:false routes this turn through the full Agent Tool
   * Loop instead of R2 - needed for a seed/search turn, since
   * RecentCatalogContext only counts a capability execution as usable
   * SELECT_PRODUCTS evidence when it is time-correlated to a real customer
   * inbound message (recentCatalogContext.ts's own subquery) - R2's planner
   * has no search intent of its own to produce that correlated execution.
   * Same real production entry point the webhook route calls
   * (processNativeWhatsAppInbound), same discipline as whatsapp-r2-smoke.ts.
   */
  async function inject(waId: string, text: string, useCommercialWork: boolean = true) {
    process.env.BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS = useCommercialWork ? waId : "";
    const startedAt = Date.now();
    const result = await processNativeWhatsAppInbound({
      providerMessageId: `wamid.live-c09-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      phoneNumberId: "phone-live-c09",
      externalSenderId: waId,
      senderPhone: waId,
      senderName: "Cliente Live C09",
      messageType: "text",
      text,
      occurredAt: new Date().toISOString(),
      rawPayload: { simulated: true }
    });
    return { result, elapsedMs: Date.now() - startedAt };
  }

  async function seedMinimalOpportunity(conversationId: number, waId: string): Promise<void> {
    await safeQueryRows(
      `INSERT INTO crm_opportunities (
         opportunity_key, conversation_case_id, wa_id, channel, primary_intent, status,
         requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json
       ) VALUES (?, ?, ?, 'whatsapp', 'unknown', 'new', '{}', '[]', '[]', '[]', '{}')`,
      [`live-c09-${conversationId}`, String(conversationId), waId]
    );
  }

  async function readOpportunityId(conversationId: number): Promise<number | null> {
    const rows = await safeQueryRows<{ id: number }>("SELECT id FROM crm_opportunities WHERE conversation_case_id = ? ORDER BY id DESC LIMIT 1", [String(conversationId)]);
    return rows.ok && rows.rows[0] ? Number(rows.rows[0].id) : null;
  }

  async function readCommercialWork(opportunityId: number | null) {
    if (!opportunityId) return null;
    const rows = await safeQueryRows<Record<string, unknown>>(
      "SELECT public_id, status, version FROM crm_commercial_work WHERE opportunity_id = ? ORDER BY id DESC LIMIT 1",
      [opportunityId]
    );
    if (!rows.ok || !rows.rows[0]) return null;
    const workId = await safeQueryRows<{ id: number }>("SELECT id FROM crm_commercial_work WHERE public_id = ? LIMIT 1", [rows.rows[0].public_id]);
    const id = workId.ok ? workId.rows[0]?.id : null;
    const objectiveRows = id
      ? await safeQueryRows<{ type: string; status: string; inputs_json: string }>("SELECT type, status, inputs_json FROM crm_commercial_work_objectives WHERE commercial_work_id = ?", [id])
      : { ok: false as const, rows: [] };
    const stepRows = id
      ? await safeQueryRows<{ step_type: string; status: string }>("SELECT step_type, status FROM crm_commercial_work_steps WHERE commercial_work_id = ?", [id])
      : { ok: false as const, rows: [] };
    return {
      publicId: String(rows.rows[0].public_id),
      status: String(rows.rows[0].status),
      objectives: objectiveRows.ok ? objectiveRows.rows : [],
      steps: stepRows.ok ? stepRows.rows : []
    };
  }

  async function readDispatchedMessage(conversationId: number): Promise<string | null> {
    const rows = await safeQueryRows<{ message_text: string | null }>(
      "SELECT message_text FROM brain_message_outbox WHERE conversation_case_id = ? ORDER BY id DESC LIMIT 1",
      [conversationId]
    );
    return rows.ok ? (rows.rows[0]?.message_text ?? null) : null;
  }

  async function runR2Turn(customerMessage: string, options: { seedSelection?: boolean; seedProductSearchEvidence?: boolean; waId?: string } = {}) {
    const waId = options.waId ?? uniqueWaId(Math.random().toString(16).slice(2, 6));
    let conversationId: number;
    if (options.seedProductSearchEvidence) {
      const seed = await inject(waId, "hola, tienen la barra olimpica classic 20kg?", false);
      conversationId = seed.result.conversationId as number;
      await seedMinimalOpportunity(conversationId, waId);
    } else {
      const seed = await inject(waId, "hola", false);
      conversationId = seed.result.conversationId as number;
      await seedMinimalOpportunity(conversationId, waId);
      if (options.seedSelection) {
        const opportunityId = await readOpportunityId(conversationId);
        if (opportunityId) {
          const { seedBenchmarkSelection, BENCHMARK_PRODUCTS } = await import("../lib/brain/commercial/agent-loop/benchmark/environment");
          await seedBenchmarkSelection(opportunityId, [{ productId: BENCHMARK_PRODUCTS["31"].productId, quantity: 1 }]);
        }
      }
    }

    const startedAt = Date.now();
    const { result } = await inject(waId, customerMessage, true);
    const elapsedMs = Date.now() - startedAt;
    const opportunityId = await readOpportunityId(conversationId);
    const work = await readCommercialWork(opportunityId);
    const dispatchedMessage = await readDispatchedMessage(conversationId);
    return { waId, conversationId, opportunityId, elapsedMs, work, dispatchedMessage, inboundResult: result };
  }

  // ---------------------------------------------------------------------
  // Harness A: legacy Agent Tool Loop, live LLM
  // ---------------------------------------------------------------------
  const c09 = BENCHMARK_CORPUS.find((c) => c.caseId === "C09");
  if (!c09) throw new Error("C09 not found in legacy corpus");
  const legacyRuns: Array<{ llmCalls: number; toolExecutions: number; selectionCompleted: boolean; destinationCompleted: boolean; shippingCompleted: boolean; turnLatencyMs: number; finalMessage: string | null; terminalReason: string }> = [];
  for (let i = 0; i < runs; i += 1) {
    // 30s (matched to R2's single-call deadline) was too tight for the legacy
    // loop's own up-to-4 sequential real DeepSeek round trips per turn -
    // every one of the first 10 live runs hit that wall before finalizing,
    // several after already completing all three tool calls. 90s gives real
    // per-turn headroom without masking a genuine hang.
    const result = await runBenchmarkCase(c09, "live", liveConfig, { maxDecisions: 3, maxToolExecutions: 3, timeoutMs: 90_000 }, i);
    legacyRuns.push({
      llmCalls: result.providerCalls.length,
      toolExecutions: result.loop.toolExecutionCount,
      selectionCompleted: result.loop.steps.some((r) => r.step.type === "use_tool" && r.step.tool === "select_products" && r.observation?.status === "completed"),
      destinationCompleted: result.loop.steps.some((r) => r.step.type === "use_tool" && r.step.tool === "set_shipping_destination" && r.observation?.status === "completed"),
      shippingCompleted: result.loop.steps.some((r) => r.step.type === "use_tool" && r.step.tool === "calculate_shipping" && r.observation?.status === "completed"),
      turnLatencyMs: result.totalElapsedMs,
      finalMessage: result.loop.finalMessage,
      terminalReason: result.loop.terminalReason
    });
    console.log(`[live-c09] legacy run ${i + 1}/${runs} done (${result.totalElapsedMs}ms, terminalReason=${result.loop.terminalReason})`);
  }

  // ---------------------------------------------------------------------
  // Harness B: real R2 production path (processNativeWhatsAppInbound ->
  // routing -> runCommercialWorkInboundCycle, includes the real
  // finalizer/dispatch)
  // ---------------------------------------------------------------------
  const r2Runs: Array<{ llmCalls: number; selectionCompleted: boolean; destinationCompleted: boolean; shippingCompleted: boolean; remainingWorkDurable: boolean; workStatus: string | null; turnLatencyMs: number; commercialCompletionLatencyMs: number | null; dispatchedMessage: string | null }> = [];
  for (let i = 0; i < runs; i += 1) {
    const { work, dispatchedMessage, elapsedMs } = await runR2Turn("quiero 2 de la classic y saber cuanto sale el despacho a Ñuñoa", { seedProductSearchEvidence: true });
    const objectivesCompleted = work?.objectives.filter((o) => o.status === "COMPLETED") ?? [];
    const remainingDurable = work ? work.steps.some((s) => ["READY", "RUNNING", "RETRY_SCHEDULED", "WAITING_SYSTEM"].includes(s.status)) : false;
    r2Runs.push({
      llmCalls: 1, // one semantic planner call per turn by construction - see planCommercialObjectiveSeeds
      selectionCompleted: objectivesCompleted.some((o) => o.type === "SELECT_PRODUCTS"),
      destinationCompleted: objectivesCompleted.some((o) => o.type === "SET_DESTINATION"),
      shippingCompleted: objectivesCompleted.some((o) => o.type === "GET_SHIPPING_QUOTE"),
      remainingWorkDurable: remainingDurable,
      workStatus: work?.status ?? null,
      turnLatencyMs: elapsedMs,
      commercialCompletionLatencyMs: elapsedMs,
      dispatchedMessage
    });
    console.log(`[live-c09] R2 run ${i + 1}/${runs} done (${elapsedMs}ms, workStatus=${work?.status ?? "none"})`);
  }

  // ---------------------------------------------------------------------
  // Customer-visible C09 audit (Part 23): grounded claim check, never
  // trusting the model's own text - a future-tense claim is only CORRECT if
  // remainingWorkDurable is true for that run.
  // ---------------------------------------------------------------------
  function classifyRun(run: (typeof r2Runs)[number]): "CORRECT" | "ACCEPTABLE_DEGRADATION" | "FUNCTIONAL_FAILURE" | "SAFETY_FAILURE" {
    const claimsFutureWork = /estoy (terminando|registrando|confirmando)/i.test(run.dispatchedMessage ?? "");
    if (claimsFutureWork && !run.remainingWorkDurable) return "SAFETY_FAILURE"; // unbacked future promise
    if (run.selectionCompleted && run.shippingCompleted) return "CORRECT";
    if (run.selectionCompleted || run.shippingCompleted) return run.remainingWorkDurable ? "ACCEPTABLE_DEGRADATION" : "FUNCTIONAL_FAILURE";
    return "FUNCTIONAL_FAILURE";
  }
  const audited = r2Runs.map((run) => ({ ...run, classification: classifyRun(run) }));

  // ---------------------------------------------------------------------
  // Simple cases (Part 16) - R2 only, one run each
  // ---------------------------------------------------------------------
  const simpleResults: Record<string, unknown> = {};
  if (!skipSimple) {
    simpleResults["C01_search"] = await runR2Turn("busco una barra olimpica");
    simpleResults["C02_selection"] = await runR2Turn("dame 2 Classic", { seedProductSearchEvidence: true });
    simpleResults["C06_destination_only"] = await runR2Turn("Santiago", { seedSelection: true });
    simpleResults["C08_thanks"] = await runR2Turn("gracias");
    console.log("[live-c09] simple-case batch done");
  }

  // ---------------------------------------------------------------------
  // Multi-turn (Part 17) - R2 only, same conversation across turns
  // ---------------------------------------------------------------------
  const multiTurnResults: Record<string, unknown> = {};
  if (!skipMultiTurn) {
    async function runMultiTurnScenario(id: string, turns: string[]) {
      const waId = uniqueWaId(id);
      const seed = await inject(waId, "hola, tienen la barra olimpica classic 20kg?", false);
      const conversationId = seed.result.conversationId as number;
      await seedMinimalOpportunity(conversationId, waId);
      const results: unknown[] = [];
      for (const [index, message] of turns.entries()) {
        const { result } = await inject(waId, message, true);
        const opportunityId = await readOpportunityId(conversationId);
        const work = await readCommercialWork(opportunityId);
        const dispatchedMessage = await readDispatchedMessage(conversationId);
        results.push({ turn: index + 1, message, workStatus: work?.status ?? null, dispatchedMessage, duplicate: result.duplicate ?? false });
      }
      return results;
    }

    multiTurnResults["A_quantity_then_shipping"] = await runMultiTurnScenario("A", ["quiero 2 Classic", "y despacho a Nunoa"]);
    multiTurnResults["B_quantity_correction"] = await runMultiTurnScenario("B", ["quiero 2 Classic", "mejor 3"]);
    multiTurnResults["C_combined_then_destination_change"] = await runMultiTurnScenario("C", ["quiero 2 Classic y despacho a Nunoa", "mejor a Las Condes"]);
    multiTurnResults["D_cancellation"] = await runMultiTurnScenario("D", ["quiero 2 Classic", "olvidalo"]);
    console.log("[live-c09] multi-turn batch done");
  }

  // ---------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------
  const legacyTurnLatencies = legacyRuns.map((r) => r.turnLatencyMs);
  const r2TurnLatencies = r2Runs.map((r) => r.turnLatencyMs);
  const r2CompletionLatencies = r2Runs.map((r) => r.commercialCompletionLatencyMs).filter((v): v is number => v !== null);

  const report = {
    model: liveConfig.model,
    runs,
    legacy: {
      runs: legacyRuns,
      turnLatencyP50Ms: percentile(legacyTurnLatencies, 50),
      turnLatencyP95Ms: percentile(legacyTurnLatencies, 95),
      avgLlmCalls: legacyRuns.reduce((s, r) => s + r.llmCalls, 0) / legacyRuns.length
    },
    r2: {
      runs: audited,
      semanticSuccessRate: r2Runs.filter((r) => r.workStatus !== null).length / r2Runs.length,
      sameCycleCompletionRate: r2Runs.filter((r) => r.workStatus === "COMPLETED").length / r2Runs.length,
      asyncCompletionRate: r2Runs.filter((r) => r.remainingWorkDurable && r.workStatus !== "COMPLETED").length / r2Runs.length,
      safetyFailureRate: audited.filter((r) => r.classification === "SAFETY_FAILURE").length / audited.length,
      functionalFailureRate: audited.filter((r) => r.classification === "FUNCTIONAL_FAILURE").length / audited.length,
      correctRate: audited.filter((r) => r.classification === "CORRECT").length / audited.length,
      avgLlmCalls: r2Runs.reduce((s, r) => s + r.llmCalls, 0) / r2Runs.length,
      turnLatencyP50Ms: percentile(r2TurnLatencies, 50),
      turnLatencyP95Ms: percentile(r2TurnLatencies, 95),
      commercialCompletionLatencyP50Ms: percentile(r2CompletionLatencies, 50),
      commercialCompletionLatencyP95Ms: percentile(r2CompletionLatencies, 95)
    },
    simpleCases: simpleResults,
    multiTurn: multiTurnResults
  };

  console.log("\n================ SALES-AGENT-R2-A08.5 LIVE C09 REPORT ================\n");
  console.log(JSON.stringify(report, null, 2));

  await catalogEnv.teardown();
  await getPool().end();
}

main().catch((error) => {
  console.error("[live-c09] fatal:", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
