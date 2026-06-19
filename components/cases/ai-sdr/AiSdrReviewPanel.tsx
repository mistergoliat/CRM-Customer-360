import React from "react";
import { CasePanelFrame } from "../CaseDetailPrimitives";
import type { CommercialShadowReviewViewModel } from "@/lib/brain/commercial/review";
import { AiSdrActionsSection } from "./AiSdrActionsSection";
import { AiSdrClaimsSection } from "./AiSdrClaimsSection";
import { AiSdrEmptyState } from "./AiSdrEmptyState";
import { AiSdrHumanEvaluationDraft } from "./AiSdrHumanEvaluationDraft";
import { AiSdrObservability } from "./AiSdrObservability";
import { AiSdrPolicySection } from "./AiSdrPolicySection";
import { AiSdrSideEffects } from "./AiSdrSideEffects";
import { AiSdrSummary } from "./AiSdrSummary";

export function AiSdrReviewPanel({
  caseId,
  review
}: {
  caseId: string | number;
  review: CommercialShadowReviewViewModel;
}) {
  void React;
  return (
    <CasePanelFrame
      title="AI SDR"
      description="Superficie read-only para inspeccionar la observación comercial en shadow mode."
      accent="blue"
    >
      <div className="grid gap-6">
        {review.status === "available" ? <AiSdrSummary review={review} /> : <AiSdrEmptyState review={review} />}
        <AiSdrClaimsSection review={review} />
        <AiSdrActionsSection review={review} />
        <AiSdrPolicySection review={review} />
        <AiSdrObservability review={review} />
        <AiSdrSideEffects review={review} />
        <AiSdrHumanEvaluationDraft caseId={caseId} review={review} />
      </div>
    </CasePanelFrame>
  );
}
