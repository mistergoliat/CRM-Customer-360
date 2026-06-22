"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiSdrSummary = AiSdrSummary;
const react_1 = __importDefault(require("react"));
const CaseDetailPrimitives_1 = require("../CaseDetailPrimitives");
const StatusChip_1 = require("@/components/ui/StatusChip");
function badgeTone(value) {
    if (!value)
        return "gray";
    const text = value.toLowerCase();
    if (text.includes("failed") || text.includes("block") || text.includes("error") || text.includes("deny"))
        return "red";
    if (text.includes("restrict") || text.includes("review") || text.includes("warn") || text.includes("wait"))
        return "amber";
    if (text.includes("allow") || text.includes("completed") || text.includes("ready") || text.includes("useful"))
        return "green";
    return "gray";
}
function AiSdrSummary({ review }) {
    void react_1.default;
    const summary = review.summary;
    if (!summary) {
        return <CaseDetailPrimitives_1.CaseInlineNote tone="info" title="Resumen no disponible" body="No se pudo construir un resumen de la observación AI SDR."/>;
    }
    const proposalDiffers = summary.proposedOutcome !== null && summary.governedOutcome !== null && summary.proposedOutcome !== summary.governedOutcome;
    const failedSafe = summary.proposedOutcome === "failed_safe" || summary.governedOutcome === "failed_safe" || review.evaluation.status === "failed_safe";
    return (<section className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <StatusChip_1.StatusChip label={`shadow ${summary.shadowStatus ?? "unknown"}`} tone={badgeTone(summary.shadowStatus)}/>
        <StatusChip_1.StatusChip label={`runtime ${summary.runtimeStatus ?? "unknown"}`} tone={badgeTone(summary.runtimeStatus)}/>
        <StatusChip_1.StatusChip label={`policy ${summary.policyStatus ?? "unknown"}`} tone={badgeTone(summary.policyStatus)}/>
        <StatusChip_1.StatusChip label={`evaluation ${review.evaluation.status ?? "unknown"}`} tone={badgeTone(review.evaluation.status)}/>
      </div>

      {proposalDiffers ? <CaseDetailPrimitives_1.CaseInlineNote tone="warning" title="Policy modificó la propuesta" body="La propuesta original del Sales Agent no coincide con el resultado gobernado por Commercial Policy."/> : null}
      {failedSafe ? <CaseDetailPrimitives_1.CaseInlineNote tone="warning" title="failed_safe" body="La observación fue degradada a failed_safe. La propuesta no debe tratarse como confiable."/> : null}
      {summary.policyStatus === "blocked" ? <CaseDetailPrimitives_1.CaseInlineNote tone="warning" title="Policy bloqueó la salida" body="Commercial Policy bloqueó la respuesta o las propuestas posteriores al validator. La propuesta original permanece visible para inspección."/> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <CaseDetailPrimitives_1.CaseDetailField label="Outcome propuesto" value={summary.proposedOutcome ?? "sin datos"}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Outcome gobernado" value={summary.governedOutcome ?? "sin datos"}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Confidence" value={summary.proposedConfidence ?? "sin datos"}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Respuesta propuesta" value={summary.proposedResponse ?? "sin datos"}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Respuesta gobernada" value={summary.governedResponse ?? "sin datos"}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Approval requirement" value={summary.approvalRequirement ?? "sin datos"}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Risk level" value={summary.riskLevel ?? "sin datos"}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Policy decision" value={summary.overallDecision ?? "sin datos"}/>
        <CaseDetailPrimitives_1.CaseDetailField label="Respond now" value={summary.governedShouldRespondNow === null ? "sin datos" : summary.governedShouldRespondNow ? "sí" : "no"}/>
      </div>
    </section>);
}
