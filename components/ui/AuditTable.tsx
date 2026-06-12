import { formatDateTime, truncate } from "@/lib/format";
import type { DbRow } from "@/lib/db";
import { DataTable } from "./DataTable";
import { EmptyState } from "./EmptyState";
import { StatusChip } from "./StatusChip";

export function AuditTable({ rows }: { rows: DbRow[] }) {
  if (rows.length === 0) {
    return <EmptyState title="Sin auditoría registrada" description="Los eventos operacionales aparecerán aquí cuando se ejecuten acciones." icon="policy" />;
  }

  return (
    <DataTable headers={["Fecha", "Acción", "Entidad", "Detalle"]}>
      {rows.map((row, index) => (
        <tr key={String(row.id ?? index)}>
          <td>{formatDateTime(row.created_at)}</td>
          <td>
            <StatusChip label={String(row.action ?? "sin acción")} />
          </td>
          <td>
            <p className="font-semibold text-on-surface">{String(row.entity_type ?? "sin entidad")}</p>
            <p className="text-label-sm text-slate-500">{String(row.entity_id ?? "sin id")}</p>
          </td>
          <td className="max-w-xl text-label-sm text-slate-500">{truncate(row.after_json || row.before_json, 180)}</td>
        </tr>
      ))}
    </DataTable>
  );
}
