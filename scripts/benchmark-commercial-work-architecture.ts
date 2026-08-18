/**
 * SALES-AGENT-R2-A07.5. Runs the deterministic/offline R2-01..R2-09/R2-12
 * corpus (real CommercialWork pipeline: real DB, real fake Catalog/Carrier,
 * real executor/worker) plus R2-10/R2-11 (A07, DB-backed), aggregates
 * metrics, computes the verdict (verdict.ts), and prints a JSON summary.
 *
 * Usage: npx tsx@4.20.5 scripts/benchmark-commercial-work-architecture.ts [--out=path.json]
 *
 * dev/test/benchmark only - never touches production routing, flags,
 * ACTIVE_RELEASE, PM2, workers, cron or real Meta sending.
 */
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
  META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID: "test-phone"
});

import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { getPool, queryRows } from "@/lib/db";
import { setupR2BenchmarkEnvironment } from "@/lib/brain/commercial/work/benchmark/environment";
import { runR2Scenario } from "@/lib/brain/commercial/work/benchmark/runR2Scenario";
import { scoreR2Scenario } from "@/lib/brain/commercial/work/benchmark/scoring";
import { computeR2AggregateMetrics } from "@/lib/brain/commercial/work/benchmark/metrics";
import { computeR2Verdict, type R2ScenarioOutcome } from "@/lib/brain/commercial/work/benchmark/verdict";
import { createOfflinePlannerProvider, type OfflinePlannerScriptStep } from "@/lib/brain/commercial/work/benchmark/offlinePlannerProvider";
import { R2_ARCHITECTURE_CORPUS } from "../tests/fixtures/commercial-work-benchmark/corpus";
import {
  buildCommercialWorkProjection,
  getCommercialWorkByPublicId,
  persistCommercialWorkProjection,
  processObjectiveAwareFollowUpDue,
  scheduleObjectiveAwareFollowUp
} from "@/lib/brain/commercial/work";
import type { R2ScenarioRunResult } from "@/lib/brain/commercial/work/benchmark/types";

const OFFLINE_PLANS: Record<string, OfflinePlannerScriptStep[]> = {
  "R2-01": [{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }] } }],
  "R2-02": [{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }, { type: "get_shipping_quote", destination: "Nunoa" }] } }],
  "R2-03": [{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }, { type: "get_shipping_quote" }] } }],
  "R2-04": [
    { kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }, { type: "get_shipping_quote" }] } },
    { kind: "plan", plan: { intents: [{ type: "get_shipping_quote", destination: "Nunoa" }] } }
  ],
  "R2-05": [{ kind: "plan", plan: { intents: [{ type: "get_shipping_quote" }] } }],
  "R2-07": [{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la barra", quantity: 1 }] } }],
  "R2-08": [
    { kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }, { type: "get_shipping_quote", destination: "Nunoa" }] } },
    { kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 3 }] } }
  ],
  "R2-12": [{ kind: "plan", plan: { intents: [{ type: "select_products", productReference: "la classic", quantity: 2 }, { type: "get_shipping_quote", destination: "Nunoa" }] } }]
};

async function runCorpusScenarios(): Promise<R2ScenarioRunResult[]> {
  const results: R2ScenarioRunResult[] = [];
  for (const scenario of R2_ARCHITECTURE_CORPUS) {
    const env = await setupR2BenchmarkEnvironment();
    try {
      const script = OFFLINE_PLANS[scenario.scenarioId];
      const provider = createOfflinePlannerProvider(script ?? []);
      const outcome = await runR2Scenario({ scenario, env, provider, runIndex: 0 });
      const score = scoreR2Scenario(scenario, outcome);
      results.push({ scenario, outcome, score });
    } finally {
      await env.teardown();
    }
  }
  return results;
}

async function runFollowUpScenarios(): Promise<{ r210: R2ScenarioOutcome; r211: R2ScenarioOutcome }> {
  const NOW = new Date().toISOString();
  const DUE = new Date(Date.now() + 61 * 60_000).toISOString();

  async function seedConversation() {
    const waId = `569${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const [result] = await getPool().execute(
      `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id, status, owner_type, ai_enabled, human_owner_active)
       VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0)`,
      [randomUUID(), `phone-${Date.now()}`, waId]
    );
    return { id: Number((result as { insertId: number }).insertId), waId };
  }
  async function seedOpportunity(waId: string) {
    const [result] = await getPool().execute(
      `INSERT INTO crm_opportunities (opportunity_key, wa_id, channel, primary_intent, status, requirements_json, missing_requirements_json, product_interests_json, objections_json, signals_json)
       VALUES (?, ?, 'whatsapp', 'sales', 'open', JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_OBJECT())`,
      [`r2cli-opp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, waId]
    );
    return Number((result as { insertId: number }).insertId);
  }

  try {
    await getPool().query("SELECT 1");
  } catch {
    return { r210: "BLOCKED_BY_A07_DB_VALIDATION", r211: "BLOCKED_BY_A07_DB_VALIDATION" };
  }

  async function makeWaitingWork() {
    const conversation = await seedConversation();
    const opportunityId = await seedOpportunity(conversation.waId);
    const projected = buildCommercialWorkProjection({
      trigger: { type: "CUSTOMER_MESSAGE", conversationId: conversation.id, opportunityId, sourceMessageId: null },
      conversation: { id: conversation.id, humanOwnerActive: false, aiEnabled: true },
      opportunity: { id: opportunityId, status: "open" },
      commercialLineItems: { factId: `sel-${Date.now()}`, updatedAt: NOW, items: [{ productId: "31", combinationId: null, quantity: 2 }] },
      objectiveSeeds: [{ type: "GET_SHIPPING_QUOTE", origin: "customer_requested", inputs: {} }],
      now: NOW
    });
    const persisted = await persistCommercialWorkProjection({ work: projected });
    const objective = persisted.work.objectives.find((item) => item.status === "WAITING_CUSTOMER");
    if (!objective) throw new Error("expected a WAITING_CUSTOMER objective for the follow-up fixture");
    return { conversation, work: persisted.work, objective };
  }
  async function makeDue(actionId: string, when: string) {
    await getPool().execute(`UPDATE crm_agent_actions SET scheduled_for = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE action_id = ?`, [when.slice(0, 19).replace("T", " "), actionId]);
  }

  let r210: R2ScenarioOutcome = "FAIL";
  try {
    const fixture = await makeWaitingWork();
    const scheduled = await scheduleObjectiveAwareFollowUp({ workPublicId: fixture.work.publicId, objectivePublicId: fixture.objective.objectiveId, now: NOW, expectedWorkVersion: fixture.work.version });
    if (scheduled.status === "scheduled") {
      await makeDue(scheduled.action.actionId, DUE);
      const due = await processObjectiveAwareFollowUpDue({ actionId: scheduled.action.actionId, now: DUE });
      if (due.status === "sent") {
        const outboxRows = await queryRows<{ count: number }>(`SELECT COUNT(*) AS count FROM brain_message_outbox WHERE source_request_id = ?`, [due.sendAction.actionId]);
        r210 = Number(outboxRows[0].count) === 1 ? "PASS" : "FAIL";
      }
    }
  } catch {
    r210 = "FAIL";
  }

  let r211: R2ScenarioOutcome = "FAIL";
  try {
    const fixture = await makeWaitingWork();
    const scheduled = await scheduleObjectiveAwareFollowUp({ workPublicId: fixture.work.publicId, objectivePublicId: fixture.objective.objectiveId, now: NOW, expectedWorkVersion: fixture.work.version });
    if (scheduled.status === "scheduled") {
      await makeDue(scheduled.action.actionId, DUE);
      await getPool().execute(
        `INSERT INTO conversation_message (public_id, conversation_id, provider, provider_message_id, direction, sender_type, message_type, body, status, created_at)
         VALUES (?, ?, 'meta', ?, 'inbound', 'customer', 'text', 'Nunoa', 'received', ?)`,
        // Must be AFTER the schedule action's own created_at (~NOW) and
        // BEFORE the follow-up's due processing (DUE, 61 minutes later) -
        // this is what makes the follow-up stale.
        [randomUUID(), fixture.conversation.id, `wamid-${Date.now()}`, new Date(Date.now() + 5 * 60_000).toISOString().slice(0, 19).replace("T", " ")]
      );
      const due = await processObjectiveAwareFollowUpDue({ actionId: scheduled.action.actionId, now: DUE });
      r211 = due.status === "cancelled" && "reason" in due && due.reason === "customer_replied_since_schedule" ? "PASS" : "FAIL";
    }
  } catch {
    r211 = "FAIL";
  }

  return { r210, r211 };
}

async function main() {
  const outArg = process.argv.find((arg) => arg.startsWith("--out="));
  const outPath = outArg ? outArg.slice("--out=".length) : null;

  console.log("Running R2-01..R2-09/R2-12 (deterministic/offline)...");
  const corpusResults = await runCorpusScenarios();

  console.log("Running R2-10/R2-11 (A07, DB-backed)...");
  const followUp = await runFollowUpScenarios();

  const metrics = computeR2AggregateMetrics(corpusResults);
  const scenarioOutcomes: Record<string, R2ScenarioOutcome> = {};
  for (const result of corpusResults) scenarioOutcomes[result.scenario.scenarioId] = result.score.overallPass ? "PASS" : "FAIL";
  scenarioOutcomes["R2-10"] = followUp.r210;
  scenarioOutcomes["R2-11"] = followUp.r211;

  const verdict = computeR2Verdict({ scenarioOutcomes, metrics });

  const summary = {
    scenarioOutcomes,
    metrics,
    verdict: verdict.verdict,
    gates: verdict.gates,
    perScenario: corpusResults.map((result) => ({
      scenarioId: result.scenario.scenarioId,
      overallPass: result.score.overallPass,
      lostObjectiveCount: result.score.lostObjectiveCount,
      totalObjectiveCount: result.score.totalObjectiveCount,
      duplicateSideEffect: result.score.duplicateSideEffect,
      unbackedMutationClaim: result.score.unbackedMutationClaim,
      staleEvidenceExecuted: result.score.staleEvidenceExecuted,
      llmCallCount: result.outcome.llmCallCount,
      capabilityExecutionCount: result.outcome.capabilityCalls.length,
      turnLatencyMs: result.outcome.turnLatencyMs,
      commercialCompletionLatencyMs: result.outcome.commercialCompletionLatencyMs,
      finalWorkStatus: result.outcome.finalWork?.status ?? null
    }))
  };

  console.log(JSON.stringify(summary, null, 2));
  if (outPath) writeFileSync(outPath, JSON.stringify(summary, null, 2));

  await getPool().end();
  process.exit(verdict.verdict === "R2_CORE_VALIDATED" || verdict.verdict === "R2_CORE_VALIDATED_A07_DB_PENDING" ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
