"use client";

import { Icon } from "@/components/ui/Icon";
import type { AudienceBuilderAffinityCondition } from "@/lib/marketing/customerIntelligenceAudience";
import { AUDIENCE_AXIS_LABELS } from "./audienceLabels";

type Props = {
  readonly condition: AudienceBuilderAffinityCondition;
  readonly axes: readonly string[];
  readonly errorMessage: string | null;
  readonly onChange: (condition: AudienceBuilderAffinityCondition) => void;
  readonly onRemove: () => void;
};

export function AffinityConditionEditor({ condition, axes, errorMessage, onChange, onRemove }: Props) {
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-label-sm font-bold uppercase text-violet-700">Afinidad</span>

        <select
          aria-label="Eje de afinidad"
          className="h-10 min-w-[190px] rounded-lg border border-slate-300 bg-white px-2 text-body-sm"
          value={condition.axis ?? ""}
          onChange={(event) => onChange({ ...condition, axis: event.target.value || null })}
        >
          <option value="">Selecciona un eje...</option>
          {axes.map((axis) => (
            <option key={axis} value={axis}>
              {AUDIENCE_AXIS_LABELS[axis] ?? axis}
            </option>
          ))}
        </select>

        <input
          aria-label="Codigo de afinidad"
          className="h-10 min-w-[160px] rounded-lg border border-slate-300 bg-white px-2 text-body-sm"
          placeholder="HOME_GYM"
          value={condition.code}
          onChange={(event) => onChange({ ...condition, code: event.target.value })}
        />

        <input
          aria-label="Puntaje minimo"
          className="h-10 w-28 rounded-lg border border-slate-300 bg-white px-2 text-body-sm"
          placeholder="minScore (0-1)"
          value={condition.minScore}
          onChange={(event) => onChange({ ...condition, minScore: event.target.value })}
        />

        <button type="button" aria-label="Eliminar condicion" onClick={onRemove} className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
          <Icon name="close" />
        </button>
      </div>
      {errorMessage ? <p className="mt-1 text-label-sm font-semibold text-red-600">{errorMessage}</p> : null}
    </div>
  );
}
