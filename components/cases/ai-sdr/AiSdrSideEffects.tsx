import React from "react";
import { CaseInlineNote } from "../CaseDetailPrimitives";
import { StatusChip } from "@/components/ui/StatusChip";
import type { CommercialShadowReviewViewModel } from "@/lib/brain/commercial/review";

function invariantRow(label: string, value: string) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <span className="text-body-md text-slate-600">{label}</span>
      <span className="text-body-md font-semibold text-on-surface">{value}</span>
    </div>
  );
}

export function AiSdrSideEffects({ review }: { review: CommercialShadowReviewViewModel }) {
  void React;
  const invariant = review.invariants;

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-headline-md text-on-surface">Side effects</p>
        <StatusChip label={invariant.violationDetected ? "critical" : "zero side effects"} tone={invariant.violationDetected ? "red" : "green"} />
      </div>

      {invariant.violationDetected ? <CaseInlineNote tone="warning" title="Violación de invariantes" body="La observación contiene evidencia estructurada de un side effect o una contradicción que merece revisión crítica." /> : null}

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {invariantRow("Outbound ejecutado", invariant.outboundExecuted ? "sí" : "no")}
        {invariantRow("Tools ejecutadas", String(invariant.toolsExecuted))}
        {invariantRow("DB writes comerciales", String(invariant.commercialDbWrites))}
        {invariantRow("Lead creada", invariant.leadCreated ? "sí" : "no")}
        {invariantRow("Opportunity creada", invariant.opportunityCreated ? "sí" : "no")}
        {invariantRow("Case mutado", invariant.caseMutated ? "sí" : "no")}
        {invariantRow("Controla Response Policy", invariant.controlsResponsePolicy ? "sí" : "no")}
        {invariantRow("Shadow / dry-run", invariant.shadow && invariant.dryRun ? "sí" : "no")}
      </div>

      {invariant.violations.length > 0 ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-label-bold uppercase text-rose-800">Violations</p>
          <ul className="mt-3 space-y-2 text-body-md text-rose-900">
            {invariant.violations.map((violation) => (
              <li key={violation} className="rounded-lg bg-white px-3 py-2">
                {violation}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
