import React from "react";
import { CaseInlineNote } from "../../CaseDetailPrimitives";
import type { AiSdrOperatorPilotViewModel } from "@/lib/brain/commercial/operator-pilot";

function InfoCard({
  title,
  items,
  emptyBody
}: {
  title: string;
  items: Array<{ label: string; value?: string | null; confidence?: number | null; source?: string | null; reason?: string | null; requiredFor?: string | null }>;
  emptyBody: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-label-bold uppercase text-slate-500">{title}</p>
      {items.length === 0 ? (
        <div className="mt-3">
          <CaseInlineNote tone="info" title="Sin elementos" body={emptyBody} />
        </div>
      ) : (
        <div className="mt-3 grid gap-2">
          {items.map((item, index) => (
            <div key={`${title}-${index}-${item.label}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-label-bold uppercase text-slate-500">{item.label}</p>
              {item.value ? <p className="mt-1 break-words text-body-md font-semibold text-on-surface">{item.value}</p> : null}
              {item.reason ? <p className="mt-1 break-words text-body-md text-slate-600">{item.reason}</p> : null}
              <p className="mt-1 text-label-sm text-slate-500">
                {item.confidence === null || item.confidence === undefined ? "Confidence: sin dato" : `Confidence: ${item.confidence}`}
                {item.source ? ` | Source: ${item.source}` : ""}
                {item.requiredFor ? ` | Required for: ${item.requiredFor}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AiSdrKnownMissingInfo({ pilot }: { pilot: AiSdrOperatorPilotViewModel }) {
  void React;
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-headline-md text-on-surface">Información conocida y faltante</p>
        <span className="text-label-sm text-slate-500">Los faltantes se muestran explícitamente</span>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <InfoCard
          title="Información conocida"
          items={pilot.knownInformation}
          emptyBody="No hay información conocida suficiente para el piloto operacional."
        />
        <InfoCard
          title="Información faltante"
          items={pilot.missingInformation}
          emptyBody="No hay información faltante estructurada para este caso."
        />
      </div>
    </section>
  );
}
