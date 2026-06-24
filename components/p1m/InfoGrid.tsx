import { isValidElement, type ReactNode } from "react";
import { formatDateTime } from "@/lib/format";

type InfoItem = {
  label: string;
  value: React.ReactNode;
};

type InfoGridProps = {
  items: InfoItem[];
  columns?: 2 | 3;
};

export function InfoGrid({ items, columns = 2 }: InfoGridProps) {
  return (
    <dl className={columns === 3 ? "grid gap-3 md:grid-cols-3" : "grid gap-3 md:grid-cols-2"}>
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
          <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">{item.label}</dt>
          <dd className="mt-1 text-body-md font-semibold text-on-surface">{renderValue(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function renderValue(value: ReactNode) {
  if (isValidElement(value)) return value;
  const candidate = value as unknown;
  if (candidate instanceof Date) return formatDateTime(candidate);
  if (typeof candidate === "object" && candidate !== null && "toISOString" in candidate && typeof (candidate as { toISOString?: unknown }).toISOString === "function") {
    return formatDateTime(candidate as Date);
  }
  if (typeof candidate === "object" && candidate !== null) {
    try {
      return JSON.stringify(candidate);
    } catch {
      return String(candidate);
    }
  }
  return value;
}
