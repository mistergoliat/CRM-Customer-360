import React from "react";
import clsx from "clsx";

type SurfaceBadgeKind = "fixture" | "preview" | "readOnly" | "provisional" | "notAvailable" | "real";

const badgeStyles: Record<SurfaceBadgeKind, string> = {
  fixture: "border-sky-200 bg-sky-50 text-sky-700",
  preview: "border-amber-200 bg-amber-50 text-amber-800",
  readOnly: "border-slate-200 bg-slate-100 text-slate-700",
  provisional: "border-violet-200 bg-violet-50 text-violet-700",
  notAvailable: "border-red-200 bg-red-50 text-red-700",
  real: "border-emerald-200 bg-emerald-50 text-emerald-700"
};

const badgeLabels: Record<SurfaceBadgeKind, string> = {
  fixture: "Datos de demostración",
  preview: "Preview",
  readOnly: "Solo lectura",
  provisional: "Provisional",
  notAvailable: "No disponible",
  real: "Datos reales"
};

type SurfaceBadgeProps = {
  kind: SurfaceBadgeKind;
  className?: string;
};

export function SurfaceBadge({ kind, className }: SurfaceBadgeProps) {
  return (
    <span className={clsx("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em]", badgeStyles[kind], className)}>
      {badgeLabels[kind]}
    </span>
  );
}
