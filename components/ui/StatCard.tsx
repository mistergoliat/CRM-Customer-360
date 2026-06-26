import React from "react";
import clsx from "clsx";
import { isValidElement, type ReactNode } from "react";
import { Icon } from "./Icon";
import { formatDateTime } from "@/lib/format";

type StatCardProps = {
  title: string;
  value: ReactNode;
  description?: string;
  icon?: string;
  state?: "ok" | "warning" | "error" | "muted";
};

const stateBorder = {
  ok: "before:bg-emerald-500",
  warning: "before:bg-amber-500",
  error: "before:bg-primary-container",
  muted: "before:bg-slate-300"
};

export function StatCard({ title, value, description, icon, state = "muted" }: StatCardProps) {
  return (
    <div
      className={clsx(
        "hub-card relative overflow-hidden p-5 before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:rounded-r-sm",
        stateBorder[state]
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-label-bold uppercase text-slate-500">{title}</p>
          <p className="mt-2 text-stats-lg text-on-surface">{renderStatValue(value)}</p>
        </div>
        {icon ? (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-fixed text-primary">
            <Icon name={icon} />
          </div>
        ) : null}
      </div>
      {description ? <p className="mt-3 text-label-sm text-slate-500">{description}</p> : null}
    </div>
  );
}

function renderStatValue(value: ReactNode) {
  if (isValidElement(value)) return value;
  const candidate = value as unknown;
  if (candidate instanceof Date) return formatDateTime(candidate);
  if (typeof candidate === "object" && candidate !== null) {
    try {
      return JSON.stringify(candidate);
    } catch {
      return String(candidate);
    }
  }
  return value;
}
