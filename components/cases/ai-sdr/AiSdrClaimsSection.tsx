import React from "react";
import { CaseInlineNote } from "../CaseDetailPrimitives";
import { StatusChip } from "@/components/ui/StatusChip";
import type { CommercialShadowReviewViewModel } from "@/lib/brain/commercial/review";

function renderClaimCard(title: string, claims: CommercialShadowReviewViewModel["claims"]["detected"], tone: "gray" | "green" | "red" | "amber") {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label-bold uppercase text-slate-500">{title}</p>
        <StatusChip label={`${claims.length}`} tone={tone} />
      </div>
      {claims.length === 0 ? (
        <div className="mt-3">
          <CaseInlineNote tone="info" title="Sin elementos" body="No hay claims en esta sección para la observación actual." />
        </div>
      ) : (
        <div className="mt-3 grid gap-2">
          {claims.map((claim, index) => (
            <div key={`${title}-${index}-${claim.type ?? "unknown"}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-body-md">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StatusChip label={claim.status} tone={claim.status === "blocked" ? "red" : claim.status === "allowed" ? "green" : "gray"} />
                {claim.type ? <StatusChip label={claim.type} tone="gray" /> : null}
              </div>
              <p className="mt-2 break-words text-on-surface">{claim.value ?? "sin valor"}</p>
              <p className="mt-1 text-label-sm text-slate-500">
                Evidencia: {claim.evidenceSource ?? "sin dato"} | Verificado: {claim.verified === null ? "sin dato" : claim.verified ? "sí" : "no"} | Confidence: {claim.confidence ?? "sin dato"}
              </p>
              {claim.reason ? <p className="mt-1 text-label-sm text-rose-700">{claim.reason}</p> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AiSdrClaimsSection({ review }: { review: CommercialShadowReviewViewModel }) {
  void React;
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-headline-md text-on-surface">Claims</p>
        <StatusChip label="read only" tone="gray" />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {renderClaimCard("Claims detectados", review.claims.detected, "gray")}
        {renderClaimCard("Claims permitidos", review.claims.allowed, "green")}
        {renderClaimCard("Claims bloqueados", review.claims.blocked, "red")}
      </div>
    </section>
  );
}
