"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TechnicalDetailsPanel = TechnicalDetailsPanel;
const format_1 = require("@/lib/format");
const fields = [
    "active_case_key",
    "case_scope_key",
    "final_action",
    "bot_replied",
    "requires_human",
    "case_view_token",
    "first_message_id",
    "last_message_id",
    "source_table",
    "source_id",
    "created_at",
    "updated_at",
    "first_message_at",
    "last_message_at",
    "last_customer_message_at"
];
function TechnicalDetailsPanel({ row }) {
    return (<details className="hub-card p-5">
      <summary className="cursor-pointer text-headline-md text-on-surface">Panel técnico</summary>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {fields.map((field) => (<div key={field} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-label-bold uppercase text-slate-500">{field}</p>
            <p className="mt-1 break-words text-body-md text-on-surface">
              {field.endsWith("_at") || ["created_at", "updated_at"].includes(field) ? (0, format_1.formatDateTime)(row[field]) : (0, format_1.asText)(row[field])}
            </p>
          </div>))}
      </div>
    </details>);
}
