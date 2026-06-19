import React from "react";
import { CaseDetailField, CaseInlineNote } from "../../CaseDetailPrimitives";
import { StatusChip } from "@/components/ui/StatusChip";
import type { AiSdrOperatorPilotViewModel } from "@/lib/brain/commercial/operator-pilot";

function statusTone(value: string | null | undefined) {
  if (!value) return "gray" as const;
  const text = value.toLowerCase();
  if (text.includes("error") || text.includes("blocked") || text.includes("failed")) return "red" as const;
  if (text.includes("wait") || text.includes("review") || text.includes("pending")) return "amber" as const;
  if (text.includes("complete") || text.includes("available") || text.includes("respond") || text.includes("ready")) return "green" as const;
  return "gray" as const;
}

export function AiSdrOperatorSummary({ pilot }: { pilot: AiSdrOperatorPilotViewModel }) {
  void React;

  const commercialState = pilot.commercialState;
  if (!commercialState) {
    return <CaseInlineNote tone="info" title="Sin estado operacional" body="No existe un estado comercial duradero disponible para este caso." />;
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <StatusChip label={`status ${pilot.status}`} tone={statusTone(pilot.status)} />
        <StatusChip label={`commercial ${commercialState.status ?? "unknown"}`} tone={statusTone(commercialState.status)} />
        <StatusChip label={`stage ${commercialState.stage ?? "unknown"}`} tone={statusTone(commercialState.stage)} />
        <StatusChip label={`risk ${pilot.nextAction?.riskLevel ?? "unknown"}`} tone={statusTone(pilot.nextAction?.riskLevel)} />
        <StatusChip label={`approval ${pilot.nextAction?.approvalRequirement ?? "unknown"}`} tone={statusTone(pilot.nextAction?.approvalRequirement)} />
      </div>

      {pilot.status === "waiting_for_operational_loop" ? (
        <CaseInlineNote
          tone="info"
          title="Modo puente"
          body="Aún no existe un resultado operacional persistido. Esta vista usa la observación shadow como referencia parcial."
        />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <CaseDetailField label="Estado comercial" value={commercialState.status ?? "sin datos"} />
        <CaseDetailField label="Etapa" value={commercialState.stage ?? "sin datos"} />
        <CaseDetailField label="Temperatura" value={commercialState.temperature ?? "sin datos"} />
        <CaseDetailField label="Prioridad" value={commercialState.priority ?? "sin datos"} />
        <CaseDetailField label="Resumen breve" value={commercialState.summary ?? "sin datos"} />
        <CaseDetailField label="Esperando por" value={commercialState.waitingFor ?? "sin datos"} />
      </div>
    </section>
  );
}
