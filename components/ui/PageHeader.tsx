import { StatusChip } from "./StatusChip";

type PageHeaderProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  status?: string;
  actions?: React.ReactNode;
};

export function PageHeader({ title, eyebrow, description, status, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="mb-2 flex items-center gap-2">
          {eyebrow ? <p className="text-label-bold uppercase text-primary">{eyebrow}</p> : null}
          {status ? <StatusChip label={status} /> : null}
        </div>
        <h1 className="text-headline-xl text-on-surface">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-body-md text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
