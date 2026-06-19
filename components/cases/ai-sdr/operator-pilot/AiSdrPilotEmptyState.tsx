import React from "react";
import { CaseInlineNote } from "../../CaseDetailPrimitives";
import type { AiSdrOperatorPilotViewModel } from "@/lib/brain/commercial/operator-pilot";

export function AiSdrPilotEmptyState({ pilot }: { pilot: AiSdrOperatorPilotViewModel }) {
  void React;

  if (pilot.status === "disabled") {
    return <CaseInlineNote tone="warning" title="Piloto deshabilitado" body="El shell operativo estaba deshabilitado para esta corrida. No existe una vista operacional inspectable." />;
  }

  if (pilot.status === "error") {
    return (
      <div className="grid gap-3">
        <CaseInlineNote tone="warning" title="Piloto con error" body="La lectura del piloto operativo falló de forma segura. La conversación y el caso siguen disponibles." />
        {pilot.error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-body-md text-rose-900">
            <p className="text-label-bold uppercase">Error seguro</p>
            <p className="mt-1 break-words">{pilot.error}</p>
          </div>
        ) : null}
      </div>
    );
  }

  return <CaseInlineNote tone="info" title="No existe una vista operacional AI SDR" body="No existe un resultado operacional persistido o vinculable para este caso. Esto no es un error del caso." />;
}
