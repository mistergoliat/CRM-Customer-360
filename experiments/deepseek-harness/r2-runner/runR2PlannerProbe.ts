// SALES-AGENT-R2-A13-H0 bake-off. R2-side probe: exercises the SAME
// production code the real inbound cycle calls for its one cognitive/LLM
// step -- buildIntentPlannerPromptPackage -> the real DeepSeek HTTP provider
// (createHttpAgentLoopProvider, same env vars as production) ->
// parseCommercialIntentPlan -- turn by turn, against the shared bake-off
// scenario corpus and the same catalog fixture the Harness runner uses.
//
// Why this exists instead of the full runCommercialWorkInboundCycle: R2's
// durable projection/execution/dispatch stage (buildCommercialWorkProjection,
// executeCommercialWork, settleCommercialWorkProjection) requires a real
// MariaDB (crm_test) -- confirmed unreachable in this sandbox
// (127.0.0.1:3306 ECONNREFUSED). That stage is deterministic, non-LLM code
// (Phase 1's audit already covers it by reading it directly, and the
// existing tests/commercial/fixtures/a13-conversational-reliability-*
// suite already exercises it end-to-end against a real DB elsewhere).
// This probe isolates and measures the one part that genuinely needs a
// live run to compare against the Harness: how well each architecture's
// model understands the SAME Spanish customer turns.
//
// Known, disclosed simplification: pendingIntents (the durable
// clarification-carry-forward state loadPendingCommercialIntents/
// savePendingCommercialIntents persist to MariaDB) is tracked in memory
// only for this probe, always starting empty each scenario -- multi-turn
// clarification-resolution fidelity for R2 is therefore probably
// UNDER-stated here relative to a real DB-backed run, never over-stated.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { createHttpAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/httpAgentLoopProvider";
import { invokeProviderWithDeadline } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";
import { buildIntentPlannerPromptPackage } from "@/lib/brain/commercial/multi-intent/buildIntentPlannerPromptPackage";
import { parseCommercialIntentPlan } from "@/lib/brain/commercial/multi-intent/parseCommercialIntentPlan";
import { commercialObjectiveSeedsFromResolvedIntents } from "@/lib/brain/commercial/work/semanticIntentAdapter";
import { resolveCommercialIntentPlan } from "@/lib/brain/commercial/multi-intent/requirementResolver";
import type { RecentCatalogContext } from "@/lib/brain/commercial/agent-loop/recentCatalogContext";
import { searchProducts, setBakeoffFaultInjection } from "../tools/bakeoffCrmTools";
import { startCatalogFixtureServer } from "../fixtures/catalogFixtureServer.mjs";

type Scenario = {
  id: string;
  category: string;
  title: string;
  waId: string;
  turns: string[];
  seedIdentityLevel?: string;
  injectFault?: "catalog_unavailable" | "customer_profile_unavailable";
};

function loadRepoEnv(): void {
  const raw = readFileSync("E:/dev/codex/CRM-Customer-360/.env", "utf8");
  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined) process.env[key] = value.trim();
  }
}

async function buildRecentCatalogContext(customerMessage: string): Promise<RecentCatalogContext | null> {
  // Best-effort grounding: same intent as the real pipeline's
  // loadRecentCatalogContext (product evidence for a short reference like
  // "la de 15kg"), rebuilt here from a fresh search since this probe has no
  // durable interaction history table to read from.
  const result = await searchProducts(customerMessage);
  if (!result.ok || !result.data) return { interactions: [] };
  const data = result.data as { candidates?: Array<{ product: { productId: string | number; name: string; price?: { amount: number } } }> };
  const products = (data.candidates ?? []).map((c) => ({ id: String(c.product.productId), name: c.product.name, price: c.product.price?.amount ?? null }));
  if (products.length === 0) return { interactions: [] };
  return { interactions: [{ query: customerMessage, products }] } as unknown as RecentCatalogContext;
}

async function main(): Promise<void> {
  loadRepoEnv();
  const scenarioId = process.argv[2];
  if (!scenarioId) throw new Error("usage: runR2PlannerProbe.ts <scenarioId>");

  const scenarioPath = join(__dirname, "..", "scenarios", "bakeoff-scenarios.json");
  const corpus = JSON.parse(readFileSync(scenarioPath, "utf8")) as { scenarios: Scenario[] };
  const scenario = corpus.scenarios.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error(`unknown scenario: ${scenarioId}`);

  const fixture = await startCatalogFixtureServer(0);
  process.env.CATALOG_SERVICE_BASE_URL = fixture.baseUrl;
  process.env.CATALOG_SERVICE_API_KEY = "bakeoff-fixture-key";
  setBakeoffFaultInjection({
    catalogUnavailable: scenario.injectFault === "catalog_unavailable",
    customerProfileUnavailable: scenario.injectFault === "customer_profile_unavailable"
  });

  const provider = createHttpAgentLoopProvider();

  let durableSelectionItems: Array<{ productId: string; quantity: number }> = [];
  let durableDestination: string | null = null;
  let lastAgentMessage: string | null = null;
  const turnResults: unknown[] = [];
  const startedAt = Date.now();

  for (const customerMessage of scenario.turns) {
    const turnStartedAt = Date.now();
    const recentCatalogContext = await buildRecentCatalogContext(customerMessage);

    const promptPackage = buildIntentPlannerPromptPackage({
      customerMessage,
      recentCatalogContext,
      hasDurableSelection: durableSelectionItems.length > 0,
      durableSelectionItemCount: durableSelectionItems.length,
      durableSelectionQuantity: durableSelectionItems.reduce((sum, item) => sum + item.quantity, 0) || null,
      durableShippingDestinationName: durableDestination,
      pendingIntents: [],
      lastAgentMessage
    });

    const invoked = await invokeProviderWithDeadline(provider, promptPackage.messages, `bakeoff-${scenario.id}`, Date.now() + 20_000, null);

    if (invoked.kind !== "success") {
      turnResults.push({ customerMessage, outcome: invoked.kind, elapsedMs: invoked.elapsedMs });
      continue;
    }

    const parsed = parseCommercialIntentPlan(invoked.rawOutput);
    let seeds: unknown[] = [];
    if (parsed.status === "valid") {
      const commercialContextSummary: Record<string, unknown> = {
        commercialLineItems: { items: durableSelectionItems },
        ...(durableDestination ? { shippingDestination: { canonicalName: durableDestination } } : {})
      };
      const resolved = resolveCommercialIntentPlan(parsed.intents, { commercialContextSummary, recentCatalogContext });
      seeds = commercialObjectiveSeedsFromResolvedIntents(resolved);
      // Best-effort in-memory durable-state update for turn continuity (see
      // file header: no MariaDB in this sandbox, so this mirrors -- never
      // replaces -- reconcileCommercialTrigger's real persistence).
      for (const seed of seeds as Array<{ type: string; inputs?: Record<string, unknown> }>) {
        if (seed.type === "SELECT_PRODUCTS" && Array.isArray((seed.inputs as { items?: unknown[] })?.items)) {
          durableSelectionItems = (seed.inputs as { items: Array<{ productId: string; quantity: number }> }).items;
        }
        if (seed.type === "SET_DESTINATION" && typeof (seed.inputs as { destinationText?: string })?.destinationText === "string") {
          durableDestination = (seed.inputs as { destinationText: string }).destinationText;
        }
      }
    }

    turnResults.push({
      customerMessage,
      outcome: parsed.status,
      rawModelOutput: invoked.rawOutput,
      extractedPlan: parsed.status === "valid" ? parsed.intents : null,
      objectiveSeeds: seeds,
      model: invoked.metadata.model,
      inputTokens: invoked.metadata.inputTokens,
      outputTokens: invoked.metadata.outputTokens,
      reasoningTokens: invoked.metadata.reasoningTokens,
      finishReason: invoked.metadata.finishReason,
      elapsedMs: invoked.elapsedMs
    });

    lastAgentMessage = null; // this probe never dispatches a customer-visible reply of its own
  }

  const outDir = join(__dirname, "..", "results");
  mkdirSync(outDir, { recursive: true });
  const outputPath = join(outDir, `${scenario.id}.r2-planner.json`);
  writeFileSync(outputPath, JSON.stringify({ scenarioId: scenario.id, category: scenario.category, waId: scenario.waId, totalElapsedMs: Date.now() - startedAt, turns: turnResults }, null, 2));
  console.log(outputPath);
  // The fixture HTTP server (startCatalogFixtureServer) keeps listening
  // after this function returns, which keeps the event loop alive
  // indefinitely - explicit exit, matching the Harness runner's own.
  process.exit(0);
}

main().catch((error) => {
  console.error("[bakeoff-r2] fatal", error);
  process.exit(1);
});
