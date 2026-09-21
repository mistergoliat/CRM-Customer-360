import { createHash } from "node:crypto";
import type { NativeToolDefinition } from "../r3TrueAB/nativeToolClient";
import { buildCurrentToolSurface, buildSurface, type ToolSurface } from "../r3TrueAB/toolSurface";
import { currentComponents } from "../r3CapabilityIsolation/isolationSurfaces";

/**
 * SALES-AGENT-R3-P7.10. The three model-facing `select_products` semantics variants.
 *
 *  S0 - CURRENT: the P7.8-R "current" surface, byte for byte (control).
 *  S1 - CONSEQUENCE STATEMENT ONLY: identical to S0 except for the FIRST sentence of the
 *       select_products description (the one that states what the call means: "Records the
 *       customer's confirmed product selection ... durable, authoritative commercial line
 *       items"), replaced by a statement of the real consequence. `useWhen` and `doNotUseWhen`
 *       stay current, including their purchase/commitment framing.
 *  S2 - COHERENT REVERSIBLE SEMANTICS: S1 PLUS a coherent `useWhen` and `doNotUseWhen`, i.e.
 *       every piece of select_products prose that frames the call as a purchase/commitment is
 *       replaced by wording consistent with "provisional, reversible working selection".
 *       S1 -> S2 is exactly that difference (useWhen + doNotUseWhen).
 *
 * Unchanged in every variant (asserted by tests): the tool name, the input schema (quantity
 * stays REQUIRED), the evidence sentence of the description, the operationSemantics sentence
 * (FULL_REPLACEMENT), the other 13 tools, the Gateway route and the domain behavior. No
 * variant hardcodes a speech act or an example from the corpus.
 */

export const SEMANTICS_VARIANT_IDS = ["S0_CURRENT_SEMANTICS", "S1_CONSEQUENCE_STATEMENT", "S2_COHERENT_REVERSIBLE_SEMANTICS"] as const;
export type SemanticsVariantId = (typeof SEMANTICS_VARIANT_IDS)[number];

export const SEMANTICS_VARIANT_LABELS: Record<SemanticsVariantId, string> = {
  S0_CURRENT_SEMANTICS: "current select_products contract, verbatim (control)",
  S1_CONSEQUENCE_STATEMENT: "only the consequence sentence of the select_products description is replaced (provisional, reversible working selection, no additional confirmation to save it); useWhen and doNotUseWhen stay current",
  S2_COHERENT_REVERSIBLE_SEMANTICS: "S1 plus coherent useWhen/doNotUseWhen: no select_products wording frames the call as a purchase or a commitment"
};

/** The one sentence S1 and S2 put in place of the current consequence sentence. FROZEN before the smoke. */
export const S1_CONSEQUENCE_TEXT =
  "Updates the customer's current working product selection (productId/combinationId/quantity). This selection is provisional and reversible conversational state: it can be changed later, and it does not create an order, purchase, payment, checkout, reservation, or any other irreversible commitment. When the customer has clearly stated which product and quantity they want, update this working selection directly; do not ask for an additional confirmation solely to save this provisional selection.";

/** S2-only wording. Replace "...make up the current purchase" and "...rather than committed to". FROZEN before the smoke. */
export const S2_USE_WHEN = "the customer's intended products and quantities are sufficiently clear to update the working selection";
export const S2_DO_NOT_USE_WHEN = "the products are still only being explored, compared, or recommended rather than chosen by the customer";

const EVIDENCE_MARKER = "Every item must reference";

/** The registry description split at the evidence sentence: [current consequence sentence, evidence sentence (kept verbatim in S1 and S2)]. */
export function selectProductsDescriptionParts(): { consequence: string; evidence: string } {
  const description = currentComponents("select_products").description;
  const index = description.indexOf(EVIDENCE_MARKER);
  if (index <= 0) throw new Error("select_products registry description no longer has the expected consequence/evidence structure");
  return { consequence: description.slice(0, index).trimEnd(), evidence: description.slice(index) };
}

/** The pieces of the current rendered select_products description, in the order buildCurrentToolSurface renders them: description, " Use when: ...", " Do not use when: ...", " <semantics sentence>". */
export function selectProductsCurrentPieces(current: NativeToolDefinition): { registry: string; useWhen: string; doNotUseWhen: string; semantics: string } {
  const c = currentComponents("select_products");
  if (!c.useWhen || !c.doNotUseWhen || !c.semantics) throw new Error("select_products registry contract no longer has useWhen/doNotUseWhen/semantics");
  const useWhen = ` Use when: ${c.useWhen}.`;
  const doNotUseWhen = ` Do not use when: ${c.doNotUseWhen}.`;
  const semantics = ` ${c.semantics}`;
  if (current.description !== `${c.description}${useWhen}${doNotUseWhen}${semantics}`) throw new Error("current select_products description is not registry description + useWhen + doNotUseWhen + semantics");
  return { registry: c.description, useWhen, doNotUseWhen, semantics };
}

function buildS1Tool(current: NativeToolDefinition): NativeToolDefinition {
  const pieces = selectProductsCurrentPieces(current);
  const { evidence } = selectProductsDescriptionParts();
  return { name: current.name, description: `${S1_CONSEQUENCE_TEXT} ${evidence}${pieces.useWhen}${pieces.doNotUseWhen}${pieces.semantics}`, parameters: current.parameters };
}

function buildS2Tool(current: NativeToolDefinition): NativeToolDefinition {
  const pieces = selectProductsCurrentPieces(current);
  const { evidence } = selectProductsDescriptionParts();
  return { name: current.name, description: `${S1_CONSEQUENCE_TEXT} ${evidence} Use when: ${S2_USE_WHEN}. Do not use when: ${S2_DO_NOT_USE_WHEN}.${pieces.semantics}`, parameters: current.parameters };
}

export function buildSemanticsSurface(variant: SemanticsVariantId): ToolSurface {
  const current = buildCurrentToolSurface();
  if (variant === "S0_CURRENT_SEMANTICS") return { ...current, id: variant };
  const rebuild = variant === "S1_CONSEQUENCE_STATEMENT" ? buildS1Tool : buildS2Tool;
  return buildSurface(
    variant,
    current.tools.map((tool) => (tool.name === "select_products" ? rebuild(tool) : tool))
  );
}

export const sha256Text = (text: string): string => createHash("sha256").update(text).digest("hex");
export const sha16 = (text: string): string => sha256Text(text).slice(0, 16);

const selectTool = (surface: ToolSurface): NativeToolDefinition => surface.tools.find((tool) => tool.name === "select_products") as NativeToolDefinition;

/** Content hashes of the model-facing contracts (recorded in the manifest and verified by the freeze): whole surface, select_products tool, and its schema, for S0, S1 and S2. */
export function semanticsContractHashes(): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const variant of SEMANTICS_VARIANT_IDS) {
    const prefix = variant.slice(0, 2);
    const surface = buildSemanticsSurface(variant);
    hashes[`${prefix}:tools`] = sha256Text(JSON.stringify(surface.tools));
    hashes[`${prefix}:select_products`] = sha256Text(JSON.stringify(selectTool(surface)));
    hashes[`${prefix}:select_products.schema`] = sha256Text(JSON.stringify(selectTool(surface).parameters));
  }
  return hashes;
}

export type SemanticsContractRow = { variant: SemanticsVariantId; label: string; totalChars: number; approxTokens: number; selectProductsDescriptionChars: number; selectProductsSchemaChars: number; selectProductsSha16: string; toolsSha16: string };

export function semanticsContractRow(variant: SemanticsVariantId): SemanticsContractRow {
  const surface = buildSemanticsSurface(variant);
  const tool = selectTool(surface);
  return {
    variant,
    label: SEMANTICS_VARIANT_LABELS[variant],
    totalChars: surface.stats.totalChars,
    approxTokens: Math.ceil(surface.stats.totalChars / 4),
    selectProductsDescriptionChars: tool.description.length,
    selectProductsSchemaChars: JSON.stringify(tool.parameters).length,
    selectProductsSha16: sha16(JSON.stringify(tool)),
    toolsSha16: sha16(JSON.stringify(surface.tools))
  };
}
