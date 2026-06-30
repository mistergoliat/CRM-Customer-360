import type { BrainOutboxWorkerRequest, BrainOutboxWorkerResponse } from "@/lib/brain/messaging/types";
import { planOutboxWorkerRun } from "@/lib/brain/messaging/outboxWorker";
import { runSalesConsultativeFlow } from "./engine";
import type { SalesConsultativeInput, SalesConsultativeResult } from "./types";

export type SalesConsultativeServiceDispatch = (request: BrainOutboxWorkerRequest) => Promise<BrainOutboxWorkerResponse>;

export type SalesConsultativeServiceResult = {
  result: SalesConsultativeResult;
  dispatchResult: BrainOutboxWorkerResponse | null;
  dispatchWarnings: string[];
};

export type SalesConsultativeServiceOptions = {
  dispatchOutboxWorker?: SalesConsultativeServiceDispatch;
  requestId?: string | null;
};

function compactStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

export async function runSalesConsultativeService(
  input: SalesConsultativeInput,
  options: SalesConsultativeServiceOptions = {}
): Promise<SalesConsultativeServiceResult> {
  const result = await runSalesConsultativeFlow(input);
  const dispatchWarnings: string[] = [];
  let dispatchResult: BrainOutboxWorkerResponse | null = null;

  if (result.persistence.outboundQueued && result.persistence.outboxId !== null && result.persistence.outboxId !== undefined) {
    const dispatch = options.dispatchOutboxWorker ?? planOutboxWorkerRun;
    try {
      dispatchResult = await dispatch({
        requestId: options.requestId ?? undefined,
        outboxId: result.persistence.outboxId,
        dryRun: false,
        lockOnly: false,
        debug: false
      });
      dispatchWarnings.push(...dispatchResult.warnings);
    } catch (error) {
      dispatchWarnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    result,
    dispatchResult,
    dispatchWarnings: compactStrings(dispatchWarnings)
  };
}
