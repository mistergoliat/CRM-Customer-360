import {
  actionQueueFixture,
  analyticsFixture,
  conversationInboxFixture,
  type ConversationWorkspace,
  customerDirectoryFixture,
  type CustomerProfile,
  dashboardFixture,
  type ActionDetail,
  integrationsFixture,
  knowledgeFixture,
  type MarketingAutomation,
  type MarketingCampaign,
  marketingCampaignsFixture,
  marketingCopilotFixture,
  marketingOverviewFixture,
  marketingSegmentsFixture,
  marketingAutomationsFixture,
  type OpportunityWorkspace,
  opportunityInboxFixture,
  settingsFixture
} from "../fixtures";

export function getDashboardViewModel() {
  return dashboardFixture;
}

export function getConversationInboxViewModel() {
  return conversationInboxFixture;
}

export function getConversationWorkspaceViewModel(id: string): ConversationWorkspace {
  const workspaces = conversationInboxFixture.workspaces as Record<string, ConversationWorkspace>;
  return workspaces[id] ?? workspaces[conversationInboxFixture.selectedId];
}

export function getCustomerDirectoryViewModel() {
  return customerDirectoryFixture;
}

export function getCustomerProfileViewModel(id: string): CustomerProfile {
  const profiles = customerDirectoryFixture.profiles as Record<string, CustomerProfile>;
  return profiles[id] ?? profiles[customerDirectoryFixture.selectedId];
}

export function getOpportunityInboxViewModel() {
  return opportunityInboxFixture;
}

export function getOpportunityWorkspaceViewModel(id: string): OpportunityWorkspace {
  const workspaces = opportunityInboxFixture.workspaces as Record<string, OpportunityWorkspace>;
  return workspaces[id] ?? workspaces[opportunityInboxFixture.selectedId];
}

export function getActionQueueViewModel() {
  return actionQueueFixture;
}

export function getActionDetailViewModel(id: string): ActionDetail {
  const details = actionQueueFixture.details as Record<string, ActionDetail>;
  return details[id] ?? details[actionQueueFixture.selectedId];
}

export function getMarketingOverviewViewModel() {
  return marketingOverviewFixture;
}

export function getMarketingCopilotViewModel() {
  return marketingCopilotFixture;
}

export function getMarketingSegmentsViewModel() {
  return marketingSegmentsFixture;
}

export function getMarketingCampaignViewModel(id: string): MarketingCampaign {
  const campaigns = marketingCampaignsFixture.campaigns as Record<string, MarketingCampaign>;
  return campaigns[id] ?? marketingCampaignsFixture.newCampaign;
}

export function getMarketingAutomationViewModel(id: string): MarketingAutomation {
  const automations = marketingAutomationsFixture.automations as Record<string, MarketingAutomation>;
  return automations[id] ?? automations["demo-automation-1"];
}

export function getKnowledgeViewModel() {
  return knowledgeFixture;
}

export function getAnalyticsViewModel() {
  return analyticsFixture;
}

export function getIntegrationsViewModel() {
  return integrationsFixture;
}

export function getSettingsViewModel() {
  return settingsFixture;
}
