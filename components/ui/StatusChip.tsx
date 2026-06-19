import React from "react";
import clsx from "clsx";
import type { ChipTone } from "@/lib/status";
import { toneForStatus } from "@/lib/status";

void React;

const toneClasses: Record<ChipTone, string> = {
  red: "bg-red-50 text-red-700 ring-red-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  slate: "bg-slate-800 text-white ring-slate-700"
};

type StatusChipProps = {
  label: string;
  tone?: ChipTone;
  className?: string;
};

export function StatusChip({ label, tone, className }: StatusChipProps) {
  const resolvedTone = tone ?? toneForStatus(label);
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase leading-4 ring-1 ring-inset",
        toneClasses[resolvedTone],
        className
      )}
    >
      {label}
    </span>
  );
}
