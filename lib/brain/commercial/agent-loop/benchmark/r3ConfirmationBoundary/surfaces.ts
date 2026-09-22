import type { ToolSurface } from "../r3TrueAB/toolSurface";
import { buildSemanticsSurface, SEMANTICS_VARIANT_LABELS } from "../r3MutationSemantics/semanticsSurfaces";

/**
 * SALES-AGENT-R3-P7.11. R0 and R1 are NOT recreated: they are the exact P7.10 S0 (current,
 * verbatim) and S1 (consequence-statement) surfaces, imported unchanged. R0 === P7.10 S0 and
 * R1 === P7.10 S1 by construction (same function call, same underlying prose/schema), never a
 * re-typed copy - test-verified. P7.11 does not use S2.
 */

export const REPLICATION_VARIANT_IDS = ["R0_CURRENT_SEMANTICS", "R1_CONSEQUENCE_STATEMENT"] as const;
export type ReplicationVariantId = (typeof REPLICATION_VARIANT_IDS)[number];

export const REPLICATION_VARIANT_LABELS: Record<ReplicationVariantId, string> = {
  R0_CURRENT_SEMANTICS: SEMANTICS_VARIANT_LABELS.S0_CURRENT_SEMANTICS,
  R1_CONSEQUENCE_STATEMENT: SEMANTICS_VARIANT_LABELS.S1_CONSEQUENCE_STATEMENT
};

const UNDERLYING = { R0_CURRENT_SEMANTICS: "S0_CURRENT_SEMANTICS", R1_CONSEQUENCE_STATEMENT: "S1_CONSEQUENCE_STATEMENT" } as const;

/** The tools/adapt/stats are byte-identical to the P7.10 arm (only the `id` label differs, so P7.11 artifacts read R0/R1 instead of S0/S1). */
export function buildReplicationSurface(variant: ReplicationVariantId): ToolSurface {
  const surface = buildSemanticsSurface(UNDERLYING[variant]);
  return { ...surface, id: variant };
}
