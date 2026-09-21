import { createHash } from "node:crypto";
import { resolveCapabilityGatewayDefinition } from "../../../capability-gateway/registry";
import type { NativeToolDefinition } from "../r3TrueAB/nativeToolClient";
import { buildCurrentToolSurface, buildSurface, buildThinToolSurface, OPERATION_SEMANTICS_SENTENCES, THIN_RELEVANT_TOOL_NAMES, THIN_TOOL_DEFINITIONS, TRUE_HARNESS_TOOL_NAMES, type ToolSurface } from "../r3TrueAB/toolSurface";

/**
 * SALES-AGENT-R3-P7.9. The seven model-facing contract variants. The only thing a
 * variant changes is the REPRESENTATION shown to the model of the 7 in-scope tools
 * (the other 7 tools keep their current contract in every variant, exactly like
 * P7.8-R C1). Names, tool set, required fields, types, Gateway routing and domain
 * semantics (quantity required, full replacement) never change.
 *
 * A tool's model-facing definition is composed from five independent components:
 *   description   registry text (or the one-sentence thin text)
 *   useWhen       " Use when: ...."
 *   doNotUseWhen  " Do not use when: ...."
 *   semantics     the operationSemantics sentence (FULL_REPLACEMENT / CREATE_SNAPSHOT)
 *   schema        JSON schema (current, or with validation annotations stripped)
 * B0 composes all five as today (byte-identical to the P7.8-R "current" surface, by
 * test). B6 is the P7.8-R C1 surface itself (byte-identical, by test).
 *
 * Note (found while inspecting the contract, before any run): the current schemas
 * carry NO field descriptions - only types, required, `minimum`/`minItems` and the
 * optional properties `combinationId`/`limit`. So B5 (schema text) can only strip the
 * `minimum`/`minItems` annotations; the optional properties C1 dropped are measured
 * only inside B6 (i.e. in the B4 -> B6 step).
 */

export const ISOLATION_VARIANT_IDS = ["B0_CURRENT", "B1_THIN_DESCRIPTION", "B2_NO_USEWHEN", "B3_NO_DONOTUSEWHEN", "B4_THIN_PROSE", "B5_STRIPPED_SCHEMA_ANNOTATIONS", "B6_FULL_THIN"] as const;
export type IsolationVariantId = (typeof ISOLATION_VARIANT_IDS)[number];

export type ContractToggles = {
  description: "current" | "thin";
  useWhen: "keep" | "drop";
  doNotUseWhen: "keep" | "drop";
  semantics: "keep" | "drop";
  schema: "current" | "stripped";
};

const CURRENT: ContractToggles = { description: "current", useWhen: "keep", doNotUseWhen: "keep", semantics: "keep", schema: "current" };

/** B6 is not composed: it IS buildThinToolSurface() (P7.8-R C1). Its toggles below are the equivalent description, used for the size breakdown only (thin schema = required + types, optional properties dropped). */
export const VARIANT_TOGGLES: Record<Exclude<IsolationVariantId, "B6_FULL_THIN">, ContractToggles> = {
  B0_CURRENT: CURRENT,
  B1_THIN_DESCRIPTION: { ...CURRENT, description: "thin" },
  B2_NO_USEWHEN: { ...CURRENT, useWhen: "drop" },
  B3_NO_DONOTUSEWHEN: { ...CURRENT, doNotUseWhen: "drop" },
  B4_THIN_PROSE: { description: "thin", useWhen: "drop", doNotUseWhen: "drop", semantics: "drop", schema: "current" },
  B5_STRIPPED_SCHEMA_ANNOTATIONS: { ...CURRENT, schema: "stripped" }
};

export const VARIANT_LABELS: Record<IsolationVariantId, string> = {
  B0_CURRENT: "current contract, verbatim (control)",
  B1_THIN_DESCRIPTION: "only the human description is thinned (one sentence); useWhen, doNotUseWhen, semantics sentence and schema stay current",
  B2_NO_USEWHEN: "only useWhen removed",
  B3_NO_DONOTUSEWHEN: "only doNotUseWhen removed",
  B4_THIN_PROSE: "all model-facing prose thinned (thin description; no useWhen, doNotUseWhen or semantics sentence); schema stays current",
  B5_STRIPPED_SCHEMA_ANNOTATIONS: "only schema validation annotations (minimum, minItems) stripped; required, names, types, optional properties unchanged",
  B6_FULL_THIN: "P7.8-R C1 thin contract (prose thinned + schema reduced to required + types), positive control"
};

const STRIPPED_KEYWORDS = new Set(["description", "title", "examples", "default", "minimum", "maximum", "minItems", "maxItems"]);

/** Removes annotation/constraint keywords only; required, properties, types, items and additionalProperties are untouched. */
export function stripSchemaAnnotations<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((entry) => stripSchemaAnnotations(entry)) as unknown as T;
  if (schema && typeof schema === "object") return Object.fromEntries(Object.entries(schema as Record<string, unknown>).filter(([key]) => !STRIPPED_KEYWORDS.has(key)).map(([key, value]) => [key, stripSchemaAnnotations(value)])) as T;
  return schema;
}

export type ToolComponents = { description: string; useWhen: string | undefined; doNotUseWhen: string | undefined; semantics: string | undefined; schema: Record<string, unknown> };

/** The registry-backed components of one tool (same source and same rendering rules as toolSurface.ts currentDefinition). */
export function currentComponents(name: string): ToolComponents {
  const definition = resolveCapabilityGatewayDefinition(name);
  return {
    description: definition?.description ?? name,
    useWhen: definition?.useWhen,
    doNotUseWhen: definition?.doNotUseWhen,
    semantics: definition?.operationSemantics && OPERATION_SEMANTICS_SENTENCES[definition.operationSemantics] ? OPERATION_SEMANTICS_SENTENCES[definition.operationSemantics] : undefined,
    schema: (definition?.inputSchema as Record<string, unknown> | undefined) ?? { type: "object", properties: {} }
  };
}

const RELEVANT = new Set<string>(THIN_RELEVANT_TOOL_NAMES);

/** The pieces that make up the rendered description of a composed tool, used both to render it and to size each component. */
export function descriptionPieces(name: string, toggles: ContractToggles): { description: string; useWhen: string; doNotUseWhen: string; semantics: string } {
  const c = currentComponents(name);
  return {
    description: toggles.description === "thin" ? THIN_TOOL_DEFINITIONS[name as (typeof THIN_RELEVANT_TOOL_NAMES)[number]].description : c.description,
    useWhen: toggles.useWhen === "keep" && c.useWhen ? ` Use when: ${c.useWhen}.` : "",
    doNotUseWhen: toggles.doNotUseWhen === "keep" && c.doNotUseWhen ? ` Do not use when: ${c.doNotUseWhen}.` : "",
    semantics: toggles.semantics === "keep" && c.semantics ? ` ${c.semantics}` : ""
  };
}

function composeTool(name: string, toggles: ContractToggles): NativeToolDefinition {
  const pieces = descriptionPieces(name, toggles);
  const c = currentComponents(name);
  return { name, description: `${pieces.description}${pieces.useWhen}${pieces.doNotUseWhen}${pieces.semantics}`, parameters: toggles.schema === "stripped" ? stripSchemaAnnotations(c.schema) : c.schema };
}

export function buildIsolationSurface(variant: IsolationVariantId): ToolSurface {
  if (variant === "B6_FULL_THIN") return { ...buildThinToolSurface(), id: variant };
  const toggles = VARIANT_TOGGLES[variant];
  const current = buildCurrentToolSurface();
  // The 7 non-scope tools are taken verbatim from the current surface; the 7 in scope are composed.
  return buildSurface(
    variant,
    TRUE_HARNESS_TOOL_NAMES.map((name) => (RELEVANT.has(name) ? composeTool(name, toggles) : (current.tools.find((tool) => tool.name === name) as NativeToolDefinition)))
  );
}

export const sha16 = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);

export type ToolContractRow = {
  tool: string;
  descriptionChars: number;
  useWhenChars: number;
  doNotUseWhenChars: number;
  semanticsChars: number;
  schemaChars: number;
  totalChars: number;
  approxTokens: number;
  requiredFields: string[];
  definitionSha16: string;
};

/** Per-tool size breakdown of the 7 in-scope tools (component chars are the rendered text each component contributes; the description text is the whole model-facing description string). */
export function contractBreakdown(variant: IsolationVariantId): { variant: IsolationVariantId; label: string; totalChars: number; approxTokens: number; relevantChars: number; relevantApproxTokens: number; descriptionChars: number; schemaChars: number; tools: ToolContractRow[] } {
  const surface = buildIsolationSurface(variant);
  const tools: ToolContractRow[] = THIN_RELEVANT_TOOL_NAMES.map((name) => {
    const tool = surface.tools.find((candidate) => candidate.name === name) as NativeToolDefinition;
    const pieces = variant === "B6_FULL_THIN" ? { description: tool.description, useWhen: "", doNotUseWhen: "", semantics: "" } : descriptionPieces(name, VARIANT_TOGGLES[variant]);
    const schemaChars = JSON.stringify(tool.parameters).length;
    const totalChars = tool.name.length + tool.description.length + schemaChars;
    return {
      tool: name,
      descriptionChars: pieces.description.length,
      useWhenChars: pieces.useWhen.length,
      doNotUseWhenChars: pieces.doNotUseWhen.length,
      semanticsChars: pieces.semantics.length,
      schemaChars,
      totalChars,
      approxTokens: Math.ceil(totalChars / 4),
      requiredFields: [...(((tool.parameters as { required?: string[] }).required) ?? [])].sort(),
      definitionSha16: sha16(JSON.stringify(tool))
    };
  });
  return {
    variant,
    label: VARIANT_LABELS[variant],
    totalChars: surface.stats.totalChars,
    approxTokens: Math.ceil(surface.stats.totalChars / 4),
    relevantChars: surface.stats.relevantToolChars,
    relevantApproxTokens: Math.ceil(surface.stats.relevantToolChars / 4),
    descriptionChars: surface.stats.descriptionChars,
    schemaChars: surface.stats.schemaChars,
    tools
  };
}
