import assert from "node:assert/strict";
import test from "node:test";
import { buildSemanticsSurface } from "@/lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/semanticsSurfaces";
import { buildReplicationSurface } from "@/lib/brain/commercial/agent-loop/benchmark/r3ConfirmationBoundary/surfaces";
import { buildSoakSurface } from "@/lib/brain/commercial/agent-loop/benchmark/r3ConversationalSoak/surface";

/** SALES-AGENT-R3-P7.12 (section 5). P7.12 S1 === P7.11 R1 === P7.10 S1, byte-identical. */

test("P7.12: the soak surface is byte-identical to P7.11's R1 (tools, description, schema, stats)", () => {
  const soak = buildSoakSurface();
  const r1 = buildReplicationSurface("R1_CONSEQUENCE_STATEMENT");
  assert.equal(JSON.stringify(soak.tools), JSON.stringify(r1.tools));
  assert.equal(JSON.stringify(soak.stats), JSON.stringify(r1.stats));
});

test("P7.12: the soak surface is byte-identical to P7.10's S1 (tools, description, schema, stats)", () => {
  const soak = buildSoakSurface();
  const s1 = buildSemanticsSurface("S1_CONSEQUENCE_STATEMENT");
  assert.equal(JSON.stringify(soak.tools), JSON.stringify(s1.tools));
  assert.equal(JSON.stringify(soak.stats), JSON.stringify(s1.stats));
});

test("P7.12: the select_products description carries the S1 consequence text (provisional, reversible, no extra confirmation)", () => {
  const soak = buildSoakSurface();
  const tool = soak.tools.find((candidate) => candidate.name === "select_products")!;
  assert.ok(tool.description.includes("provisional and reversible"));
  assert.ok(tool.description.includes("do not ask for an additional confirmation solely to save this provisional selection"));
});

test("P7.12: the surface routes through the same Gateway adapter (identity name mapping, unknown tool rejected)", () => {
  const soak = buildSoakSurface();
  assert.deepEqual(soak.adapt("select_products", { items: [] }), { ok: true, capability: "select_products", input: { items: [] } });
  assert.deepEqual(soak.adapt("not_a_tool", {}), { ok: false, errorCode: "capability_not_registered" });
});
