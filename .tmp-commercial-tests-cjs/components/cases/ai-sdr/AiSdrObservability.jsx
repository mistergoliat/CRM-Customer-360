"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiSdrObservability = AiSdrObservability;
const react_1 = __importDefault(require("react"));
const CaseDetailPrimitives_1 = require("../CaseDetailPrimitives");
function formatMetric(value) {
    if (value === null)
        return "no disponible";
    return String(value);
}
function AiSdrObservability({ review }) {
    void react_1.default;
    const observability = review.observability;
    const readiness = review.evaluation.status;
    return (<section className="grid gap-4">
      <div>
        <p className="text-headline-md text-on-surface">Observabilidad</p>
        <p className="mt-1 text-body-md text-slate-500">Diferencia explícitamente cero, desconocido y no disponible.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <CaseDetailPrimitives_1.CaseDetailField label="Latencia total (ms)" value={formatMetric(observability.totalLatencyMs)}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Latencia provider (ms)" value={formatMetric(observability.providerLatencyMs)}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Latencia runtime (ms)" value={formatMetric(observability.runtimeLatencyMs)}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Latencia validation (ms)" value={formatMetric(observability.validationLatencyMs)}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Input tokens" value={formatMetric(observability.inputTokens)}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Output tokens" value={formatMetric(observability.outputTokens)}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Tokens totales" value={formatMetric(observability.totalTokens)}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Costo estimado" value={formatMetric(observability.estimatedCost)}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Provider" value={observability.provider ?? "no disponible"}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Model" value={observability.model ?? "no disponible"}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Timeout" value={observability.timeout === null ? "no disponible" : observability.timeout ? "sí" : "no"}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Readiness" value={readiness ?? "no disponible"}/>
      </div>

      {observability.providerFailure ? <CaseDetailPrimitives_1.CaseInlineNote tone="warning" title="Provider failure" body={observability.providerFailure}/> : null}
      {review.evaluation.readinessDecision ? <CaseDetailPrimitives_1.CaseInlineNote tone="info" title="Evaluation" body={`${review.evaluation.readinessDecision}${review.evaluation.usefulness ? ` | usefulness: ${review.evaluation.usefulness}` : ""}`}/> : null}
    </section>);
}
