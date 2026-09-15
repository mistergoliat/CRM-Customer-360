/**
 * Common freshness vocabulary for the commercial read model.
 *
 * A timestamp is provenance only.  `sourceVersion` and `anchors` carry the
 * information that lets a consumer decide whether a value still describes
 * the current commercial state.
 */
export type CommercialFreshnessState = "CURRENT" | "STALE" | "SUPERSEDED" | "HISTORICAL" | "UNKNOWN";

export type CommercialFreshness = {
  readonly state: CommercialFreshnessState;
  readonly source: string;
  readonly capturedAt: string | null;
  readonly sourceVersion: string | number | null;
  readonly anchors: readonly {
    readonly name: string;
    readonly value: string;
  }[];
  readonly reason: string | null;
};

export function makeCommercialFreshness(input: {
  state: CommercialFreshnessState;
  source: string;
  capturedAt?: string | null;
  sourceVersion?: string | number | null;
  anchors?: readonly { name: string; value: string }[];
  reason?: string | null;
}): CommercialFreshness {
  return {
    state: input.state,
    source: input.source,
    capturedAt: input.capturedAt ?? null,
    sourceVersion: input.sourceVersion ?? null,
    anchors: [...(input.anchors ?? [])],
    reason: input.reason ?? null
  };
}
