import type { ReactNode } from "react";
import clsx from "clsx";

type SectionCardProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function SectionCard({ title, eyebrow, description, actions, children, className }: SectionCardProps) {
  return (
    <section className={clsx("hub-card overflow-hidden", className)}>
      <header className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          {eyebrow ? <p className="text-label-bold uppercase text-primary">{eyebrow}</p> : null}
          <h2 className="text-headline-md text-on-surface">{title}</h2>
          {description ? <p className="mt-1 max-w-3xl text-body-md text-slate-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
