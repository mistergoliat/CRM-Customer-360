// SALES-AGENT-R2-A13-H0 bake-off. Cordis plugin that drives ONE persistent
// Agent through every turn of one scenario, sequentially, on the SAME
// session (real conversational memory across turns) -- the multi-turn
// equivalent of @deepseek-ai/dsh-headless's own `headless-runner`, built
// from the exact same public surface that plugin uses (`ctx.agents`,
// `agent.followup`, `agent.whenIdle`, `agent.session`). No internal API is
// touched; this is the documented extension pattern, not a custom loop
// bolted onto the harness. Never runs create_quote/create_order/identity
// linking/cancellation/outbox send -- only the four read-only tools
// registered by bakeoffToolsPlugin.ts are ever visible to the model.
import { readFileSync, writeFileSync } from "node:fs";
import type { Context } from "@deepseek-ai/cordis";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { setBakeoffFaultInjection } from "../tools/bakeoffCrmTools.bundle.mjs";

export const name = "bakeoff-runner";
// "agentLoop" (not just "agents") is required: dsh-agent-loop registers the
// AgentRegistry.setFactory() call as part of ITS OWN plugin activation, and
// Cordis's dependency injection only guarantees ctx.agents (the service
// object) exists, not that another plugin has already populated its
// internal factory - injecting the loop's own service name forces that
// ordering.
export const inject: string[] = ["agents", "agentLoop", "agentDefaultModel"];

type Scenario = {
  id: string;
  category: string;
  title: string;
  waId: string;
  turns: string[];
  seedIdentityLevel?: "LEVEL_0_ANONYMOUS" | "LEVEL_3_PRESTASHOP_LINKED";
  injectFault?: "catalog_unavailable" | "customer_profile_unavailable";
};

export interface Config {
  scenarioPath: string;
  scenarioId: string;
  outputPath: string;
}

export function apply(ctx: Context, config: Config): void {
  // No Cordis lifecycle event needed: `inject: ["agents"]` already defers
  // this function's call until ctx.agents exists, so the work runs directly
  // here as soon as the plugin activates (there is no documented/emitted
  // "ready" event on this Context - an earlier attempt that awaited one
  // silently hung forever).
  void (async () => {
    const corpus = JSON.parse(readFileSync(config.scenarioPath, "utf8")) as { scenarios: Scenario[] };
    const scenario = corpus.scenarios.find((s) => s.id === config.scenarioId);
    if (!scenario) throw new Error(`bakeoff scenario not found: ${config.scenarioId}`);

    setBakeoffFaultInjection({
      catalogUnavailable: scenario.injectFault === "catalog_unavailable",
      customerProfileUnavailable: scenario.injectFault === "customer_profile_unavailable"
    });

    console.error(`[bakeoff-runner] ${scenario.id}: starting (${scenario.turns.length} turns)`);
    const startedAt = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SessionId is a nominal brand with no public constructor exposed to a plugin.
    const handle = await ctx.agents.create({ sessionId: `bakeoff-${scenario.id}` as any, agentOptions: ctx.agentDefaultModel.currentSelection() });
    const agent = handle.agent;

    const turnResults: unknown[] = [];
    let lastSeq = agent.session.events.length;

    for (const [turnIndex, turnText] of scenario.turns.entries()) {
      const turnStartedAt = Date.now();
      const message = createUserMessage({ content: [{ type: "text", text: turnText }], source: { kind: "user" } });
      agent.followup(message);
      await agent.whenIdle();
      console.error(`[bakeoff-runner] ${scenario.id}: turn ${turnIndex + 1}/${scenario.turns.length} done in ${Date.now() - turnStartedAt}ms`);

      const rawEvents = agent.session.events.slice(lastSeq);
      lastSeq = agent.session.events.length;

      const messages = agent.session.deriveMessages();
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const finalText = lastAssistant?.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n") ?? null;

      turnResults.push({
        customerMessage: turnText,
        assistantResponse: finalText,
        elapsedMs: Date.now() - turnStartedAt,
        rawEventCount: rawEvents.length,
        rawEvents
      });
    }

    await handle.dispose();

    writeFileSync(
      config.outputPath,
      JSON.stringify(
        { scenarioId: scenario.id, category: scenario.category, waId: scenario.waId, totalElapsedMs: Date.now() - startedAt, turns: turnResults },
        null,
        2
      )
    );

    process.exit(0);
  })().catch((error) => {
    console.error("[bakeoff-runner] fatal", error);
    process.exit(1);
  });
}
