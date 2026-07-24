import Link from "next/link";
import clsx from "clsx";

export type TabItem = {
  label: string;
  href?: string;
  active?: boolean;
  /** Used only when href is absent - lets a tab strip drive local (non-routed) tab state. */
  onClick?: () => void;
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
          <button
            key={tab.label}
            type="button"
            onClick={tab.onClick}
            className={clsx(
              "inline-flex h-10 items-center rounded-xl border px-4 text-label-bold uppercase transition",
              tab.active ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            )}
          >
            {tab.label}
          </button>
        )
      )}
    </div>
  );
}
