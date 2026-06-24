import clsx from "clsx";
import { SectionCard } from "./SectionCard";

type ChartPoint = {
  label: string;
  value: number;
};

type ChartCardProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  series: ChartPoint[];
  unit?: string;
  className?: string;
};

export function ChartCard({ title, eyebrow, description, series, unit, className }: ChartCardProps) {
  const maxValue = Math.max(...series.map((item) => item.value), 1);

  return (
    <SectionCard title={title} eyebrow={eyebrow} description={description} className={clsx(className)}>
      <div className="space-y-3">
        {series.map((item) => {
          const width = `${Math.max((item.value / maxValue) * 100, 6)}%`;
          return (
            <div key={item.label}>
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="text-label-bold uppercase text-slate-500">{item.label}</span>
                <span className="text-body-md font-semibold text-on-surface">
                  {item.value}
                  {unit ?? ""}
                </span>
              </div>
              <div className="h-3 rounded-full bg-slate-100">
                <div className="h-3 rounded-full bg-gradient-to-r from-primary to-primary-container" style={{ width }} />
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
