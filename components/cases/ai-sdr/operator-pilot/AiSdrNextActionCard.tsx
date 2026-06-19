import React from "react";
import { CaseInlineNote } from "../../CaseDetailPrimitives";
import { StatusChip } from "@/components/ui/StatusChip";
import type { AiSdrOperatorPilotViewModel } from "@/lib/brain/commercial/operator-pilot";

function toneForValue(value: string | null | undefined) {
  if (!value) return "gray" as const;
  const text = value.toLowerCase();
  if (text.includes("blocked") || text.includes("error")) return "red" as const;
  if (text.includes("wait") || text.includes("review") || text.includes("pause") || text.includes("clarify")) return "amber" as const;
  if (text.includes("respond") || text.includes("ready") || text.includes("allow")) return "green" as const;
  return "gray" as const;
}

export function AiSdrNextActionCard({ pilot }: { pilot: AiSdrOperatorPilotViewModel }) {
  void React;
  const nextAction = pilot.nextAction;

  if (!nextAction) {
    return <CaseInlineNote tone="info" title="Próxima acción no disponible" body="Todavía no existe una próxima acción operacional que mostrar en este caso." />;
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label-bold uppercase text-slate-500">Próxima acción recomendada</p>
        <div className="flex flex-wrap gap-2">
          <StatusChip label={nextAction.label} tone={toneForValue(nextAction.type)} />
          <StatusChip label="ejecutable no" tone="gray" />
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-label-bold uppercase text-slate-500">Tipo</p>
          <p className="mt-1 break-words text-body-md font-semibold text-on-surface">{nextAction.type}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-label-bold uppercase text-slate-500">Riesgo</p>
          <p className="mt-1 break-words text-body-md font-semibold text-on-surface">{nextAction.riskLevel ?? "sin dato"}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-label-bold uppercase text-slate-500">Approval requirement</p>
          <p className="mt-1 break-words text-body-md font-semibold text-on-surface">{nextAction.approvalRequirement ?? "sin dato"}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-label-bold uppercase text-slate-500">Canal recomendado</p>
          <p className="mt-1 break-words text-body-md font-semibold text-on-surface">{nextAction.recommendedChannel ?? "sin dato"}</p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-label-bold uppercase text-slate-500">Motivo</p>
        <p className="mt-1 break-words text-body-md text-on-surface">{nextAction.reason}</p>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-label-bold uppercase text-slate-500">Borrador</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-body-md text-on-surface">{nextAction.draftMessage ?? "sin borrador"}</p>
      </div>

      {nextAction.blockedReasons.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {nextAction.blockedReasons.map((reason) => (
            <StatusChip key={reason} label={reason} tone="red" />
          ))}
        </div>
      ) : null}

      <div className="mt-3 text-label-sm text-slate-500">
        <span>Confidence: {nextAction.confidence ?? "sin dato"}</span>
        <span className="mx-2">|</span>
        <span>Ejecutable: no</span>
      </div>
    </section>
  );
}
