import { StatusChip } from "./StatusChip";

type HealthStatusCardProps = {
  title: string;
  status: "ok" | "warning" | "error";
  description: string;
  details?: string;
};

export function HealthStatusCard({ title, status, description, details }: HealthStatusCardProps) {
  const label = status === "ok" ? "OK" : status === "warning" ? "Atención" : "Error";
  return (
    <div className="hub-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-label-bold uppercase text-slate-500">{title}</p>
          <p className="mt-2 text-body-md text-slate-700">{description}</p>
        </div>
        <StatusChip label={label} tone={status === "ok" ? "green" : status === "warning" ? "amber" : "red"} />
      </div>
      {details ? <p className="mt-3 border-t border-slate-100 pt-3 text-label-sm text-slate-500">{details}</p> : null}
    </div>
  );
}
