"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiSdrReviewPanel = AiSdrReviewPanel;
const react_1 = __importDefault(require("react"));
const CaseDetailPrimitives_1 = require("../CaseDetailPrimitives");
const AiSdrActionsSection_1 = require("./AiSdrActionsSection");
const AiSdrClaimsSection_1 = require("./AiSdrClaimsSection");
const AiSdrEmptyState_1 = require("./AiSdrEmptyState");
const AiSdrHumanEvaluationDraft_1 = require("./AiSdrHumanEvaluationDraft");
const AiSdrObservability_1 = require("./AiSdrObservability");
const AiSdrPolicySection_1 = require("./AiSdrPolicySection");
const AiSdrSideEffects_1 = require("./AiSdrSideEffects");
const AiSdrSummary_1 = require("./AiSdrSummary");
function AiSdrReviewPanel({ caseId, review }) {
    void react_1.default;
    return (<CaseDetailPrimitives_1.CasePanelFrame title="AI SDR" description="Superficie read-only para inspeccionar la observación comercial en shadow mode." accent="blue">
      <div className="grid gap-6">
        {review.status === "available" ? <AiSdrSummary_1.AiSdrSummary review={review}/> : <AiSdrEmptyState_1.AiSdrEmptyState review={review}/>}
        <AiSdrClaimsSection_1.AiSdrClaimsSection review={review}/>
        <AiSdrActionsSection_1.AiSdrActionsSection review={review}/>
        <AiSdrPolicySection_1.AiSdrPolicySection review={review}/>
        <AiSdrObservability_1.AiSdrObservability review={review}/>
        <AiSdrSideEffects_1.AiSdrSideEffects review={review}/>
        <AiSdrHumanEvaluationDraft_1.AiSdrHumanEvaluationDraft caseId={caseId} review={review}/>
      </div>
    </CaseDetailPrimitives_1.CasePanelFrame>);
}
