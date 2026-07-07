import { appendRequestEvent } from "../conversation-request";
import { getActiveRequestFact, upsertRequestFact } from "../request-facts";
import type { RequestFact } from "../request-facts";
import type { TurnPlanRecord } from "./turnPlanTypes";

export type PersistProposedFactsResult = {
  facts: RequestFact[];
  warnings: string[];
};

function sameValue(current: unknown, proposed: unknown): boolean {
  try {
    return JSON.stringify(current) === JSON.stringify(proposed);
  } catch {
    return false;
  }
}

/**
 * Persists the plan's extracted facts scoped to their own request - a fact
 * proposed for one request never touches another. Idempotent across retries
 * of the same turn: re-proposing the identical value does not create another
 * version. Everything lands as `inferred`; confirmation is a separate,
 * explicit step that never happens here.
 */
export async function persistProposedFacts(
  record: TurnPlanRecord,
  requestIdsByDetection: Record<string, string>
): Promise<PersistProposedFactsResult> {
  const facts: RequestFact[] = [];
  const warnings: string[] = [];
  const occurredAt = new Date().toISOString();
  const touchedRequests = new Set<string>();

  for (const detection of record.plan.detections) {
    if (detection.extractedFacts.length === 0) continue;
    const requestId = requestIdsByDetection[detection.detectionId];
    if (!requestId) {
      warnings.push(`fact_without_request:${detection.detectionId}`);
      continue;
    }

    for (const proposed of detection.extractedFacts) {
      const active = await getActiveRequestFact(requestId, proposed.factKey);
      if (active && sameValue(active.value, proposed.value)) {
        facts.push(active);
        continue;
      }

      const result = await upsertRequestFact({
        requestId,
        factKey: proposed.factKey,
        value: proposed.value,
        confidence: proposed.confidence,
        sourceMessageId: proposed.sourceMessageId ?? record.inboundMessageId
      });
      if (!result.ok) {
        warnings.push(`fact_upsert_failed:${requestId}:${proposed.factKey}:${result.warning}`);
        continue;
      }
      facts.push(result.fact);
      touchedRequests.add(requestId);
    }
  }

  for (const requestId of touchedRequests) {
    await appendRequestEvent({
      dedupeKey: `request:${requestId}:turn:${record.turnPlanId}:facts_updated`,
      requestId,
      eventType: "facts_updated",
      sourceType: "planner",
      sourceId: record.turnPlanId,
      payload: { factKeys: facts.filter((fact) => fact.requestId === requestId).map((fact) => fact.factKey) },
      occurredAt
    });
  }

  return { facts, warnings };
}
