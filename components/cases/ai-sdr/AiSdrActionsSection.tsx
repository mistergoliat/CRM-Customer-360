import React from "react";
import { CaseInlineNote } from "../CaseDetailPrimitives";
import { StatusChip } from "@/components/ui/StatusChip";
import type { CommercialShadowReviewViewModel } from "@/lib/brain/commercial/review";

function ActionCard({
  title,
  items,
  emptyBody
}: {
  title: string;
  items: CommercialShadowReviewViewModel["actions"]["proposed"];
  emptyBody: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label-bold uppercase text-slate-500">{title}</p>
        <StatusChip label={`${items.length}`} tone={items.length > 0 ? "blue" : "gray"} />
      </div>
      {items.length === 0 ? (
        <div className="mt-3">
          <CaseInlineNote tone="info" title="Sin elementos" body={emptyBody} />
        </div>
      ) : (
        <div className="mt-3 grid gap-2">
          {items.map((item, index) => (
            <div key={`${title}-${index}-${item.type ?? "unknown"}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-body-md">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip label={item.status} tone={item.status === "blocked" ? "red" : item.status === "allowed" ? "green" : "gray"} />
                {item.type ? <StatusChip label={item.type} tone="gray" /> : null}
                {item.priority ? <StatusChip label={item.priority} tone="amber" /> : null}
                {item.requiresApproval ? <StatusChip label={item.requiresApproval} tone="amber" /> : null}
              </div>
              <p className="mt-2 break-words text-on-surface">{item.reason ?? "sin razón"}</p>
              <p className="mt-1 text-label-sm text-slate-500">
                Confidence: {item.confidence ?? "sin dato"} | Risk: {item.riskLevel ?? "sin dato"} | Expira: {item.expiresAt ?? "sin dato"}
              </p>
              {item.blockedReason ? <p className="mt-1 text-label-sm text-rose-700">{item.blockedReason}</p> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolRequestCard({
  title,
  items,
  emptyBody
}: {
  title: string;
  items: CommercialShadowReviewViewModel["toolRequests"]["proposed"];
  emptyBody: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-label-bold uppercase text-slate-500">{title}</p>
        <StatusChip label={`${items.length}`} tone={items.length > 0 ? "amber" : "gray"} />
      </div>
      {items.length === 0 ? (
        <div className="mt-3">
          <CaseInlineNote tone="info" title="Sin elementos" body={emptyBody} />
        </div>
      ) : (
        <div className="mt-3 grid gap-2">
          {items.map((item, index) => (
            <div key={`${title}-${index}-${item.tool ?? "unknown"}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-body-md">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip label={item.status} tone={item.status === "blocked" ? "red" : item.status === "allowed" ? "green" : "gray"} />
                {item.tool ? <StatusChip label={item.tool} tone="gray" /> : null}
                {item.statusLabel ? <StatusChip label={item.statusLabel} tone="amber" /> : null}
                {item.blocking ? <StatusChip label="blocking" tone="amber" /> : null}
                {item.available === true ? <StatusChip label="available" tone="green" /> : item.available === false ? <StatusChip label="not available" tone="red" /> : null}
              </div>
              <p className="mt-2 break-words text-on-surface">{item.reason ?? "sin razón"}</p>
              <p className="mt-1 text-label-sm text-slate-500">
                Purpose: {item.purpose ?? "sin datos"} | Urgency: {item.urgency ?? "sin dato"} | Fallback: {item.fallbackDecision ?? "sin dato"}
              </p>
              {item.expectedEvidence.length > 0 ? (
                <p className="mt-1 text-label-sm text-slate-500">Evidence: {item.expectedEvidence.join(", ")}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AiSdrActionsSection({ review }: { review: CommercialShadowReviewViewModel }) {
  void React;
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-headline-md text-on-surface">Acciones y tools</p>
        <StatusChip label="no execution" tone="gray" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ActionCard title="Acciones propuestas" items={review.actions.proposed} emptyBody="El Sales Agent no produjo acciones propuestas para esta observación." />
        <ToolRequestCard title="Tool requests" items={review.toolRequests.proposed} emptyBody="El Sales Agent no pidió herramientas ejecutables para esta observación." />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ActionCard title="Acciones bloqueadas" items={review.actions.blocked} emptyBody="No hay acciones bloqueadas en esta observación." />
        <ToolRequestCard title="Tool requests bloqueados" items={review.toolRequests.blocked} emptyBody="No hay tool requests bloqueados en esta observación." />
      </div>
    </section>
  );
}
