// SALES-AGENT-R2-A13-H0 bake-off. Cordis plugin exposing the four read-only
// tools to the DeepSeek Harness agent, following the exact same plugin
// extension point @deepseek-ai/dsh-tool-web uses (ctx.tools.register) --
// this is the officially documented way to add tools to dsh, not a
// reimplementation of anything inside the harness.
//
// Every tool body delegates to ../tools/bakeoffCrmTools.ts, the SAME
// functions the R2-side runner calls, so the comparison's independent
// variable stays orchestration architecture, not tool implementation.
// Deliberately absent: create_quote, create_order, identity linking,
// cancellation, outbox send, or any other mutation -- this plugin can only
// ever grow read-only tools.
import type { Context } from "@deepseek-ai/cordis";
import {
  searchProducts,
  getCustomerContext,
  getPurchaseHistory,
  getShippingOptions,
  buildBakeoffRuntimeIdentity
  // Bundled (esbuild) form, not the raw .ts: @deepseek-ai/cordis-plugin-loader's
  // dynamic import() of a plugin's transitive .ts dependency graph does not
  // reliably apply tsx's ESM loader hook - the pre-bundled, dependency-free
  // .mjs sidesteps that entirely. Rebuild after editing bakeoffCrmTools.ts:
  //   node_modules/.bin/esbuild tools/bakeoffCrmTools.ts --bundle --platform=node --format=esm --outfile=tools/bakeoffCrmTools.bundle.mjs
} from "../tools/bakeoffCrmTools.bundle.mjs";

export const name = "bakeoff-tools";
export const inject = ["tools"];

function textResult(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], isError };
}

export function apply(ctx: Context, config: { customerIdentityLevel: "LEVEL_0_ANONYMOUS" | "LEVEL_3_PRESTASHOP_LINKED" }): void {
  ctx.tools.register({
    name: "search_products",
    description: "Search the PesasChile product catalog by free-text query. Read-only.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    output: { schema: { type: "object" }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
    async execute(args) {
      const { query } = args as { query: string };
      const result = await searchProducts(query);
      return result.ok ? result.data : { unavailable: true, reason: result.reason };
    }
  });

  ctx.tools.register({
    name: "get_customer_context",
    description: "Read whether the current customer is a known, identity-linked PesasChile customer. Read-only, no PII returned.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object" }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
    async execute() {
      const identity = buildBakeoffRuntimeIdentity(config.customerIdentityLevel);
      const result = await getCustomerContext(identity);
      return result.ok ? result.data : { unavailable: true, reason: result.reason };
    }
  });

  ctx.tools.register({
    name: "get_purchase_history",
    description: "Read the current customer's recent purchase history, when identity-linked. Read-only.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object" }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
    async execute() {
      const identity = buildBakeoffRuntimeIdentity(config.customerIdentityLevel);
      const result = await getPurchaseHistory(identity);
      return result.ok ? result.data : { unavailable: true, reason: result.reason };
    }
  });

  ctx.tools.register({
    name: "get_shipping_options",
    description: "Get real shipping quotes for a destination commune given the cart's total weight (kg) and total amount (CLP). Read-only.",
    parameters: {
      type: "object",
      properties: {
        destination: { type: "string" },
        totalWeightKg: { type: "number" },
        totalBoleta: { type: "number" }
      },
      required: ["destination", "totalWeightKg", "totalBoleta"]
    },
    output: { schema: { type: "object" }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
    async execute(args) {
      const { destination, totalWeightKg, totalBoleta } = args as { destination: string; totalWeightKg: number; totalBoleta: number };
      const result = await getShippingOptions(destination, totalWeightKg, totalBoleta);
      return result.ok ? result.data : { unavailable: true, reason: result.reason };
    }
  });
}
