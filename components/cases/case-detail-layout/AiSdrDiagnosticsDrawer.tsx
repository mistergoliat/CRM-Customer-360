import React from "react";
import type { CommercialShadowReviewViewModel } from "@/lib/brain/commercial/review";
import { StatusChip } from "@/components/ui/StatusChip";
import { AiSdrReviewPanel } from "../ai-sdr/AiSdrReviewPanel";

function toneForStatus(status: CommercialShadowReviewViewModel["status"]) {
  if (status === "available") return "green" as const;
  if (status === "disabled") return "gray" as const;
  if (status === "error") return "red" as const;
  return "gray" as const;
}

export function AiSdrDiagnosticsDrawer({
  caseId,
  review
}: {
  caseId: string | number;
  review: CommercialShadowReviewViewModel;
}) {
  void React;

  return (
    <details className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <summary className="cursor-pointer list-none px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-label-bold uppercase text-slate-500">Ver diagnóstico técnico</p>
            <p className="mt-1 text-body-md text-slate-600">Bloque colapsado por defecto para no competir con el copiloto operativo.</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <StatusChip label={review.status} tone={toneForStatus(review.status)} />
            <StatusChip label="read-only" tone="gray" />
          </div>
        </div>
      </summary>

      <div className="border-t border-slate-200 p-4">
        <AiSdrReviewPanel caseId={caseId} review={review} />
      </div>
    </details>
  );
}
