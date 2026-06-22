"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiSdrClaimsSection = AiSdrClaimsSection;
const react_1 = __importDefault(require("react"));
const CaseDetailPrimitives_1 = require("../CaseDetailPrimitives");
const StatusChip_1 = require("@/components/ui/StatusChip");
function renderClaimCard(title, claims, tone) {
    return (<div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label-bold uppercase text-slate-500">{title}</p>
        <StatusChip_1.StatusChip label={`${claims.length}`} tone={tone}/>
      </div>
      {claims.length === 0 ? (<div className="mt-3">
          <CaseDetailPrimitives_1.CaseInlineNote tone="info" title="Sin elementos" body="No hay claims en esta sección para la observación actual."/>
        </div>) : (<div className="mt-3 grid gap-2">
          {claims.map((claim, index) => (<div key={`${title}-${index}-${claim.type ?? "unknown"}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-body-md">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StatusChip_1.StatusChip label={claim.status} tone={claim.status === "blocked" ? "red" : claim.status === "allowed" ? "green" : "gray"}/>
                {claim.type ? <StatusChip_1.StatusChip label={claim.type} tone="gray"/> : null}
              </div>
              <p className="mt-2 break-words text-on-surface">{claim.value ?? "sin valor"}</p>
              <p className="mt-1 text-label-sm text-slate-500">
                Evidencia: {claim.evidenceSource ?? "sin dato"} | Verificado: {claim.verified === null ? "sin dato" : claim.verified ? "sí" : "no"} | Confidence: {claim.confidence ?? "sin dato"}
              </p>
              {claim.reason ? <p className="mt-1 text-label-sm text-rose-700">{claim.reason}</p> : null}
            </div>))}
        </div>)}
    </div>);
}
function AiSdrClaimsSection({ review }) {
    void react_1.default;
    return (<section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-headline-md text-on-surface">Claims</p>
        <StatusChip_1.StatusChip label="read only" tone="gray"/>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {renderClaimCard("Claims detectados", review.claims.detected, "gray")}
        {renderClaimCard("Claims permitidos", review.claims.allowed, "green")}
        {renderClaimCard("Claims bloqueados", review.claims.blocked, "red")}
      </div>
    </section>);
}
