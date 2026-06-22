"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaseTechnicalPanel = CaseTechnicalPanel;
const CaseDetailPrimitives_1 = require("./CaseDetailPrimitives");
const caseFields = [
    "active_case_key",
    "case_view_token",
    "first_message_id",
    "last_message_id",
    "last_message_db_id",
    "first_intent",
    "last_intent",
    "final_action",
    "source_table",
    "source_id",
    "created_at",
    "updated_at",
    "first_message_at",
    "last_message_at",
    "last_message_occurred_at",
    "last_customer_message_at"
];
const queueDateFields = new Set(["created_at", "updated_at", "sent_at", "delivered_at", "read_at", "failed_at", "last_inbound_at"]);
function CaseTechnicalPanel({ row, sourceQueue }) {
    return (<details className="hub-card overflow-hidden border-l-4 border-l-slate-300">
      <summary className="cursor-pointer px-5 py-4 text-headline-md text-on-surface">Panel tecnico</summary>
      <div className="border-t border-slate-200 p-5">
        <div className="grid gap-5">
          <div>
            <p className="mb-3 text-label-bold uppercase text-slate-500">Case trace</p>
            <div className="grid gap-3 md:grid-cols-2">
              {caseFields.map((field) => (<CaseDetailPrimitives_1.CaseDetailField key={field} label={field} value={row[field]} mono={field.includes("key") || field.includes("_id") || field.includes("token")} date={field.endsWith("_at")}/>))}
            </div>
          </div>

          <div>
            <p className="mb-3 text-label-bold uppercase text-slate-500">Legacy queue trace</p>
            <div className="grid gap-3 md:grid-cols-2">
              {sourceQueue ? (Object.entries(sourceQueue).map(([field, value]) => (<CaseDetailPrimitives_1.CaseDetailField key={field} label={field} value={value} mono={field.includes("id") || field.includes("table") || field.includes("domain")} date={queueDateFields.has(field)}/>))) : (<CaseDetailPrimitives_1.CaseDetailField label="legacy_queue" value="sin datos"/>)}
            </div>
          </div>
        </div>
      </div>
    </details>);
}
