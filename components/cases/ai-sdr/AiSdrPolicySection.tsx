import React from "react";
import { CaseDetailField, CaseInlineNote } from "../CaseDetailPrimitives";
import { StatusChip } from "@/components/ui/StatusChip";
import type { CommercialShadowReviewViewModel } from "@/lib/brain/commercial/review";

export function AiSdrPolicySection({ review }: { review: CommercialShadowReviewViewModel }) {
  void React;
  const policy = review.policy;

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-headline-md text-on-surface">Policy y trazabilidad</p>
        <StatusChip label={review.status} tone={review.status === "error" ? "red" : review.status === "disabled" ? "amber" : "green"} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <CaseDetailField label="Correlation ID" value={review.identifiers.correlationId ?? "sin datos"} mono />
        <CaseDetailField label="Process inbound run ID" value={review.identifiers.processInboundRunId ?? "sin datos"} mono />
        <CaseDetailField label="Sales Agent run ID" value={review.identifiers.salesAgentRunId ?? "sin datos"} mono />
        <CaseDetailField label="Observed at" value={review.observedAt ?? "sin datos"} date />
        <CaseDetailField label="Contract version" value={policy.versions.contractVersion ?? "sin datos"} mono />
        <CaseDetailField label="Policy version" value={policy.versions.policyVersion ?? "sin datos"} mono />
        <CaseDetailField label="Runtime version" value={policy.versions.runtimeVersion ?? "sin datos"} mono />
        <CaseDetailField label="Prompt version" value={policy.versions.promptVersion ?? "sin datos"} mono />
        <CaseDetailField label="Evaluation version" value={policy.versions.evaluationVersion ?? "sin datos"} mono />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-label-bold uppercase text-slate-500">Reglas aplicadas</p>
          {policy.appliedRuleIds.length === 0 ? (
            <div className="mt-3">
              <CaseInlineNote tone="info" title="Sin reglas" body="No hay reglas aplicadas visibles para esta observación." />
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {policy.appliedRuleIds.map((ruleId) => (
                <StatusChip key={ruleId} label={ruleId} tone="gray" />
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-label-bold uppercase text-slate-500">Hard blocks</p>
          {policy.hardBlocks.length === 0 ? (
            <div className="mt-3">
              <CaseInlineNote tone="info" title="Sin hard blocks" body="No se detectaron hard blocks visibles en esta observación." />
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {policy.hardBlocks.map((ruleId) => (
                <StatusChip key={ruleId} label={ruleId} tone="red" />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-label-bold uppercase text-slate-500">Warnings</p>
          {policy.warnings.length === 0 ? (
            <p className="mt-2 text-body-md text-slate-500">Sin warnings visibles.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-body-md text-slate-700">
              {policy.warnings.map((warning) => (
                <li key={warning} className="break-words rounded-lg bg-slate-50 px-3 py-2">
                  {warning}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-label-bold uppercase text-slate-500">Issues</p>
          {policy.issues.length === 0 ? (
            <p className="mt-2 text-body-md text-slate-500">Sin issues visibles.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-body-md text-slate-700">
              {policy.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="font-semibold text-on-surface">{issue.code}</span>
                  <span className="ml-2 text-label-sm uppercase text-slate-500">{issue.level}</span>
                  <p className="mt-1 break-words">{issue.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
