"use client";

import { StatusChip } from "@/components/ui/StatusChip";

export type AudienceWorkspaceStatus = "EMPTY" | "READY_TO_EVALUATE" | "EVALUATING" | "EVALUATED" | "STALE" | "EXPORTING" | "ERROR";

const STATUS_COPY: Record<AudienceWorkspaceStatus, { label: string; tone: "gray" | "blue" | "green" | "amber" | "red"; description: string }> = {
  EMPTY: { label: "Vacio", tone: "gray", description: "Agrega al menos una condicion para poder evaluar." },
  READY_TO_EVALUATE: { label: "Lista para evaluar", tone: "blue", description: "Definicion completa localmente. Evalua para obtener conteos reales." },
  EVALUATING: { label: "Evaluando...", tone: "blue", description: "Consultando a Customer Profile." },
  EVALUATED: { label: "Evaluada", tone: "green", description: "Resultado vigente para la definicion actual." },
  STALE: { label: "Desactualizada", tone: "amber", description: "Editaste la definicion despues de evaluar. Vuelve a evaluar para exportar." },
  EXPORTING: { label: "Exportando...", tone: "blue", description: "Generando archivo en Customer Profile." },
  ERROR: { label: "Error", tone: "red", description: "La ultima operacion fallo. Revisa el detalle." }
};

export function AudienceStatusBanner({ status }: { readonly status: AudienceWorkspaceStatus }) {
  const copy = STATUS_COPY[status];
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <StatusChip label={copy.label} tone={copy.tone} />
      <p className="text-body-sm text-slate-600">{copy.description}</p>
    </div>
  );
}
