import { formatPercent } from "./catalogDisplay";

type ScoreScale = "decimal" | "percent";

export type CommercialScoreDonutProps = {
  value: number | null | undefined;
  label?: string;
  scale?: ScoreScale;
};

export type NormalizedScore = {
  percent: number | null;
  label: string;
};

export function normalizeCommercialScore(value: number | null | undefined, scale: ScoreScale = "decimal"): NormalizedScore {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { percent: null, label: "N/D" };
  }

  const percent = scale === "percent" ? value : value * 100;
  const clamped = Math.min(100, Math.max(0, percent));
  return { percent: clamped, label: formatPercent(clamped / 100) };
}

export function CommercialScoreDonut({ value, label = "Commercial", scale = "decimal" }: CommercialScoreDonutProps) {
  const normalized = normalizeCommercialScore(value, scale);
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const dash = normalized.percent === null ? 0 : (normalized.percent / 100) * circumference;
  const ariaLabel =
    normalized.percent === null
      ? `${label}: puntaje comercial no disponible`
      : `${label}: puntaje comercial ${normalized.label}`;

  return (
    <div className="flex items-center gap-2" role="group" aria-label={ariaLabel}>
      <svg className="h-12 w-12 shrink-0 -rotate-90" viewBox="0 0 48 48" role="img" aria-hidden="true">
        <circle cx="24" cy="24" r={radius} fill="none" stroke="currentColor" strokeWidth="6" className="text-slate-200" />
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          className="text-primary"
        />
      </svg>
      <div className="min-w-0">
        <p className="text-label-bold uppercase text-slate-500">{label}</p>
        <p className="text-body-md font-bold text-on-surface">{normalized.label}</p>
      </div>
    </div>
  );
}
