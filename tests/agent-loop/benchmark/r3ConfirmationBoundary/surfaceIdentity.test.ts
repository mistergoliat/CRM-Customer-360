import assert from "node:assert/strict";
import test from "node:test";
import { buildSemanticsSurface } from "@/lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/semanticsSurfaces";
import { buildReplicationSurface, REPLICATION_VARIANT_IDS } from "@/lib/brain/commercial/agent-loop/benchmark/r3ConfirmationBoundary/surfaces";

/**
 * SALES-AGENT-R3-P7.11. R0 === P7.10 S0 and R1 === P7.10 S1, byte-identical (tools, adapt
 * behavior, stats) - not recreated, imported unchanged. Only the `id` label differs.
 */

test("P7.11: exactly two variants, R0 and R1 (no S2 equivalent)", () => {
  assert.deepEqual([...REPLICATION_VARIANT_IDS], ["R0_CURRENT_SEMANTICS", "R1_CONSEQUENCE_STATEMENT"]);
});

test("P7.11: R0 is byte-identical to P7.10 S0 (tools, description, schema, stats)", () => {
  const r0 = buildReplicationSurface("R0_CURRENT_SEMANTICS");
  const s0 = buildSemanticsSurface("S0_CURRENT_SEMANTICS");
  assert.equal(JSON.stringify(r0.tools), JSON.stringify(s0.tools));
  assert.equal(JSON.stringify(r0.stats), JSON.stringify(s0.stats));
  assert.notEqual(r0.id, s0.id, "only the id label differs (R0 vs S0)");
});

test("P7.11: R1 is byte-identical to P7.10 S1 (tools, description, schema, stats)", () => {
  const r1 = buildReplicationSurface("R1_CONSEQUENCE_STATEMENT");
  const s1 = buildSemanticsSurface("S1_CONSEQUENCE_STATEMENT");
  assert.equal(JSON.stringify(r1.tools), JSON.stringify(s1.tools));
  assert.equal(JSON.stringify(r1.stats), JSON.stringify(s1.stats));
  assert.notEqual(r1.id, s1.id, "only the id label differs (R1 vs S1)");
});

test("P7.11: R0 and R1 differ from each other only in the select_products description (same as S0 vs S1)", () => {
  const r0 = buildReplicationSurface("R0_CURRENT_SEMANTICS");
  const r1 = buildReplicationSurface("R1_CONSEQUENCE_STATEMENT");
  assert.deepEqual(r0.tools.map((tool) => tool.name), r1.tools.map((tool) => tool.name));
  for (const tool of r0.tools) {
    const other = r1.tools.find((candidate) => candidate.name === tool.name)!;
    if (tool.name === "select_products") assert.notEqual(tool.description, other.description);
    else assert.deepEqual(tool, other, `${tool.name} unchanged between R0 and R1`);
  }
});

test("P7.11: both variants route through the same Gateway adapter (identity name mapping, unknown tool rejected)", () => {
  for (const variant of REPLICATION_VARIANT_IDS) {
    const surface = buildReplicationSurface(variant);
    assert.deepEqual(surface.adapt("select_products", { items: [] }), { ok: true, capability: "select_products", input: { items: [] } });
    assert.deepEqual(surface.adapt("not_a_tool", {}), { ok: false, errorCode: "capability_not_registered" });
  }
});
