"use client";

import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";

type Props = {
  readonly preview: readonly Readonly<Record<string, unknown>>[];
};

// Renders only the columns Customer Profile actually returned in the preview payload - no
// invented columns (RFM/cluster/CLV/affinity evidence are only shown if the backend sends them).
export function AudiencePreviewTable({ preview }: Props) {
  if (preview.length === 0) {
    return <EmptyState title="Sin vista previa" description="La evaluacion no devolvio filas de muestra." icon="table_rows" />;
  }

  const columns = Array.from(preview.reduce((keys, row) => { Object.keys(row).forEach((key) => keys.add(key)); return keys; }, new Set<string>()));

  return (
    <div>
      <p className="mb-2 text-label-sm text-slate-500">
        Vista previa: muestra acotada de {preview.length} fila(s). No representa el total de la audiencia ni es autoridad de exportacion.
      </p>
      <DataTable headers={columns}>
        {preview.map((row, index) => (
          <tr key={index}>
            {columns.map((column) => (
              <td key={column}>{formatCell(row[column])}</td>
            ))}
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
