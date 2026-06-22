import { buildAutonomousLoopRunId } from "./constants";
import type { AutonomousCommercialLoopInput, AutonomousLoopRuntimeSnapshot } from "./types";

export const AUTONOMOUS_LOOP_FIXTURE_NOW = "2026-06-17T12:00:00.000Z";
export const AUTONOMOUS_LOOP_FIXTURE_TENANT = "tenant-autonomous-loop";
export const AUTONOMOUS_LOOP_FIXTURE_CORRELATION = "corr-autonomous-loop";
export const AUTONOMOUS_LOOP_FIXTURE_WAID = "56911111111";

function baseInput(): AutonomousCommercialLoopInput {
  return {
    now: AUTONOMOUS_LOOP_FIXTURE_NOW,
    mode: "execute_fake",
    correlationId: AUTONOMOUS_LOOP_FIXTURE_CORRELATION,
    tenantId: AUTONOMOUS_LOOP_FIXTURE_TENANT,
    inbound: {
      messageId: "msg-autonomous-loop",
      providerMessageId: "wamid-autonomous-loop",
      waId: AUTONOMOUS_LOOP_FIXTURE_WAID,
      contactName: "Cliente de prueba",
      text: "Hola, necesito el precio del servicio.",
      receivedAt: AUTONOMOUS_LOOP_FIXTURE_NOW,
      channel: "whatsapp"
    },
    caseContext: {
      caseId: 101,
      status: "open",
      lifecycleStatus: "open",
      department: "sales",
      priority: "normal",
      humanOwnerActive: false,
      aiBlocked: false,
      requiresHuman: false
    },
    commercialContext: {
      opportunityId: 202,
      opportunityKey: "opp-autonomous-loop",
      opportunityStatus: "open",
      opportunityStage: "discovery",
      opportunityStageChangedAt: null,
      lastInboundAt: AUTONOMOUS_LOOP_FIXTURE_NOW,
      lastOutboundAt: null,
      lastHumanMessageAt: null,
      lastAiMessageAt: null
    },
    configuration: {
      operationalLoopEnabled: true,
      sandboxAutonomyEnabled: true,
      autonomousReplyEnabled: true,
      whitelistedWaIds: [AUTONOMOUS_LOOP_FIXTURE_WAID],
      executionGateEnabled: true,
      outboxBridgeEnabled: true,
      outboxWorkerEnabled: true,
      messageTransportEnabled: true,
      followUpEnabled: true,
      sandboxRequired: true
    },
    scenario: {
      transportScenario: "accepted"
    }
  };
}

function createSnapshot(input: AutonomousCommercialLoopInput): AutonomousLoopRuntimeSnapshot {
  return {
    opportunities: [],
    decisions: [],
    actions: [],
    outbox: [],
    deliveryResults: [],
    followUpMutationPlans: [],
    auditEvents: [],
    processedCorrelationIds: [],
    processedProviderMessageIds: [],
    updatedAt: null
  };
}

function withOverrides(
  overrides: Partial<AutonomousCommercialLoopInput>,
  runtime?: Partial<AutonomousLoopRuntimeSnapshot>
): { input: AutonomousCommercialLoopInput; snapshot: AutonomousLoopRuntimeSnapshot } {
  const input = structuredClone(baseInput());
  deepMerge(input, overrides);
  return {
    input,
    snapshot: runtime ? deepMerge(createSnapshot(input), runtime) : createSnapshot(input)
  };
}

function deepMerge<T>(target: T, source: Partial<T>): T {
  if (source === null || source === undefined) return target;
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = (target as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      (target as Record<string, unknown>)[key] = [...value];
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      (target as Record<string, unknown>)[key] = deepMerge(
        current && typeof current === "object" ? structuredClone(current) : {},
        value as Record<string, unknown>
      );
      continue;
    }
    (target as Record<string, unknown>)[key] = value;
  }
  return target;
}

export function lowRiskPriceQuestionFixture() {
  return withOverrides({
    inbound: {
      messageId: "msg-low-risk",
      providerMessageId: "wamid-low-risk",
      waId: AUTONOMOUS_LOOP_FIXTURE_WAID,
      contactName: "Cliente de prueba",
      text: "Cual es el precio?",
      receivedAt: AUTONOMOUS_LOOP_FIXTURE_NOW,
      channel: "whatsapp"
    },
    scenario: {
      transportScenario: "accepted",
      forceActionType: "send_whatsapp_reply",
      forceRiskLevel: "low",
      forceApprovalRequirement: "none",
      forceDecision: "respond_now"
    }
  });
}

export function requestMoreContextFixture() {
  return withOverrides({
    inbound: {
      messageId: "msg-request-more-context",
      providerMessageId: "wamid-request-more-context",
      waId: AUTONOMOUS_LOOP_FIXTURE_WAID,
      contactName: "Cliente de prueba",
      text: "Necesito mas contexto para decidir.",
      receivedAt: AUTONOMOUS_LOOP_FIXTURE_NOW,
      channel: "whatsapp"
    },
    scenario: {
      transportScenario: "accepted",
      forceActionType: "request_more_context",
      forceRiskLevel: "low",
      forceApprovalRequirement: "none",
      forceDecision: "respond_now"
    }
  });
}

export function humanHandoffFixture() {
  return withOverrides({
    caseContext: {
      caseId: 101,
      status: "open",
      lifecycleStatus: "open",
      department: "sales",
      priority: "high",
      humanOwnerActive: true,
      aiBlocked: false,
      requiresHuman: true
    },
    scenario: {
      transportScenario: "accepted",
      forceDecision: "request_human",
      forceActionType: "take_over_case",
      forceRiskLevel: "low",
      forceApprovalRequirement: "operator_review"
    }
  });
}

export function complaintBlockedFixture() {
  return withOverrides({
    inbound: {
      messageId: "msg-complaint",
      providerMessageId: "wamid-complaint",
      waId: AUTONOMOUS_LOOP_FIXTURE_WAID,
      contactName: "Cliente de prueba",
      text: "Esto es una queja y no quiero mas mensajes.",
      receivedAt: AUTONOMOUS_LOOP_FIXTURE_NOW,
      channel: "whatsapp"
    },
    caseContext: {
      caseId: 101,
      status: "open",
      lifecycleStatus: "open",
      department: "sales",
      priority: "high",
      humanOwnerActive: false,
      aiBlocked: true,
      requiresHuman: false
    },
    scenario: {
      transportScenario: "accepted",
      forceDecision: "blocked",
      forceActionType: "send_whatsapp_reply",
      forceRiskLevel: "high",
      forceApprovalRequirement: "blocked"
    }
  });
}

export function customerReplyCancelsFollowUpFixture() {
  return withOverrides({
    commercialContext: {
      opportunityId: 202,
      opportunityKey: "opp-autonomous-loop",
      opportunityStatus: "open",
      opportunityStage: "qualification",
      opportunityStageChangedAt: null,
      lastInboundAt: "2026-06-17T14:00:00.000Z",
      lastOutboundAt: null,
      lastHumanMessageAt: null,
      lastAiMessageAt: null
    },
    scenario: {
      transportScenario: "accepted",
      forceDecision: "no_commercial_action",
      forceActionType: "schedule_followup",
      forceRiskLevel: "low",
      forceApprovalRequirement: "none"
    }
  });
}

export function temporaryTransportFailureFixture() {
  return withOverrides({
    scenario: {
      transportScenario: "temporary_failure",
      forceActionType: "send_whatsapp_reply",
      forceRiskLevel: "low",
      forceApprovalRequirement: "none",
      forceDecision: "respond_now"
    }
  });
}

export function rateLimitedTransportFixture() {
  return withOverrides({
    scenario: {
      transportScenario: "rate_limited",
      forceActionType: "send_whatsapp_reply",
      forceRiskLevel: "low",
      forceApprovalRequirement: "none",
      forceDecision: "respond_now"
    }
  });
}

export function permanentTransportFailureFixture() {
  return withOverrides({
    scenario: {
      transportScenario: "permanent_failure",
      forceActionType: "send_whatsapp_reply",
      forceRiskLevel: "low",
      forceApprovalRequirement: "none",
      forceDecision: "respond_now"
    }
  });
}

export function duplicateInboundFixture() {
  const fixture = withOverrides({});
  fixture.snapshot.processedCorrelationIds.push(fixture.input.correlationId);
  fixture.snapshot.processedProviderMessageIds.push(fixture.input.inbound.providerMessageId ?? fixture.input.inbound.messageId);
  return fixture;
}

export function duplicateExecutionFixture() {
  return withOverrides({
    scenario: {
      transportScenario: "duplicate_accepted",
      forceActionType: "send_whatsapp_reply",
      forceRiskLevel: "low",
      forceApprovalRequirement: "none",
      forceDecision: "respond_now"
    }
  });
}

export function closedCaseFixture() {
  return withOverrides({
    caseContext: {
      caseId: 101,
      status: "closed",
      lifecycleStatus: "closed",
      department: "sales",
      priority: "normal",
      humanOwnerActive: false,
      aiBlocked: false,
      requiresHuman: false
    }
  });
}

export function aiBlockedFixture() {
  return withOverrides({
    caseContext: {
      caseId: 101,
      status: "open",
      lifecycleStatus: "open",
      department: "sales",
      priority: "normal",
      humanOwnerActive: false,
      aiBlocked: true,
      requiresHuman: false
    }
  });
}

export function opportunityWonFixture() {
  return withOverrides({
    commercialContext: {
      opportunityId: 202,
      opportunityKey: "opp-autonomous-loop",
      opportunityStatus: "won",
      opportunityStage: "closing",
      opportunityStageChangedAt: null,
      lastInboundAt: AUTONOMOUS_LOOP_FIXTURE_NOW,
      lastOutboundAt: null,
      lastHumanMessageAt: null,
      lastAiMessageAt: null
    }
  });
}

export function buildAutonomousLoopFixtureRunId(input: AutonomousCommercialLoopInput): string {
  return buildAutonomousLoopRunId({
    tenantId: input.tenantId,
    correlationId: input.correlationId,
    messageId: input.inbound.messageId,
    now: input.now
  });
}
