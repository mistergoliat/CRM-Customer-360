import assert from "node:assert/strict";
import test from "node:test";
import { resolveCapabilityGatewayDefinition } from "@/lib/brain/commercial/capability-gateway/registry";
import { buildCurrentToolSurface, buildThinToolSurface, THIN_RELEVANT_TOOL_NAMES, THIN_TOOL_DEFINITIONS } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/toolSurface";
import type { NativeToolDefinition } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/nativeToolClient";
import { buildIsolationSurface, contractBreakdown, currentComponents, ISOLATION_VARIANT_IDS, stripSchemaAnnotations, type IsolationVariantId } from "@/lib/brain/commercial/agent-loop/benchmark/r3CapabilityIsolation/isolationSurfaces";

/**
 * SALES-AGENT-R3-P7.9. Pure/in-memory: the seven variants change ONLY the component
 * they claim to change; B0 is the P7.8-R "current" surface byte for byte, B6 is the
 * P7.8-R C1 surface byte for byte; the domain contract (quantity required, names,
 * types, tool set) never moves.
 */
const RELEVANT = new Set<string>(THIN_RELEVANT_TOOL_NAMES);
const current = buildCurrentToolSurface();
const tool = (surface: { tools: NativeToolDefinition[] }, name: string) => surface.tools.find((candidate) => candidate.name === name) as NativeToolDefinition;
const registryDescription = (name: string) => currentComponents(name).description;

test("P7.9: B0 is byte-identical to the P7.8-R current surface; B6 is byte-identical to the P7.8-R C1 thin surface", () => {
  assert.equal(JSON.stringify(buildIsolationSurface("B0_CURRENT").tools), JSON.stringify(current.tools));
  assert.equal(JSON.stringify(buildIsolationSurface("B6_FULL_THIN").tools), JSON.stringify(buildThinToolSurface().tools));
  assert.equal(JSON.stringify(buildIsolationSurface("B0_CURRENT").stats), JSON.stringify(current.stats));
});

test("P7.9: every variant is deterministic, keeps the 14-tool set and order, and leaves the 7 out-of-scope tools verbatim", () => {
  for (const id of ISOLATION_VARIANT_IDS) {
    const surface = buildIsolationSurface(id);
    assert.equal(JSON.stringify(surface.tools), JSON.stringify(buildIsolationSurface(id).tools), `${id} deterministic`);
    assert.deepEqual(surface.tools.map((entry) => entry.name), current.tools.map((entry) => entry.name), `${id}: same tool names/order`);
    for (const entry of surface.tools) if (!RELEVANT.has(entry.name)) assert.deepEqual(entry, tool(current, entry.name), `${id}/${entry.name}: out-of-scope tool unchanged`);
  }
});

test("P7.9: B1 changes only the description - schema, useWhen, doNotUseWhen and the semantics sentence are the current ones", () => {
  const b1 = buildIsolationSurface("B1_THIN_DESCRIPTION");
  for (const name of THIN_RELEVANT_TOOL_NAMES) {
    const c = tool(current, name);
    const tail = c.description.slice(registryDescription(name).length); // " Use when: ... Do not use when: ... <semantics>"
    assert.equal(tool(b1, name).description, `${THIN_TOOL_DEFINITIONS[name].description}${tail}`, name);
    assert.deepEqual(tool(b1, name).parameters, c.parameters, `${name}: schema verbatim`);
  }
});

test("P7.9: B2 removes only useWhen, B3 removes only doNotUseWhen", () => {
  for (const name of THIN_RELEVANT_TOOL_NAMES) {
    const c = currentComponents(name);
    const currentTool = tool(current, name);
    const b2 = tool(buildIsolationSurface("B2_NO_USEWHEN"), name);
    const b3 = tool(buildIsolationSurface("B3_NO_DONOTUSEWHEN"), name);
    const useWhen = c.useWhen ? ` Use when: ${c.useWhen}.` : "";
    const doNotUseWhen = c.doNotUseWhen ? ` Do not use when: ${c.doNotUseWhen}.` : "";
    assert.equal(b2.description, currentTool.description.replace(useWhen, ""), `${name} B2`);
    assert.equal(b3.description, currentTool.description.replace(doNotUseWhen, ""), `${name} B3`);
    assert.equal(b2.description.includes("Use when:"), false);
    assert.equal(b3.description.includes("Do not use when:"), false);
    assert.equal(b2.description.includes("Do not use when:"), Boolean(c.doNotUseWhen), `${name} B2 keeps doNotUseWhen`);
    assert.equal(b3.description.includes("Use when:"), Boolean(c.useWhen), `${name} B3 keeps useWhen`);
    assert.deepEqual(b2.parameters, currentTool.parameters);
    assert.deepEqual(b3.parameters, currentTool.parameters);
  }
});

test("P7.9: B4 is all prose thinned with the CURRENT schema (thin description only: no useWhen, doNotUseWhen or semantics sentence)", () => {
  const b4 = buildIsolationSurface("B4_THIN_PROSE");
  for (const name of THIN_RELEVANT_TOOL_NAMES) {
    assert.equal(tool(b4, name).description, THIN_TOOL_DEFINITIONS[name].description, name);
    assert.deepEqual(tool(b4, name).parameters, tool(current, name).parameters, `${name}: current schema`);
  }
});

test("P7.9: B5 changes only schema text - descriptions verbatim, required/types/names unchanged, only annotations (minimum, minItems) are gone", () => {
  const b5 = buildIsolationSurface("B5_STRIPPED_SCHEMA_ANNOTATIONS");
  for (const name of THIN_RELEVANT_TOOL_NAMES) {
    assert.equal(tool(b5, name).description, tool(current, name).description, `${name}: description verbatim`);
    assert.deepEqual(tool(b5, name).parameters, stripSchemaAnnotations(tool(current, name).parameters));
  }
  const select = JSON.stringify(tool(b5, "select_products").parameters);
  assert.equal(/minimum|minItems|description/.test(select), false);
  assert.ok(select.includes('"combinationId"'), "optional property names stay (only C1/B6 drops them)");
  assert.notEqual(select, JSON.stringify(tool(current, "select_products").parameters));
  // the current contract has no field descriptions at all: B5 can only strip constraint annotations (documented in the P7.9 audit)
  assert.equal(JSON.stringify(tool(current, "select_products").parameters).includes('"description"'), false);
});

test("P7.9: quantity stays REQUIRED (and integer) in every variant, and required fields equal the real capability's in every variant", () => {
  for (const id of ISOLATION_VARIANT_IDS) {
    const surface = buildIsolationSurface(id);
    const items = ((tool(surface, "select_products").parameters.properties as Record<string, { items: { required: string[]; properties: Record<string, { type: string }> } }>).items).items;
    assert.deepEqual([...items.required].sort(), ["productId", "quantity"], `${id}: quantity required`);
    assert.equal(items.properties.quantity.type, "integer");
    for (const name of THIN_RELEVANT_TOOL_NAMES) {
      const real = resolveCapabilityGatewayDefinition(name)!.inputSchema as { required?: string[]; properties?: Record<string, unknown> };
      const shown = tool(surface, name).parameters as { required?: string[]; properties?: Record<string, { type?: string }> };
      assert.deepEqual([...(shown.required ?? [])].sort(), [...(real.required ?? [])].sort(), `${id}/${name}: required`);
      for (const property of Object.keys(shown.properties ?? {})) assert.ok(property in (real.properties ?? {}), `${id}/${name}.${property} exists in the real schema`);
    }
  }
});

test("P7.9: capability names and property types never change between B0 and any variant (only annotations/optional properties may disappear)", () => {
  const typesOf = (schema: unknown): string[] => (schema && typeof schema === "object" ? Object.entries(schema as Record<string, unknown>).flatMap(([key, value]) => (key === "type" && typeof value === "string" ? [value] : typesOf(value))) : []);
  for (const id of ISOLATION_VARIANT_IDS) {
    for (const name of THIN_RELEVANT_TOOL_NAMES) {
      const before = new Set(typesOf(tool(current, name).parameters));
      for (const type of typesOf(tool(buildIsolationSurface(id), name).parameters)) assert.ok(before.has(type), `${id}/${name}: type ${type}`);
    }
  }
});

test("P7.9: contract size breakdown - B0 > every thinned variant on the relevant tools, B4/B6 are the thinnest, component chars add up", () => {
  const size = (id: IsolationVariantId) => contractBreakdown(id).relevantChars;
  for (const id of ISOLATION_VARIANT_IDS.filter((variant) => variant !== "B0_CURRENT")) assert.ok(size(id) < size("B0_CURRENT"), `${id} smaller than B0`);
  assert.ok(size("B4_THIN_PROSE") < size("B1_THIN_DESCRIPTION") && size("B6_FULL_THIN") < size("B4_THIN_PROSE"));
  const b0 = contractBreakdown("B0_CURRENT");
  assert.equal(b0.totalChars, current.stats.totalChars);
  for (const row of b0.tools) {
    assert.equal(row.descriptionChars + row.useWhenChars + row.doNotUseWhenChars + row.semanticsChars, tool(current, row.tool).description.length, `${row.tool}: description components add up`);
    assert.equal(row.totalChars, row.tool.length + tool(current, row.tool).description.length + row.schemaChars);
  }
  assert.deepEqual(contractBreakdown("B6_FULL_THIN").tools.map((row) => row.tool), [...THIN_RELEVANT_TOOL_NAMES]);
  assert.equal(new Set(ISOLATION_VARIANT_IDS.map((id) => contractBreakdown(id).tools.find((row) => row.tool === "select_products")!.definitionSha16)).size >= 6, true, "select_products differs across variants");
});
