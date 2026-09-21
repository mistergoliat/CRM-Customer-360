import assert from "node:assert/strict";
import test from "node:test";
import { resolveCapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway/registry";
import { buildCurrentToolSurface } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/toolSurface";
import type { NativeToolDefinition } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/nativeToolClient";
import { currentComponents } from "@/lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation/isolationSurfaces";
import {
  buildSemanticsSurface,
  S1_CONSEQUENCE_TEXT,
  S2_DO_NOT_USE_WHEN,
  S2_USE_WHEN,
  SEMANTICS_VARIANT_IDS,
  selectProductsCurrentPieces,
  selectProductsDescriptionParts,
  semanticsContractHashes,
  semanticsContractRow
} from "@/lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/semanticsSurfaces";

/**
 * SALES-AGENT-R3-P7.10. Pure/in-memory. S0 is the current contract byte for byte; S1 changes ONLY
 * the consequence sentence of the select_products description; S2 = S1 + coherent useWhen and
 * doNotUseWhen (nothing else). Schema, quantity semantics, tool set, evidence sentence,
 * operationSemantics sentence and the other 13 tools never move in any variant.
 */
const current = buildCurrentToolSurface();
const s0 = buildSemanticsSurface("S0_CURRENT_SEMANTICS");
const s1 = buildSemanticsSurface("S1_CONSEQUENCE_STATEMENT");
const s2 = buildSemanticsSurface("S2_COHERENT_REVERSIBLE_SEMANTICS");
const surfaces = { S0: s0, S1: s1, S2: s2 };
const tool = (surface: { tools: NativeToolDefinition[] }, name: string) => surface.tools.find((candidate) => candidate.name === name) as NativeToolDefinition;
const selectTool = (surface: { tools: NativeToolDefinition[] }) => tool(surface, "select_products");
const pieces = selectProductsCurrentPieces(selectTool(current));
const { consequence, evidence } = selectProductsDescriptionParts();

test("P7.10: exactly three variants, S0/S1/S2", () => {
  assert.deepEqual([...SEMANTICS_VARIANT_IDS], ["S0_CURRENT_SEMANTICS", "S1_CONSEQUENCE_STATEMENT", "S2_COHERENT_REVERSIBLE_SEMANTICS"]);
});

test("P7.10: S0 is byte-identical to the current model-facing contract (P7.8-R B / P7.9 B0)", () => {
  assert.equal(JSON.stringify(s0.tools), JSON.stringify(current.tools));
  assert.equal(JSON.stringify(s0.stats), JSON.stringify(current.stats));
});

test("P7.10: S1 and S2 differ from S0 ONLY in the select_products description; the other 13 tools are verbatim in every variant", () => {
  for (const surface of [s1, s2]) {
    assert.deepEqual(surface.tools.map((entry) => entry.name), s0.tools.map((entry) => entry.name), "same tool names and order");
    assert.equal(surface.tools.length, 14);
    for (const entry of surface.tools) if (entry.name !== "select_products") assert.deepEqual(entry, tool(s0, entry.name), `${entry.name} unchanged`);
    assert.notEqual(selectTool(surface).description, selectTool(s0).description);
    assert.equal(selectTool(surface).name, "select_products");
  }
  assert.notEqual(selectTool(s1).description, selectTool(s2).description);
});

test("P7.10: the registry description is exactly consequence + evidence, and the current rendering is registry + useWhen + doNotUseWhen + operationSemantics", () => {
  const registry = currentComponents("select_products");
  assert.equal(`${consequence} ${evidence}`, registry.description);
  assert.equal(selectTool(current).description, `${registry.description}${pieces.useWhen}${pieces.doNotUseWhen}${pieces.semantics}`);
  assert.ok(consequence.includes("confirmed") && consequence.includes("durable, authoritative"), "what S1/S2 replace is the confirmed/authoritative framing");
  assert.ok(pieces.useWhen.includes("current purchase") && pieces.doNotUseWhen.includes("committed to"), "what S2 additionally replaces is the purchase/commitment framing");
});

test("P7.10: S1 changes only the consequence sentence - evidence sentence, useWhen, doNotUseWhen and the operationSemantics sentence are the current ones", () => {
  assert.equal(selectTool(s1).description, `${S1_CONSEQUENCE_TEXT} ${evidence}${pieces.useWhen}${pieces.doNotUseWhen}${pieces.semantics}`);
  // and therefore S1 still carries the current useWhen/doNotUseWhen wording (that is what S2 fixes)
  assert.ok(selectTool(s1).description.includes(pieces.useWhen) && selectTool(s1).description.includes(pieces.doNotUseWhen));
  assert.equal(selectTool(s1).description.includes("confirmed product selection"), false);
  assert.equal(selectTool(s1).description.includes("durable, authoritative"), false);
});

test("P7.10: S2 = S1 + coherent useWhen and doNotUseWhen; consequence text, evidence sentence and semantics sentence are the same as S1's", () => {
  assert.equal(selectTool(s2).description, `${S1_CONSEQUENCE_TEXT} ${evidence} Use when: ${S2_USE_WHEN}. Do not use when: ${S2_DO_NOT_USE_WHEN}.${pieces.semantics}`);
  const s1Description = selectTool(s1).description;
  const s2Description = selectTool(s2).description;
  assert.equal(s2Description.startsWith(`${S1_CONSEQUENCE_TEXT} ${evidence}`), true);
  assert.equal(s2Description.endsWith(pieces.semantics), true, "the replacement-semantics sentence is verbatim");
  // S1 -> S2 is exactly the useWhen + doNotUseWhen difference
  assert.equal(s1Description.replace(`${pieces.useWhen}${pieces.doNotUseWhen}`, ` Use when: ${S2_USE_WHEN}. Do not use when: ${S2_DO_NOT_USE_WHEN}.`), s2Description);
  for (const stale of ["current purchase", "committed to", "confirmed", "authoritative"]) assert.equal(s2Description.includes(stale), false, `S2 no longer frames the call as: ${stale}`);
  assert.ok(S2_DO_NOT_USE_WHEN.includes("explored, compared, or recommended"), "the functional guard (exploration/comparison/recommendation do not mutate) is kept");
});

test("P7.10: S1 states the required consequence semantics (provisional, reversible, no order/purchase/payment/checkout, no extra confirmation just to save it)", () => {
  const text = S1_CONSEQUENCE_TEXT.toLowerCase();
  for (const required of ["current working product selection", "provisional", "reversible", "can be changed later", "does not create an order", "purchase", "payment", "checkout", "reservation", "irreversible", "clearly stated which product and quantity", "do not ask for an additional confirmation solely to save this provisional selection"]) assert.ok(text.includes(required), required);
});

test("P7.10: no variant hardcodes an example utterance, a speech-act verb or a corpus product phrase (S1 text, S2 useWhen/doNotUseWhen)", () => {
  for (const text of [S1_CONSEQUENCE_TEXT, S2_USE_WHEN, S2_DO_NOT_USE_WHEN]) {
    for (const forbidden of [/quiero/i, /necesito/i, /me llevo/i, /agr[eé]game/i, /cot[ií]zame/i, /classic/i, /\bpro\b/i, /\bdos\b/i, /\btres\b/i, /for example|e\.g\.|such as/i, /\bsays?\b|\bsaid\b|\bwants? to say\b/i]) assert.equal(forbidden.test(text), false, `${String(forbidden)} in: ${text.slice(0, 40)}`);
  }
});

test("P7.10: the input schema is byte-identical in S0, S1 and S2 and quantity stays REQUIRED (integer, minimum 1)", () => {
  const real = JSON.stringify(resolveCapabilityGatewayDefinition("select_products")!.inputSchema);
  for (const [name, surface] of Object.entries(surfaces)) {
    assert.equal(JSON.stringify(selectTool(surface).parameters), real, `${name}: schema byte-identical to the registry schema`);
    const items = ((selectTool(surface).parameters.properties as Record<string, { items: { required: string[]; properties: Record<string, { type: string; minimum?: number }> } }>).items).items;
    assert.deepEqual([...items.required].sort(), ["productId", "quantity"], `${name}: quantity required`);
    assert.equal(items.properties.quantity.type, "integer");
    assert.equal(items.properties.quantity.minimum, 1);
  }
  assert.equal(JSON.stringify(selectTool(s1).parameters), JSON.stringify(selectTool(s0).parameters));
  assert.equal(JSON.stringify(selectTool(s2).parameters), JSON.stringify(selectTool(s0).parameters));
});

test("P7.10: tool names and property types are the same in S0, S1 and S2", () => {
  const typesOf = (schema: unknown): string[] => (schema && typeof schema === "object" ? Object.entries(schema as Record<string, unknown>).flatMap(([key, value]) => (key === "type" && typeof value === "string" ? [value] : typesOf(value))) : []);
  for (const surface of [s1, s2]) for (const entry of s0.tools) assert.deepEqual(typesOf(tool(surface, entry.name).parameters), typesOf(entry.parameters), entry.name);
});

test("P7.10: every variant routes through the same Gateway adapter (identity name mapping, unknown tool rejected) and the same real capability", () => {
  for (const surface of [s0, s1, s2]) {
    assert.deepEqual(surface.adapt("select_products", { items: [] }), { ok: true, capability: "select_products", input: { items: [] } });
    assert.deepEqual(surface.adapt("not_a_tool", {}), { ok: false, errorCode: "capability_not_registered" });
  }
  // the variants only re-render prose: the registry (implementation, schema, replacement semantics) is read, never modified
  const definition = resolveCapabilityGatewayDefinition("select_products")!;
  assert.equal(definition.operationSemantics, "FULL_REPLACEMENT");
  assert.ok(pieces.semantics.includes("replaces the entire previous state"));
  for (const surface of [s0, s1, s2]) assert.ok(selectTool(surface).description.includes(pieces.semantics), "replacement semantics sentence present in every variant");
});

test("P7.10: contract hashes are deterministic and cover S0, S1 and S2 (surface, tool, schema); the schema hash is the same for the three", () => {
  const a = semanticsContractHashes();
  assert.deepEqual(a, semanticsContractHashes());
  assert.deepEqual(Object.keys(a).sort(), ["S0:select_products", "S0:select_products.schema", "S0:tools", "S1:select_products", "S1:select_products.schema", "S1:tools", "S2:select_products", "S2:select_products.schema", "S2:tools"]);
  assert.equal(new Set([a["S0:tools"], a["S1:tools"], a["S2:tools"]]).size, 3);
  assert.equal(new Set([a["S0:select_products"], a["S1:select_products"], a["S2:select_products"]]).size, 3);
  assert.equal(new Set([a["S0:select_products.schema"], a["S1:select_products.schema"], a["S2:select_products.schema"]]).size, 1);
  const rows = SEMANTICS_VARIANT_IDS.map((variant) => semanticsContractRow(variant));
  assert.equal(new Set(rows.map((row) => row.selectProductsSchemaChars)).size, 1);
  assert.equal(new Set(rows.map((row) => row.selectProductsSha16)).size, 3);
});
