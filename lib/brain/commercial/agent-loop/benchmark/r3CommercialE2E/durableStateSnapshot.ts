import type { CommercialDomainReadModel } from "../../../domain-read-model";
import { buildR3AgentTurnInputShadowDomainReadModel } from "../../../agent-turn-input/buildR3AgentTurnInputShadowDomainReadModel";
import type { AgentTurnInputShadowReadMetrics } from "../../../agent-turn-input/shadow";
import type { NativeCustomerSessionExecutionContext } from "../../../native-cycle/customer-session/types";
import type { CommercialContextSnapshot } from "../../../context/buildNativeCommercialContext";
import type { BenchmarkE2EDurableStateSnapshot } from "./types";

/**
 * SALES-AGENT-R3-P7.4. Pure mapping: CommercialDomainReadModel -> a bounded
 * BenchmarkE2EDurableStateSnapshot ("no copiar toda la DB", Section "INITIAL
 * / FINAL STATE"). No IO here - fetchDurableStateSnapshot below owns the one
 * DB/HTTP read, via the SAME builder P2 already uses (never a second DRM
 * semantic model, never a hand-rolled SQL projection).
 */
export function mapDomainReadModelToDurableStateSnapshot(
  drm: CommercialDomainReadModel,
  capturedAt: string
): BenchmarkE2EDurableStateSnapshot {
  return {
    capturedAt,
    workId: drm.case.workId,
    workVersion: drm.case.workVersion,
    workStatus: drm.case.status,
    objectiveType: drm.objective?.type ?? null,
    objectiveStatus: drm.objective?.status ?? null,
    selection: {
      present: drm.cart.factId !== null && drm.cart.items.length > 0,
      freshness: drm.cart.factId !== null ? drm.cart.freshness.state : null,
      itemCount: drm.cart.factId !== null ? drm.cart.items.length : null
    },
    destination: {
      present: drm.destination !== null,
      freshness: drm.destination?.freshness.state ?? null,
      communeId: drm.destination?.communeId ?? null
    },
    shipping: {
      present: drm.shipping.state !== "MISSING",
      freshness: drm.shipping.freshness.state
    },
    quote: {
      present: drm.quote !== null,
      freshness: drm.quote?.status ? drm.quote.status : null,
      quoteId: drm.quote?.quoteId ?? null,
      quoteStatus: drm.quote?.status ?? null
    },
    identityLevel: drm.customer.identityLevel
  };
}

/**
 * Thin IO wrapper: builds a fresh DRM read via the exact same P2 builder
 * (buildR3AgentTurnInputShadowDomainReadModel), with its own throwaway
 * metrics object - this is an external, off-path measurement the production
 * turn never sees or is affected by (a benchmark reading state before/after
 * a turn, never a second DRM build INSIDE the turn itself - P8 territory,
 * out of scope here). Failure is never silently swallowed into a fabricated
 * empty snapshot - callers decide how to record a null-because-failed state.
 */
export async function fetchDurableStateSnapshot(input: {
  conversationId: number;
  opportunityId: number | null;
  correlationId: string;
  snapshot: CommercialContextSnapshot;
  trustedCustomerSession?: NativeCustomerSessionExecutionContext | null;
  currentTime: string;
}): Promise<BenchmarkE2EDurableStateSnapshot> {
  const metrics: AgentTurnInputShadowReadMetrics = { dbReads: 0, httpReads: 0 };
  const drm = await buildR3AgentTurnInputShadowDomainReadModel({
    conversationId: input.conversationId,
    opportunityId: input.opportunityId,
    correlationId: input.correlationId,
    snapshot: input.snapshot,
    trustedCustomerSession: input.trustedCustomerSession,
    metrics
  });
  return mapDomainReadModelToDurableStateSnapshot(drm, input.currentTime);
}
