import Link from "next/link";
import clsx from "clsx";

export type TabItem = {
  label: string;
  href?: string;
  active?: boolean;
};

type TabStripProps = {
  tabs: TabItem[];
  className?: string;
};

export function TabStrip({ tabs, className }: TabStripProps) {
  return (
    <div className={clsx("flex flex-wrap gap-2", className)}>
      {tabs.map((tab) =>
        tab.href ? (
          <Link
            key={tab.label}
            href={tab.href}
            className={clsx(
              "inline-flex h-10 items-center rounded-xl border px-4 text-label-bold uppercase transition",
              tab.active ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            )}
          >
            {tab.label}
          </Link>
        ) : (
          <span
            key={tab.label}
            className={clsx(
              "inline-flex h-10 items-center rounded-xl border px-4 text-label-bold uppercase",
              tab.active ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600"
            )}
          >
            {tab.label}
          </span>
        )
      )}
    </div>
  );
}
