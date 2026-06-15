import type { BrainContextPacks, BrainServiceContext } from "./types";

function makePack(
  agent: string,
  available: boolean,
  confidence: number,
  reason: string,
  signals: string[],
  recommendedAction: string,
  relatedCaseId: string | number | null,
  relatedOrderId: string | number | null
) {
  return {
    agent,
    available,
    confidence,
    reason,
    signals,
    recommended_action: recommendedAction,
    related_case_id: relatedCaseId,
    related_order_id: relatedOrderId
  };
}

export function buildContextPacks(input: {
  serviceContext: BrainServiceContext;
  botEligible: boolean;
  serviceSignals: string[];
  relatedCaseId: string | number | null;
  relatedOrderId: string | number | null;
  hasPostventaQueue: boolean;
  hasMaintenanceQueue: boolean;
  hasKnowledgeSignals: boolean;
  hasCampaignSignals: boolean;
}): BrainContextPacks {
  const salesAvailable = input.botEligible && (input.serviceContext.primary_service === "sales" || input.serviceSignals.includes("commerce_identity_available"));
  const sacAvailable = input.botEligible && (input.serviceContext.primary_service === "sac" || input.serviceSignals.includes("sac_case"));
  const postventaAvailable = input.botEligible && (input.serviceContext.primary_service.startsWith("postventa") || input.hasPostventaQueue || input.hasMaintenanceQueue);
  const knowledgeAvailable = input.botEligible && (input.hasKnowledgeSignals || input.serviceContext.primary_service === "knowledge" || input.serviceContext.primary_service === "unknown");
  const campaignAvailable = input.botEligible && (input.hasCampaignSignals || input.serviceContext.primary_service === "campaign");

  return {
    sales: makePack(
      "AI_AGENT_Sales",
      salesAvailable,
      salesAvailable ? 0.8 : 0.3,
      salesAvailable ? "Sales pack ready from commerce and identity signals." : "Sales pack not prioritized by current context.",
      input.serviceSignals,
      salesAvailable ? "send_to_sales" : "review_context",
      input.relatedCaseId,
      input.relatedOrderId
    ),
    sac: makePack(
      "AI_AGENT_SAC",
      sacAvailable,
      sacAvailable ? 0.82 : 0.25,
      sacAvailable ? "SAC pack ready from complaint or service signals." : "SAC pack not prioritized by current context.",
      input.serviceSignals,
      sacAvailable ? "send_to_sac" : "review_context",
      input.relatedCaseId,
      input.relatedOrderId
    ),
    postventa: makePack(
      "AI_AGENT_Postventa",
      postventaAvailable,
      postventaAvailable ? 0.84 : 0.25,
      postventaAvailable ? "Postventa pack ready from queue or service code." : "Postventa pack not prioritized by current context.",
      input.serviceSignals,
      postventaAvailable ? "send_to_postventa" : "review_context",
      input.relatedCaseId,
      input.relatedOrderId
    ),
    knowledge: makePack(
      "AI_AGENT_Knowledge",
      knowledgeAvailable,
      knowledgeAvailable ? 0.7 : 0.35,
      knowledgeAvailable ? "Knowledge pack can answer with the current context." : "Knowledge pack available only as fallback.",
      input.serviceSignals,
      knowledgeAvailable ? "send_to_knowledge" : "review_context",
      input.relatedCaseId,
      input.relatedOrderId
    ),
    campaign: makePack(
      "AI_AGENT_Campaign",
      campaignAvailable,
      campaignAvailable ? 0.65 : 0.2,
      campaignAvailable ? "Campaign pack ready from campaign-like signals." : "Campaign pack not prioritized by current context.",
      input.serviceSignals,
      campaignAvailable ? "send_to_campaign" : "review_context",
      input.relatedCaseId,
      input.relatedOrderId
    )
  };
}
