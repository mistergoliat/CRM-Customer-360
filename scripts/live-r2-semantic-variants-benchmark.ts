/**
 * SALES-AGENT-R2-A08.6 closure, Parts 11-13. Live-DeepSeek semantic
 * validation of quantity correction, cancellation scope, and CREATE_QUOTE
 * reachability through the real production entry point
 * (runCommercialWorkInboundCycle), same real-DB/fixture-Catalog-Carrier
 * discipline as tests/commercial/commercialWorkSemanticCompleteness.test.ts -
 * the ONLY thing swapped out is the provider: createLiveBenchmarkProvider
 * instead of createOfflinePlannerProvider. The real Quote Service is not
 * configured in this environment (no QUOTE_SERVICE_BASE_URL) - CREATE_QUOTE
 * is measured only up to the semantic-planning layer (objective seeded),
 * never claimed as a verified external quote execution.
 *
 * Usage:
 *   npx tsx scripts/live-r2-semantic-variants-benchmark.ts
 *   npx tsx scripts/live-r2-semantic-variants-benchmark.ts --quantity-reps=3 --cancel-reps=1 --quote-reps=2
 */
import path from "node:path";
import { loadLocalEnv, loadEnvFile, PROJECT_ROOT } from "./db-utils";
import { getPool, queryRows } from "../lib/db";
import { setupR2BenchmarkEnvironment, seedBenchmarkSelection, type R2BenchmarkEnvironment } from "../lib/brain/commercial/work/benchmark/environment";
import { runCommercialWorkInboundCycle } from "../lib/brain/commercial/work/runCommercialWorkInboundCycle";
import { resolveLiveBenchmarkProviderConfig, createLiveBenchmarkProvider } from "../lib/brain/commercial/agent-loop/benchmark/liveProvider";
import { getActiveCommercialLineItemsForOpportunity } from "../lib/domains/commercial-line-items";
import { getActiveShippingDestinationForOpportunity } from "../lib/domains/shipping-destination";
import {
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
  type ResolvedSalesAgentConfiguration
} from "../lib/brain/commercial/sales-agent-configuration";
import type { CommercialContextSnapshot } from "../lib/brain/commercial/context/buildNativeCommercialContext";
import { randomUUID } from "node:crypto";

function readArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return raw ? Number.parseInt(raw.slice(prefix.length), 10) : fallback;
}

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function toMysqlDatetime(date: Date): string {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function buildResolvedConfig(): ResolvedSalesAgentConfiguration {
  return {
    source: "safe_default",
    scopeKey: SALES_AGENT_CONFIGURATION_SCOPE,
    recordId: null,
    version: null,
    configurationHash: null,
    configuration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
    effectiveModelConfiguration: SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
    effectiveLoopConfiguration: SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
    effectiveFollowUpConfiguration: SALES_AGENT_FOLLOW_UP_CONFIGURATION_SAFE_DEFAULT
  };
}

function buildSnapshot(env: R2BenchmarkEnvironment, overrides: Partial<CommercialContextSnapshot> = {}): CommercialContextSnapshot {
  return {
    contractName: "CommercialContext",
    schemaVersion: "1.0",
    status: "success",
    completeness: "minimal",
    customer: null,
    conversation: { id: env.conversationId, publicId: "test-conv", channel: "whatsapp", provider: "meta", externalContactId: env.waId, status: "open", aiEnabled: true, humanOwnerActive: false, lastMessageAt: null },
    recentMessages: [],
    opportunity: {
      id: env.opportunityId,
      opportunityKey: `opp-${env.opportunityId}`,
      status: "open",
      stage: null,
      primaryIntent: "sales",
      currentSummary: null,
      nextActionType: null,
      nextActionDueAt: null,
      waitingFor: null,
      humanOwnerActive: false,
      aiBlocked: false,
      customerCandidateId: null,
      customerMasterId: env.masterCustomerId,
      leadId: null,
      conversationCaseId: env.conversationId,
      waId: env.waId,
      requirements: [],
      missingRequirements: [],
      productInterests: [],
      objections: [],
      signals: [],
      version: 1,
      lastActivityAt: new Date().toISOString(),
      closedAt: null
    },
    needProfile: null,
    actions: [],
    signals: {
      hasCustomer: false,
      hasOpportunity: true,
      hasNeedProfile: false,
      hasRecentMessages: false,
      humanOwnerActive: false,
      aiBlocked: false,
      staleContext: false,
      identityConflict: false
    },
    identityConflict: null,
    shippingDestination: null,
    commercialLineItems: null,
    availableCapabilities: [],
    warnings: [],
    customer360: null,
    customer360State: "not_requested",
    customerSession: null,
    metadata: { source: "native_mariadb", conversationPublicId: "test-conv", currentTime: new Date().toISOString() },
    ...overrides
  } as CommercialContextSnapshot;
}

async function buildLiveSnapshot(env: R2BenchmarkEnvironment, overrides: Partial<CommercialContextSnapshot> = {}): Promise<CommercialContextSnapshot> {
  const [commercialLineItems, shippingDestination] = await Promise.all([
    getActiveCommercialLineItemsForOpportunity(env.opportunityId),
    getActiveShippingDestinationForOpportunity(env.opportunityId)
  ]);
  return buildSnapshot(env, { commercialLineItems, shippingDestination, ...overrides });
}

async function seedProductSearchEvidence(env: R2BenchmarkEnvironment, productId: string, productName: string): Promise<void> {
  const eventId = randomUUID();
  const correlationId = uniqueSuffix("search-evidence-corr");
  const now = toMysqlDatetime(new Date());
  await getPool().execute(
    `INSERT INTO commercial_event (
      id, contract_name, schema_version, event_type, source, dedupe_key,
      correlation_id, conversation_id, opportunity_id, occurred_at, received_at,
      payload_json, metadata_json
    ) VALUES (?, 'CommercialEvent', '1.0', 'agent_tool_loop_completed', 'test_seed', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [eventId, uniqueSuffix("dedupe"), correlationId, String(env.conversationId), String(env.opportunityId), now, now, JSON.stringify({ inboundMessageId: uniqueSuffix("search-evidence-msg") }), JSON.stringify({})]
  );
  await getPool().execute(
    `INSERT INTO crm_capability_executions (
      public_id, correlation_id, capability_name, capability_version,
      availability_status, execution_status, retry_count, retryable, error_code,
      request_summary_json, response_summary_json, evidence_json,
      commercial_event_id, opportunity_id, conversation_id,
      started_at, completed_at
    ) VALUES (?, ?, 'search_products', '1.0', 'available', 'completed', 0, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), correlationId, JSON.stringify({ query: productName }), JSON.stringify({ items: [{ productId, name: productName, position: 1 }] }), JSON.stringify({}), eventId, env.opportunityId, env.conversationId, now, now]
  );
}

async function main() {
  await loadLocalEnv();
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
    BENCHMARK_LIVE_LLM_ENABLED: "true"
  });

  const liveConfigResolution = resolveLiveBenchmarkProviderConfig();
  if (!liveConfigResolution.ok) {
    throw new Error(`Live LLM config not available: ${liveConfigResolution.reason}. Cannot claim PASS without it.`);
  }
  const liveConfig = liveConfigResolution.config;
  const quantityReps = readArg("quantity-reps", 3);
  const cancelReps = readArg("cancel-reps", 1);
  const quoteReps = readArg("quote-reps", 2);
  console.log(`[live-r2-semantic] model=${liveConfig.model} quantityReps=${quantityReps} cancelReps=${cancelReps} quoteReps=${quoteReps}`);

  async function liveTurn(env: R2BenchmarkEnvironment, customerMessage: string, overrides: Partial<CommercialContextSnapshot> = {}) {
    const startedAt = Date.now();
    const result = await runCommercialWorkInboundCycle({
      conversationId: env.conversationId,
      waId: env.waId,
      inboundMessageId: uniqueSuffix("msg"),
      correlationId: uniqueSuffix("corr"),
      currentTime: new Date().toISOString(),
      customerMessage,
      snapshot: await buildLiveSnapshot(env, overrides),
      provider: createLiveBenchmarkProvider(liveConfig),
      resolvedSalesAgentConfiguration: buildResolvedConfig()
    });
    return { result, elapsedMs: Date.now() - startedAt };
  }

  function activeObjective(work: NonNullable<Awaited<ReturnType<typeof liveTurn>>["result"]["work"]>, type: string) {
    return work.objectives.find((o) => o.type === type && o.status !== "SUPERSEDED" && o.status !== "CANCELLED");
  }

  // ---------------------------------------------------------------------
  // PART 11: QUANTITY CORRECTION
  // ---------------------------------------------------------------------
  const quantityVariants: Array<{ text: string; expectedQty: number }> = [
    { text: "mejor 3", expectedQty: 3 },
    { text: "que sean 3", expectedQty: 3 },
    { text: "cámbialo a 3", expectedQty: 3 },
    { text: "deja 3", expectedQty: 3 },
    { text: "solo 3", expectedQty: 3 },
    { text: "mejor dame 4", expectedQty: 4 },
    { text: "ponme 2", expectedQty: 2 }
  ];
  type QuantityResult = { text: string; expectedQty: number; gotQty: number | null; latencyMs: number; outcome: "correct" | "wrong_product" | "unsupported" | "wrong_quantity" };
  const quantityResults: QuantityResult[] = [];

  for (const variant of quantityVariants) {
    for (let rep = 0; rep < quantityReps; rep += 1) {
      const env = await setupR2BenchmarkEnvironment();
      try {
        await seedProductSearchEvidence(env, "31", "Classic");
        await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 2 }]);

        const { result, elapsedMs } = await liveTurn(env, variant.text);
        const afterSelect = result.work ? activeObjective(result.work, "SELECT_PRODUCTS") : undefined;
        const afterInputs = afterSelect ? (afterSelect.inputs as { items?: Array<{ productId?: string; quantity?: number }> }) : null;
        const afterProductId = afterInputs?.items?.[0]?.productId ?? null;
        const afterQty = afterInputs?.items?.[0]?.quantity ?? null;

        let outcome: QuantityResult["outcome"];
        if (afterProductId !== null && afterProductId !== "31") outcome = "wrong_product";
        else if (afterQty === variant.expectedQty) outcome = "correct";
        else if (afterQty === null || afterQty === 2) outcome = "unsupported";
        else outcome = "wrong_quantity";

        quantityResults.push({ text: variant.text, expectedQty: variant.expectedQty, gotQty: afterQty, latencyMs: elapsedMs, outcome });
        console.log(`[quantity] "${variant.text}" -> expected=${variant.expectedQty} got=${afterQty} outcome=${outcome} (${elapsedMs}ms)`);
      } finally {
        await env.teardown();
      }
    }
  }

  // ---------------------------------------------------------------------
  // PART 12: CANCELLATION SCOPE
  // ---------------------------------------------------------------------
  const cancelVariants: Array<{ text: string; expectedScope: "whole_work" | "shipping" | "quote" }> = [
    // SALES-AGENT-R2-A08.7, Part 18. Full minimum corpus (5 whole + 5
    // shipping + 5 quote) - extended from A08.6's 9-phrase corpus to match
    // the required benchmark size after the planner prompt fix.
    { text: "olvidalo", expectedScope: "whole_work" },
    { text: "olvídalo todo", expectedScope: "whole_work" },
    { text: "déjalo", expectedScope: "whole_work" },
    { text: "no importa", expectedScope: "whole_work" },
    { text: "cancela eso", expectedScope: "whole_work" },
    { text: "no necesito despacho", expectedScope: "shipping" },
    { text: "olvida el despacho", expectedScope: "shipping" },
    { text: "cancela el despacho", expectedScope: "shipping" },
    { text: "ya no quiero despacho", expectedScope: "shipping" },
    { text: "sin despacho", expectedScope: "shipping" },
    { text: "no quiero cotización", expectedScope: "quote" },
    { text: "mejor no cotices", expectedScope: "quote" },
    { text: "olvida la cotización", expectedScope: "quote" },
    { text: "cancela la cotización", expectedScope: "quote" },
    { text: "no me hagas la cotización", expectedScope: "quote" }
  ];
  type CancelResult = { text: string; expectedScope: string; observedScope: string; correct: boolean };
  const cancelResults: CancelResult[] = [];

  for (const variant of cancelVariants) {
    for (let rep = 0; rep < cancelReps; rep += 1) {
      const env = await setupR2BenchmarkEnvironment();
      try {
        await seedProductSearchEvidence(env, "31", "Classic");
        // SALES-AGENT-R2-A08.7, Part 1 audit finding. A setup turn with only
        // select+shipping completes both objectives same-cycle, so the
        // CommercialWork itself goes terminal (COMPLETED) before the cancel
        // turn ever arrives - resolveCommercialWorkTarget then starts a BRAND
        // NEW work for the cancel turn with nothing carried forward, which
        // this script's own before/after diff misread as "everything
        // cancelled" (whole_work) even when the real planner seed was
        // correctly scoped. This is exactly the pitfall
        // commercialWorkSemanticCompleteness.test.ts's "Part 3: cancelling
        // shipping preserves the product selection" already documents and
        // works around (adding create_quote, which never completes in this
        // fixture-only environment) - applying the same proven pattern here.
        const setup = await liveTurn(env, "quiero 2 Classic y despacho a Ñuñoa, hazme una cotización");
        const before = setup.result.work;
        // SALES-AGENT-R2-A08.7, Part 1 audit finding. SET_DESTINATION and
        // GET_SHIPPING_QUOTE are two DISTINCT families to deriveCommercialObjectives.ts's
        // own commercialObjectiveSupersessionFamily ("destination" vs
        // "shipping") - cancel scope "shipping" only targets GET_SHIPPING_QUOTE
        // (normalizeTargetType maps it that way), SET_DESTINATION legitimately
        // stays COMPLETED. Tracking both together under one "still active"
        // .find() let the untouched, still-active SET_DESTINATION mask a
        // correctly-cancelled GET_SHIPPING_QUOTE - only GET_SHIPPING_QUOTE is
        // the real target for this corpus's "shipping" scope.
        const shippingFamily = (o: { type: string }) => o.type === "GET_SHIPPING_QUOTE";
        const selectBefore = before ? activeObjective(before, "SELECT_PRODUCTS") : undefined;
        const shippingBefore = before?.objectives.find((o) => shippingFamily(o) && o.status !== "SUPERSEDED" && o.status !== "CANCELLED") ?? undefined;
        const quoteBefore = before ? activeObjective(before, "CREATE_QUOTE") : undefined;

        const { result: after } = await liveTurn(env, variant.text);
        const work = after.work;
        const selectAfter = work ? activeObjective(work, "SELECT_PRODUCTS") : undefined;
        const shippingAfter = work?.objectives.find((o) => shippingFamily(o) && o.status !== "SUPERSEDED" && o.status !== "CANCELLED");
        const quoteAfter = work ? activeObjective(work, "CREATE_QUOTE") : undefined;

        const selectionCancelled = Boolean(selectBefore) && !selectAfter;
        const shippingCancelled = Boolean(shippingBefore) && !shippingAfter;
        const quoteCancelled = Boolean(quoteBefore) && !quoteAfter;

        // Exact scope classification - every family's before/after state is
        // now tracked (Part 1 audit fix: quote is no longer inferred from a
        // negative heuristic), so "correct" means the EXACT expected family
        // was cancelled and nothing else - matching Part 19's hard
        // requirement that a wrong-scope/over-cancellation rate must read 0%,
        // not just "not literally whole_work".
        let observedScope: string;
        if (selectionCancelled && shippingCancelled && quoteCancelled) observedScope = "whole_work";
        else if (shippingCancelled && !selectionCancelled && !quoteCancelled) observedScope = "shipping";
        else if (quoteCancelled && !selectionCancelled && !shippingCancelled) observedScope = "quote";
        else if (!selectionCancelled && !shippingCancelled && !quoteCancelled) observedScope = "none";
        else observedScope = `partial(select=${selectionCancelled},shipping=${shippingCancelled},quote=${quoteCancelled})`;

        const correct = observedScope === variant.expectedScope;
        cancelResults.push({ text: variant.text, expectedScope: variant.expectedScope, observedScope, correct });
        console.log(`[cancel] "${variant.text}" -> expected=${variant.expectedScope} observed=${observedScope} correct=${correct}`);
      } finally {
        await env.teardown();
      }
    }
  }

  // ---------------------------------------------------------------------
  // PART 13: CREATE_QUOTE SEMANTIC REACHABILITY (planner layer only - no
  // real Quote Service configured in this environment)
  // ---------------------------------------------------------------------
  const quoteVariants = ["hazme una cotización", "cotízame esto", "quiero una cotización", "mándame una cotización", "prepárame la cotización"];
  type QuoteResult = { text: string; reachedObjective: boolean; duplicateOnRetry: boolean };
  const quoteResults: QuoteResult[] = [];

  for (const text of quoteVariants) {
    for (let rep = 0; rep < quoteReps; rep += 1) {
      const env = await setupR2BenchmarkEnvironment();
      try {
        await seedProductSearchEvidence(env, "31", "Classic");
        await seedBenchmarkSelection(env.opportunityId, [{ productId: "31", quantity: 2 }]);

        const { result: first } = await liveTurn(env, text);
        const quoteObjectivesAfterFirst = first.work?.objectives.filter((o) => o.type === "CREATE_QUOTE" && o.status !== "SUPERSEDED" && o.status !== "CANCELLED") ?? [];
        const reachedObjective = quoteObjectivesAfterFirst.length > 0;

        const { result: second } = await liveTurn(env, text);
        const quoteObjectivesAfterSecond = second.work?.objectives.filter((o) => o.type === "CREATE_QUOTE" && o.status !== "SUPERSEDED" && o.status !== "CANCELLED") ?? [];
        const duplicateOnRetry = quoteObjectivesAfterSecond.length > 1;

        quoteResults.push({ text, reachedObjective, duplicateOnRetry });
        console.log(`[create_quote] "${text}" -> objectiveReached=${reachedObjective} duplicateOnRetry=${duplicateOnRetry}`);
      } finally {
        await env.teardown();
      }
    }
  }

  // ---------------------------------------------------------------------
  // REPORT
  // ---------------------------------------------------------------------
  console.log("\n================ LIVE R2 SEMANTIC VARIANTS REPORT ================\n");

  const qCorrect = quantityResults.filter((r) => r.outcome === "correct").length;
  const qWrongProduct = quantityResults.filter((r) => r.outcome === "wrong_product").length;
  const qUnsupported = quantityResults.filter((r) => r.outcome === "unsupported").length;
  console.log(`Quantity correction: ${quantityResults.length} samples`);
  console.log(`  semantic success: ${qCorrect}/${quantityResults.length} (${((qCorrect / quantityResults.length) * 100).toFixed(1)}%)`);
  console.log(`  wrong-product mutation rate: ${((qWrongProduct / quantityResults.length) * 100).toFixed(1)}%`);
  console.log(`  unsupported/fallback: ${qUnsupported}/${quantityResults.length}`);

  const cCorrect = cancelResults.filter((r) => r.correct).length;
  const cWrongScope = cancelResults.filter((r) => !r.correct).length;
  const scopedResults = cancelResults.filter((r) => r.expectedScope !== "whole_work");
  const scopedFalsePositives = scopedResults.filter((r) => r.observedScope === "whole_work").length;
  console.log(`\nCancellation: ${cancelResults.length} samples`);
  console.log(`  correct scope: ${cCorrect}/${cancelResults.length} (${((cCorrect / cancelResults.length) * 100).toFixed(1)}%)`);
  console.log(`  wrong-scope rate: ${((cWrongScope / cancelResults.length) * 100).toFixed(1)}%`);
  // SALES-AGENT-R2-A08.7, Part 19/PRIMARY SUCCESS CRITERION. The single
  // hardest gate: a scoped phrase must never collapse to whole-work.
  console.log(
    `  scoped->whole-work false-positive rate: ${scopedResults.length > 0 ? ((scopedFalsePositives / scopedResults.length) * 100).toFixed(1) : "n/a"}% (${scopedFalsePositives}/${scopedResults.length})`
  );

  const quReached = quoteResults.filter((r) => r.reachedObjective).length;
  const quDuplicate = quoteResults.filter((r) => r.duplicateOnRetry).length;
  console.log(`\nCREATE_QUOTE (planner layer only, no real Quote Service configured): ${quoteResults.length} samples`);
  console.log(`  semantic success (objective reached): ${quReached}/${quoteResults.length} (${((quReached / quoteResults.length) * 100).toFixed(1)}%)`);
  console.log(`  duplicate-objective-on-retry rate: ${((quDuplicate / quoteResults.length) * 100).toFixed(1)}%`);
  console.log(`  NOTE: actual quote capability execution / durable quote evidence NOT VERIFIABLE here - no QUOTE_SERVICE_BASE_URL configured in this environment.`);

  console.log("\n=====================================================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
