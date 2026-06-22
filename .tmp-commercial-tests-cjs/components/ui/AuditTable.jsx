"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditTable = AuditTable;
const format_1 = require("@/lib/format");
const DataTable_1 = require("./DataTable");
const EmptyState_1 = require("./EmptyState");
const StatusChip_1 = require("./StatusChip");
function AuditTable({ rows }) {
    if (rows.length === 0) {
        return <EmptyState_1.EmptyState title="Sin auditoría registrada" description="Los eventos operacionales aparecerán aquí cuando se ejecuten acciones." icon="policy"/>;
    }
    return (<DataTable_1.DataTable headers={["Fecha", "Acción", "Entidad", "Detalle"]}>
      {rows.map((row, index) => (<tr key={String(row.id ?? index)}>
          <td>{(0, format_1.formatDateTime)(row.created_at)}</td>
          <td>
            <StatusChip_1.StatusChip label={String(row.action ?? "sin acción")}/>
          </td>
          <td>
            <p className="font-semibold text-on-surface">{String(row.entity_type ?? "sin entidad")}</p>
            <p className="text-label-sm text-slate-500">{String(row.entity_id ?? "sin id")}</p>
          </td>
          <td className="max-w-xl text-label-sm text-slate-500">{(0, format_1.truncate)(row.after_json || row.before_json, 180)}</td>
        </tr>))}
    </DataTable_1.DataTable>);
}
