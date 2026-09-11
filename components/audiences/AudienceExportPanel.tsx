"use client";

import { useState } from "react";
import clsx from "clsx";
import {
  AUDIENCE_EXPORT_FORMATS,
  AUDIENCE_PII_EXPORT_FIELDS,
  DEFAULT_AUDIENCE_EXPORT_FIELDS,
  type AudienceExportField,
  type AudienceExportFormat
} from "@/lib/marketing/customerIntelligenceAudience";

const OPTIONAL_FIELDS: readonly AudienceExportField[] = AUDIENCE_PII_EXPORT_FIELDS;

const FIELD_LABELS: Record<AudienceExportField, string> = {
  customerId: "ID de cliente",
  email: "Email",
  firstname: "Nombre",
  lastname: "Apellido"
};

type Props = {
  readonly disabled: boolean;
  readonly exporting: boolean;
  readonly exportError: string | null;
  readonly exportWarning: string | null;
  readonly onExport: (format: AudienceExportFormat, fields: readonly AudienceExportField[]) => void;
};

export function AudienceExportPanel({ disabled, exporting, exportError, exportWarning, onExport }: Props) {
  const [format, setFormat] = useState<AudienceExportFormat>("CSV");
  const [optionalFields, setOptionalFields] = useState<Set<AudienceExportField>>(new Set(DEFAULT_AUDIENCE_EXPORT_FIELDS.filter((field) => field !== "customerId")));

  function toggleField(field: AudienceExportField) {
    setOptionalFields((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-label-bold uppercase text-slate-500">Formato</p>
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
          {AUDIENCE_EXPORT_FORMATS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFormat(option)}
              className={clsx("h-10 px-4 text-label-bold uppercase transition", format === option ? "bg-primary text-white" : "bg-white text-slate-600 hover:bg-slate-50")}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-label-bold uppercase text-slate-500">Campos</p>
        <label className="flex items-center gap-2 py-1 text-body-sm text-slate-500">
          <input type="checkbox" checked disabled />
          {FIELD_LABELS.customerId} (siempre incluido)
        </label>
        {OPTIONAL_FIELDS.map((field) => (
          <label key={field} className="flex items-center gap-2 py-1 text-body-sm text-slate-700">
            <input type="checkbox" checked={optionalFields.has(field)} onChange={() => toggleField(field)} />
            {FIELD_LABELS[field]}
          </label>
        ))}
      </div>

      <button
        type="button"
        className="hub-button-primary h-11 w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled || exporting}
        onClick={() => onExport(format, ["customerId", ...Array.from(optionalFields)])}
      >
        {exporting ? "Exportando..." : "Descargar"}
      </button>

      {disabled && !exporting ? <p className="text-label-sm text-slate-500">Evalua la audiencia (sin cambios pendientes) para habilitar la descarga.</p> : null}
      {exportError ? <p className="text-label-sm font-semibold text-red-600">{exportError}</p> : null}
      {exportWarning ? <p className="text-label-sm font-semibold text-amber-700">{exportWarning}</p> : null}
    </div>
  );
}
