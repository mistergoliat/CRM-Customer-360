import React from "react";
import { CaseDetailField, CaseInlineNote } from "../CaseDetailPrimitives";
import type { CommercialShadowReviewViewModel } from "@/lib/brain/commercial/review";

function formatMetric(value: number | null) {
  if (value === null) return "no disponible";
  return String(value);
}

export function AiSdrObservability({ review }: { review: CommercialShadowReviewViewModel }) {
  void React;
  const observability = review.observability;
  const readiness = review.evaluation.status;

  return (
    <section className="grid gap-4">
      <div>
        <p className="text-headline-md text-on-surface">Observabilidad</p>
        <p className="mt-1 text-body-md text-slate-500">Diferencia explícitamente cero, desconocido y no disponible.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <CaseDetailField label="Latencia total (ms)" value={formatMetric(observability.totalLatencyMs)} />
        <CaseDetailField label="Latencia provider (ms)" value={formatMetric(observability.providerLatencyMs)} />
        <CaseDetailField label="Latencia runtime (ms)" value={formatMetric(observability.runtimeLatencyMs)} />
        <CaseDetailField label="Latencia validation (ms)" value={formatMetric(observability.validationLatencyMs)} />
        <CaseDetailField label="Input tokens" value={formatMetric(observability.inputTokens)} />
        <CaseDetailField label="Output tokens" value={formatMetric(observability.outputTokens)} />
        <CaseDetailField label="Tokens totales" value={formatMetric(observability.totalTokens)} />
        <CaseDetailField label="Costo estimado" value={formatMetric(observability.estimatedCost)} />
        <CaseDetailField label="Provider" value={observability.provider ?? "no disponible"} />
        <CaseDetailField label="Model" value={observability.model ?? "no disponible"} />
        <CaseDetailField label="Timeout" value={observability.timeout === null ? "no disponible" : observability.timeout ? "sí" : "no"} />
        <CaseDetailField label="Readiness" value={readiness ?? "no disponible"} />
      </div>

      {observability.providerFailure ? <CaseInlineNote tone="warning" title="Provider failure" body={observability.providerFailure} /> : null}
      {review.evaluation.readinessDecision ? <CaseInlineNote tone="info" title="Evaluation" body={`${review.evaluation.readinessDecision}${review.evaluation.usefulness ? ` | usefulness: ${review.evaluation.usefulness}` : ""}`} /> : null}
    </section>
  );
}
