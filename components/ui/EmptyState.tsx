import { Icon } from "./Icon";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: string;
};

export function EmptyState({ title, description, icon = "inbox" }: EmptyStateProps) {
  return (
    <div className="hub-card flex min-h-48 flex-col items-center justify-center p-8 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
        <Icon name={icon} />
      </div>
      <h2 className="text-headline-md text-on-surface">{title}</h2>
      {description ? <p className="mt-2 max-w-md text-body-md text-slate-500">{description}</p> : null}
    </div>
  );
}
