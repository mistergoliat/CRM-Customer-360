"use client";

import clsx from "clsx";
import { Icon } from "@/components/ui/Icon";
import {
  createEmptyAffinityCondition,
  createEmptyGroup,
  createEmptyScalarCondition,
  type AudienceBuilderAffinityCondition,
  type AudienceBuilderGroup,
  type AudienceBuilderNode,
  type AudienceBuilderScalarCondition,
  type AudienceCapabilitySchema
} from "@/lib/marketing/customerIntelligenceAudience";
import { AffinityConditionEditor } from "./AffinityConditionEditor";
import { AudienceConditionRow } from "./AudienceConditionRow";

type Props = {
  readonly group: AudienceBuilderGroup;
  readonly depth: number;
  readonly schema: AudienceCapabilitySchema;
  readonly errors: ReadonlyMap<string, string>;
  readonly onChange: (group: AudienceBuilderGroup) => void;
  readonly onRemove?: () => void;
};

export function AudienceGroup({ group, depth, schema, errors, onChange, onRemove }: Props) {
  function updateChild(childId: string, next: AudienceBuilderNode) {
    onChange({ ...group, children: group.children.map((child) => (child.id === childId ? next : child)) });
  }

  function removeChild(childId: string) {
    onChange({ ...group, children: group.children.filter((child) => child.id !== childId) });
  }

  function addChild(node: AudienceBuilderNode) {
    onChange({ ...group, children: [...group.children, node] });
  }

  return (
    <div className={clsx("rounded-xl border p-3", depth === 0 ? "border-slate-200 bg-slate-50/60" : "border-slate-200 bg-white")}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
          {(["AND", "OR"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => onChange({ ...group, kind })}
              className={clsx(
                "h-9 px-3 text-label-bold uppercase transition",
                group.kind === kind ? "bg-primary text-white" : "bg-white text-slate-600 hover:bg-slate-50"
              )}
            >
              {kind === "AND" ? "Todas (ALL)" : "Alguna (ANY)"}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => onChange({ ...group, negate: !group.negate })}
          className={clsx(
            "h-9 rounded-lg border px-3 text-label-bold uppercase transition",
            group.negate ? "border-red-300 bg-red-50 text-red-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          )}
        >
          NOT
        </button>

        {onRemove ? (
          <button type="button" aria-label="Eliminar grupo" onClick={onRemove} className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
            <Icon name="close" />
          </button>
        ) : null}
      </div>

      <div className="mt-3 space-y-2 border-l-2 border-slate-200 pl-3">
        {group.children.length === 0 ? <p className="text-body-sm text-slate-500">Grupo vacio. Agrega una condicion.</p> : null}
        {group.children.map((child) => {
          if (child.type === "GROUP") {
            return (
              <AudienceGroup key={child.id} group={child} depth={depth + 1} schema={schema} errors={errors} onChange={(next) => updateChild(child.id, next)} onRemove={() => removeChild(child.id)} />
            );
          }
          if (child.type === "HAS_AFFINITY") {
            return (
              <AffinityConditionEditor
                key={child.id}
                condition={child as AudienceBuilderAffinityCondition}
                axes={schema.specialConditions.hasAffinity.allowedAxes}
                errorMessage={errors.get(child.id) ?? null}
                onChange={(next) => updateChild(child.id, next)}
                onRemove={() => removeChild(child.id)}
              />
            );
          }
          return (
            <AudienceConditionRow
              key={child.id}
              condition={child as AudienceBuilderScalarCondition}
              schema={schema}
              errorMessage={errors.get(child.id) ?? null}
              onChange={(next) => updateChild(child.id, next)}
              onRemove={() => removeChild(child.id)}
            />
          );
        })}
        {errors.get(group.id) ? <p className="text-label-sm font-semibold text-red-600">{errors.get(group.id)}</p> : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => addChild(createEmptyScalarCondition())} className="hub-button-secondary h-9 px-3 text-label-sm">
          + Condicion
        </button>
        <button type="button" onClick={() => addChild(createEmptyAffinityCondition())} className="hub-button-secondary h-9 px-3 text-label-sm">
          + Afinidad
        </button>
        <button type="button" onClick={() => addChild(createEmptyGroup())} className="hub-button-secondary h-9 px-3 text-label-sm">
          + Grupo anidado
        </button>
      </div>
    </div>
  );
}
