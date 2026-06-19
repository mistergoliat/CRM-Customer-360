import React from "react";
import clsx from "clsx";
import type { ReactNode } from "react";
import { asText, formatDateTime } from "@/lib/format";

void React;

type PanelAccent = "red" | "slate" | "amber" | "blue";

const accentClasses: Record<PanelAccent, string> = {
  red: "border-l-4 border-l-primary-container",
  slate: "border-l-4 border-l-slate-300",
  amber: "border-l-4 border-l-amber-300",
  blue: "border-l-4 border-l-sky-300"
};

export function CasePanelFrame({
  title,
  description,
  accent = "red",
  actions,
  children,
  className
}: {
  title: string;
  description?: string;
  accent?: PanelAccent;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("hub-card overflow-hidden", accentClasses[accent], className)}>
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-headline-md text-on-surface">{title}</p>
            {description ? <p className="mt-1 text-body-md text-slate-500">{description}</p> : null}
          </div>
          {actions}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function CaseDetailField({
  label,
  value,
  mono = false,
  date = false,
  className
}: {
  label: string;
  value: unknown;
  mono?: boolean;
  date?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx("rounded-lg border border-slate-200 bg-white p-3", className)}>
      <p className="text-label-bold uppercase text-slate-500">{label}</p>
      <p className={clsx("mt-1 break-words text-body-md font-semibold text-on-surface", mono && "font-mono text-[13px]")}>
        {date ? formatDateTime(value) : asText(value)}
      </p>
    </div>
  );
}

export function CaseInlineNote({
  tone,
  title,
  body
}: {
  tone: "info" | "warning";
  title: string;
  body: string;
}) {
  const toneClass =
    tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div className={clsx("rounded-lg border px-4 py-3", toneClass)}>
      <p className="text-label-bold uppercase">{title}</p>
      <p className="mt-1 text-body-md">{body}</p>
    </div>
  );
}
