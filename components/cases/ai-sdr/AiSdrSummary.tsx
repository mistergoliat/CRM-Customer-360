import React from "react";
import { CaseDetailField, CaseInlineNote } from "../CaseDetailPrimitives";
import { StatusChip } from "@/components/ui/StatusChip";
import type { CommercialShadowReviewViewModel } from "@/lib/brain/commercial/review";

function badgeTone(value: string | null | undefined) {
  if (!value) return "gray" as const;
  const text = value.toLowerCase();
  if (text.includes("failed") || text.includes("block") || text.includes("error") || text.includes("deny")) return "red" as const;
  if (text.includes("restrict") || text.includes("review") || text.includes("warn") || text.includes("wait")) return "amber" as const;
  if (text.includes("allow") || text.includes("completed") || text.includes("ready") || text.includes("useful")) return "green" as const;
  return "gray" as const;
}

export function AiSdrSummary({ review }: { review: CommercialShadowReviewViewModel }) {
  void React;
  const summary = review.summary;
  if (!summary) {
    return <CaseInlineNote tone="info" title="Resumen no disponible" body="No se pudo construir un resumen de la observación AI SDR." />;
  }

  const proposalDiffers = summary.proposedOutcome !== null && summary.governedOutcome !== null && summary.proposedOutcome !== summary.governedOutcome;
  const failedSafe = summary.proposedOutcome === "failed_safe" || summary.governedOutcome === "failed_safe" || review.evaluation.status === "failed_safe";

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <StatusChip label={`shadow ${summary.shadowStatus ?? "unknown"}`} tone={badgeTone(summary.shadowStatus)} />
        <StatusChip label={`runtime ${summary.runtimeStatus ?? "unknown"}`} tone={badgeTone(summary.runtimeStatus)} />
        <StatusChip label={`policy ${summary.policyStatus ?? "unknown"}`} tone={badgeTone(summary.policyStatus)} />
        <StatusChip label={`evaluation ${review.evaluation.status ?? "unknown"}`} tone={badgeTone(review.evaluation.status)} />
      </div>

      {proposalDiffers ? <CaseInlineNote tone="warning" title="Policy modificó la propuesta" body="La propuesta original del Sales Agent no coincide con el resultado gobernado por Commercial Policy." /> : null}
      {failedSafe ? <CaseInlineNote tone="warning" title="failed_safe" body="La observación fue degradada a failed_safe. La propuesta no debe tratarse como confiable." /> : null}
      {summary.policyStatus === "blocked" ? <CaseInlineNote tone="warning" title="Policy bloqueó la salida" body="Commercial Policy bloqueó la respuesta o las propuestas posteriores al validator. La propuesta original permanece visible para inspección." /> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <CaseDetailField label="Outcome propuesto" value={summary.proposedOutcome ?? "sin datos"} />
        <CaseDetailField label="Outcome gobernado" value={summary.governedOutcome ?? "sin datos"} />
        <CaseDetailField label="Confidence" value={summary.proposedConfidence ?? "sin datos"} />
        <CaseDetailField label="Respuesta propuesta" value={summary.proposedResponse ?? "sin datos"} />
        <CaseDetailField label="Respuesta gobernada" value={summary.governedResponse ?? "sin datos"} />
        <CaseDetailField label="Approval requirement" value={summary.approvalRequirement ?? "sin datos"} />
        <CaseDetailField label="Risk level" value={summary.riskLevel ?? "sin datos"} />
        <CaseDetailField label="Policy decision" value={summary.overallDecision ?? "sin datos"} />
        <CaseDetailField label="Respond now" value={summary.governedShouldRespondNow === null ? "sin datos" : summary.governedShouldRespondNow ? "sí" : "no"} />
      </div>
    </section>
  );
}
