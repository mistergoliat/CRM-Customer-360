import React from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import type { ActionQueueViewModel } from "@/lib/brain/commercial/action-queue";
import type { CommercialShadowReviewViewModel } from "@/lib/brain/commercial/review";
import type { AiSdrOperatorPilotViewModel } from "@/lib/brain/commercial/operator-pilot";
import { ActionQueuePanel } from "../ai-sdr/action-queue/ActionQueuePanel";
import { AiSdrKnownMissingInfo } from "../ai-sdr/operator-pilot/AiSdrKnownMissingInfo";
import { AiSdrOperatorSummary } from "../ai-sdr/operator-pilot/AiSdrOperatorSummary";
import { AiSdrPilotControls } from "../ai-sdr/operator-pilot/AiSdrPilotControls";
import { AiSdrSuggestedReplyCard } from "./AiSdrSuggestedReplyCard";
import { AiSdrDiagnosticsDrawer } from "./AiSdrDiagnosticsDrawer";

function toneForStatus(value: string | null | undefined) {
  if (!value) return "gray" as const;
  const text = value.toLowerCase();
  if (text.includes("blocked") || text.includes("error") || text.includes("unavailable")) return "red" as const;
  if (text.includes("preview") || text.includes("review") || text.includes("wait") || text.includes("pending")) return "amber" as const;
  if (text.includes("available") || text.includes("persisted") || text.includes("completed") || text.includes("allowed")) return "green" as const;
  return "gray" as const;
}

export function AiSdrCopilotPanel({
  caseId,
  pilot,
  actionQueue,
  review
}: {
  caseId: string | number;
  pilot: AiSdrOperatorPilotViewModel;
  actionQueue: ActionQueueViewModel;
  review: CommercialShadowReviewViewModel;
}) {
  void React;

  return (
    <aside className="flex min-h-0 flex-col gap-4 rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-[0_24px_90px_-45px_rgba(15,23,42,0.45)] backdrop-blur xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-emerald-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-label-bold uppercase text-slate-500">AI SDR Copilot</p>
            <h2 className="mt-1 text-headline-md text-on-surface">Copiloto lateral read-only</h2>
            <p className="mt-2 text-body-md text-slate-600">
              Acompaña el chat principal con insights, sugerencias, cola de acciones y diagnóstico colapsado.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <StatusChip label={pilot.status} tone={toneForStatus(pilot.status)} />
            <StatusChip label={actionQueue.status} tone={toneForStatus(actionQueue.status)} />
            <StatusChip label={pilot.nextAction?.riskLevel ?? "unknown"} tone={toneForStatus(pilot.nextAction?.riskLevel)} />
          </div>
        </div>
      </div>

      <AiSdrOperatorSummary pilot={pilot} />
      <AiSdrSuggestedReplyCard pilot={pilot} />
      <AiSdrKnownMissingInfo pilot={pilot} />
      <AiSdrPilotControls pilot={pilot} />

      <ActionQueuePanel caseId={caseId} actionQueue={actionQueue} />
      <AiSdrDiagnosticsDrawer caseId={caseId} review={review} />

      {pilot.warnings.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-label-bold uppercase text-amber-800">Warnings</p>
          <ul className="mt-3 space-y-2 text-body-md text-amber-900">
            {pilot.warnings.map((warning) => (
              <li key={warning} className="rounded-lg bg-white px-3 py-2">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
