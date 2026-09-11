"use client";

import { Icon } from "@/components/ui/Icon";
import {
  getAudienceSchemaField,
  type AudienceBuilderScalarCondition,
  type AudienceCapabilitySchema,
  type AudienceScalarOperator
} from "@/lib/marketing/customerIntelligenceAudience";
import { AUDIENCE_OPERATOR_LABELS } from "./audienceLabels";

type Props = {
  readonly condition: AudienceBuilderScalarCondition;
  readonly schema: AudienceCapabilitySchema;
  readonly errorMessage: string | null;
  readonly onChange: (condition: AudienceBuilderScalarCondition) => void;
  readonly onRemove: () => void;
};

export function AudienceConditionRow({ condition, schema, errorMessage, onChange, onRemove }: Props) {
  const field = getAudienceSchemaField(schema, condition.field);

  function selectField(fieldId: string) {
    const nextField = getAudienceSchemaField(schema, fieldId);
    const nextOperator = nextField?.allowedOperators[0] ?? null;
    onChange({ ...condition, field: fieldId || null, operator: nextOperator, value: "", valueTo: "" });
  }

  function selectOperator(operator: string) {
    onChange({ ...condition, operator: operator as AudienceScalarOperator, value: "", valueTo: "" });
  }

  const needsValue = condition.operator !== null && condition.operator !== "IS_NULL" && condition.operator !== "IS_NOT_NULL";
  const needsSecondValue = condition.operator === "BETWEEN";
  const isMultiValue = condition.operator === "IN" || condition.operator === "NOT_IN";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Campo"
          className="h-10 min-w-[190px] rounded-lg border border-slate-300 bg-white px-2 text-body-sm"
          value={condition.field ?? ""}
          onChange={(event) => selectField(event.target.value)}
        >
          <option value="">Selecciona un campo...</option>
          {schema.fields.map((option) => (
            <option key={option.fieldId} value={option.fieldId}>
              [{option.component}] {option.fieldId}
            </option>
          ))}
        </select>

        <select
          aria-label="Operador"
          className="h-10 min-w-[160px] rounded-lg border border-slate-300 bg-white px-2 text-body-sm disabled:bg-slate-50"
          value={condition.operator ?? ""}
          disabled={!field}
          onChange={(event) => selectOperator(event.target.value)}
        >
          <option value="">Operador...</option>
          {field?.allowedOperators.map((operator) => (
            <option key={operator} value={operator}>
              {AUDIENCE_OPERATOR_LABELS[operator]}
            </option>
          ))}
        </select>

        {needsValue ? (
          <input
            aria-label={isMultiValue ? "Valores (separados por coma)" : "Valor"}
            className="h-10 min-w-[160px] flex-1 rounded-lg border border-slate-300 bg-white px-2 text-body-sm"
            placeholder={isMultiValue ? "valor1, valor2, ..." : field?.unit ? `Valor (${field.unit})` : valuePlaceholder(field?.scalarType)}
            value={condition.value}
            onChange={(event) => onChange({ ...condition, value: event.target.value })}
          />
        ) : null}

        {needsSecondValue ? (
          <input
            aria-label="Valor maximo"
            className="h-10 min-w-[120px] rounded-lg border border-slate-300 bg-white px-2 text-body-sm"
            placeholder="hasta"
            value={condition.valueTo}
            onChange={(event) => onChange({ ...condition, valueTo: event.target.value })}
          />
        ) : null}

        <button type="button" aria-label="Eliminar condicion" onClick={onRemove} className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
          <Icon name="close" />
        </button>
      </div>
      {field?.displayDescription ? <p className="mt-1 text-label-sm text-slate-400">{field.displayDescription}</p> : null}
      {errorMessage ? <p className="mt-1 text-label-sm font-semibold text-red-600">{errorMessage}</p> : null}
    </div>
  );
}

function valuePlaceholder(scalarType?: string): string {
  if (scalarType === "datetime") return "2026-01-01T00:00:00Z";
  if (scalarType === "integer" || scalarType === "decimal") return "Valor numerico";
  return "Valor";
}
