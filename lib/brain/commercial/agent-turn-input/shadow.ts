import { buildToolDescriptions } from "../agent-loop/runAgentToolLoop";
import type { AgentLoopProviderMessage } from "../agent-loop/agentLoopProviderTypes";
import type { ConversationContinuitySignal } from "../agent-loop/conversationContinuity";
import { evaluateCapabilityIdentityGate } from "../capability-gateway/identityGate";
import { resolveCapabilityGatewayDefinition } from "../capability-gateway/registry";
import { resolveAgentCapabilityExposure } from "../agent-capability-exposure/types";
import { HARD_HANDOFF_ELIGIBLE_REASON_CODES } from "../sales-agent-runtime/dispatchSalesAgentHardHandoff";
import { buildAgentTurnInput } from "./buildAgentTurnInput";
import type {
  AgentCapabilityExposure,
  AgentCapabilityEligibilityView,
  AgentConversationContext,
  AgentExecutionPolicy,
  AgentTurnInput,
  BuildAgentTurnInputInput
} from "./types";
import type { CommercialDomainReadModel } from "../domain-read-model";
import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session/types";

export const AGENT_TURN_INPUT_SHADOW_SCHEMA_VERSION = "1" as const;

export const AGENT_TURN_INPUT_SHADOW_BUILD_STATUSES = ["BUILT", "NO_ACTIVE_WORK", "PARTIAL", "FAILED"] as const;
export type AgentTurnInputShadowBuildStatus = (typeof AGENT_TURN_INPUT_SHADOW_BUILD_STATUSES)[number];

export const AGENT_TURN_INPUT_SHADOW_CLASSIFICATIONS = [
  "OBJECTIVE_MATCH",
  "OBJECTIVE_MISMATCH",
  "NO_DURABLE_OBJECTIVE",
  "NO_ACTIVE_WORK",
  "STATE_PARTIAL"
] as const;
export type AgentTurnInputShadowClassification = (typeof AGENT_TURN_INPUT_SHADOW_CLASSIFICATIONS)[number];

export const AGENT_TURN_INPUT_SHADOW_TOOL_COMPARISONS = ["OBJECTIVE_REQUIRES_PROGRESS_BUT_NO_TOOL_USED"] as const;
export type AgentTurnInputShadowToolComparison = (typeof AGENT_TURN_INPUT_SHADOW_TOOL_COMPARISONS)[number];

/**
 * P2's deliberately small, PII-safe durable projection. The full AgentTurnInput
 * exists only in memory while the P1 builder runs and is never returned by the
 * production runtime or written to telemetry.
 */
export type AgentTurnInputShadowObservation = {
  schemaVersion: typeof AGENT_TURN_INPUT_SHADOW_SCHEMA_VERSION;
  correlationId: string | null;
  conversationId: string;
  inboundMessageId: string;
  case: {
    workId: string | null;
    workVersion: number | null;
    objectiveId: string | null;
    objectiveType: string | null;
    objectiveStatus: string | null;
  };
  state: {
    cartPresent: boolean;
    destinationStatus: string;
    shippingStatus: string;
    quoteStatus: string | null;
    quoteGrounding: string | null;
    identityLevel: string;
  };
  capabilityNames: string[];
  buildStatus: AgentTurnInputShadowBuildStatus;
  warnings: string[];
  /** Set only after the real R3 SalesTurnDisposition exists. */
  classification: AgentTurnInputShadowClassification | null;
  missingRequirements: string[];
  r3CommercialObjective: string | null;
  terminalReason: string | null;
  toolExecutionCount: number | null;
  outboxWritten: boolean | null;
  outboxId: number | null;
  toolComparison: AgentTurnInputShadowToolComparison | null;
  addedDbReads: number;
  addedHttpReads: number;
  sessionAvailable: boolean;
  sessionVersion: string | number | null;
};

export type AgentTurnInputShadowPreparation = {
  /** Internal only. Callers must discard this after the observation is built. */
  agentTurnInput: AgentTurnInput;
  observation: AgentTurnInputShadowObservation;
};

export type AgentTurnInputShadowReadMetrics = {
  dbReads: number;
  httpReads: number;
};

export type AgentTurnInputShadowRuntimeOptions = {
  enabled: boolean;
  buildDomainReadModel: () => Promise<CommercialDomainReadModel>;
  metrics?: AgentTurnInputShadowReadMetrics;
  /** Test/DI seam; production always uses the canonical P1 builder. */
  buildAgentTurnInputFn?: typeof buildAgentTurnInput;
};

export type BuildAgentTurnInputShadowInput = {
  domainReadModel: CommercialDomainReadModel;
  opportunityId: number | null;
  currentTurn: BuildAgentTurnInputInput["currentTurn"];
  conversationContext: AgentConversationContext;
  trustedCustomerSession?: NativeCustomerSessionExecutionContext | null;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
  correlationId: string | null;
  conversationId: string;
  inboundMessageId: string;
  metrics?: AgentTurnInputShadowReadMetrics;
  buildAgentTurnInputFn?: typeof buildAgentTurnInput;
  /** P6.3 pre-cognition projection; null is an explicit safe degradation. */
  capabilityEligibility?: AgentCapabilityEligibilityView | null;
  /** Whether the persistent session projection was available for this turn. */
  sessionAvailable?: boolean;
};

export type BuildAgentTurnInputShadowFailureInput = Pick<
  BuildAgentTurnInputShadowInput,
  | "correlationId"
  | "conversationId"
  | "inboundMessageId"
  | "trustedCustomerSession"
  | "humanOwnerActive"
  | "aiBlocked"
  | "metrics"
  | "sessionAvailable"
> & {
  warning: "domain_read_model_build_failed" | "agent_turn_input_build_failed" | "shadow_observation_build_failed";
};

function readMetric(metrics: AgentTurnInputShadowReadMetrics | undefined, key: keyof AgentTurnInputShadowReadMetrics): number {
  return Math.max(0, Math.trunc(metrics?.[key] ?? 0));
}

async function buildCapabilities(
  trustedCustomerSession: NativeCustomerSessionExecutionContext | null | undefined,
  opportunityId: number | null,
  conversationId: number,
  correlationId: string
): Promise<AgentCapabilityExposure[]> {
  const gatewayContext = {
    correlationId,
    conversationId,
    opportunityId,
    trustedCustomerSession: trustedCustomerSession ?? null
  };

  return Promise.all(buildToolDescriptions().map(async (description) => {
    const definition = resolveCapabilityGatewayDefinition(description.name);
    const exposure = resolveAgentCapabilityExposure(description.name);
    const identityAndAuthorityAllowed = Boolean(
      definition &&
        exposure !== "NOT_AGENT_EXPOSED" &&
        definition.governance.authority === "autonomous" &&
        evaluateCapabilityIdentityGate(description.name, definition.governance, gatewayContext).allowed
    );
    let gatewayAllowed = false;
    if (identityAndAuthorityAllowed && definition) {
      try {
        const availability = await definition.checkAvailability(gatewayContext);
        gatewayAllowed = availability.status === "available";
      } catch {
        gatewayAllowed = false;
      }
    }

    return {
      name: description.name,
      sideEffect: definition?.governance.sideEffect === "mutating",
      availability: gatewayAllowed ? "AVAILABLE" : "BLOCKED",
      useWhen: definition?.useWhen ?? "",
      preconditions: [...(definition?.evidenceRequired ?? [])]
    };
  }));
}

function buildExecutionPolicy(
  capabilities: readonly AgentCapabilityExposure[],
  trustedCustomerSession: NativeCustomerSessionExecutionContext | null | undefined,
  humanOwnerActive: boolean,
  aiBlocked: boolean
): AgentExecutionPolicy {
  return {
    identityLevel: trustedCustomerSession?.runtimeIdentity.identityLevel ?? "LEVEL_0_ANONYMOUS",
    humanOwner: humanOwnerActive,
    aiBlocked,
    // Descriptive surface only. Capability Gateway remains the sole
    // authorization boundary; this list is never sent to or trusted by the
    // provider because P2 is shadow-only.
    allowedSensitiveActions: capabilities
      .filter((capability) => capability.sideEffect && capability.availability === "AVAILABLE")
      .map((capability) => capability.name),
    handoff: { allowedReasons: [...HARD_HANDOFF_ELIGIBLE_REASON_CODES] }
  };
}

function legacyRecentMessages(summary: Record<string, unknown>): AgentConversationContext["recentMessages"] {
  const recentMessages = summary.recentMessages;
  if (!Array.isArray(recentMessages)) return [];
  return recentMessages.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const value = message as { direction?: unknown; body?: unknown };
    if ((value.direction !== "inbound" && value.direction !== "outbound") || typeof value.body !== "string") return [];
    return [{ role: value.direction === "inbound" ? "user" : "assistant", text: value.body, occurredAt: null }];
  });
}

export function buildAgentTurnInputShadowConversationContext(input: {
  legacySummary: Record<string, unknown>;
  historicalMessages: readonly AgentLoopProviderMessage[] | null;
  continuity: ConversationContinuitySignal;
}): AgentConversationContext {
  const recentMessages = input.historicalMessages
    ? input.historicalMessages.flatMap((message) => {
        if (message.role !== "user" && message.role !== "assistant") return [];
        return [{ role: message.role, text: message.content, occurredAt: null }];
      })
    : legacyRecentMessages(input.legacySummary);

  return {
    compactSummary: null,
    recentMessages,
    sessionVersion: null,
    continuity: {
      isFirstConversationalTurn: input.continuity.isFirstConversationalTurn,
      hasPriorAssistantMessages: input.continuity.hasPriorAssistantMessages,
      hasPriorCustomerMessages: input.continuity.hasPriorCustomerMessages
    }
  };
}

function isStatePartial(readModel: CommercialDomainReadModel): boolean {
  const freshnessStates = [
    readModel.case.freshness.state,
    readModel.cart.freshness.state,
    readModel.destination?.freshness.state,
    readModel.shipping.freshness.state,
    readModel.quote?.freshness.state
  ];
  const profileUnavailable = readModel.customer.profile?.status === "UNAVAILABLE" || readModel.customer.profile?.status === "UNKNOWN";
  return freshnessStates.some((state) => state === "UNKNOWN" || state === "STALE" || state === "SUPERSEDED" || state === "HISTORICAL") || readModel.shipping.state !== "CURRENT" || profileUnavailable;
}

function buildObservation(input: BuildAgentTurnInputShadowInput, buildStatus: AgentTurnInputShadowBuildStatus, warnings: readonly string[]): AgentTurnInputShadowObservation {
  const readModel = input.domainReadModel;
  const objective = readModel.objective;
  const workReadFailed = readModel.case.freshness.reason === "commercial_work_read_failed";
  const noActiveWork = readModel.case.workId === null && readModel.case.status === "NOT_CREATED" && !workReadFailed;
  const statePartial = !noActiveWork && isStatePartial(readModel);
  const normalizedWarnings = [...new Set(warnings)];

  if (noActiveWork) normalizedWarnings.push("no_active_work");
  if (workReadFailed) normalizedWarnings.push("commercial_work_read_failed");
  if (statePartial) normalizedWarnings.push("state_partial");
  if (readModel.customer.profile?.status === "UNAVAILABLE" || readModel.customer.profile?.status === "UNKNOWN") {
    normalizedWarnings.push("customer_profile_unavailable");
  }
  if (readModel.quote && readModel.quote.grounding === "UNKNOWN") normalizedWarnings.push("quote_service_unknown");

  return {
    schemaVersion: AGENT_TURN_INPUT_SHADOW_SCHEMA_VERSION,
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    inboundMessageId: input.inboundMessageId,
    case: {
      workId: readModel.case.workId,
      workVersion: readModel.case.workVersion,
      objectiveId: objective?.objectiveId ?? null,
      objectiveType: objective?.type ?? null,
      objectiveStatus: objective?.status ?? null
    },
    state: {
      cartPresent: readModel.cart.factId !== null || readModel.cart.items.length > 0,
      destinationStatus: readModel.destination?.freshness.state ?? "MISSING",
      shippingStatus: readModel.shipping.state,
      quoteStatus: readModel.quote?.status ?? null,
      quoteGrounding: readModel.quote?.grounding ?? null,
      identityLevel: readModel.customer.identityLevel ?? "UNKNOWN"
    },
    capabilityNames: buildToolDescriptions().map((description) => description.name),
    buildStatus,
    warnings: [...new Set(normalizedWarnings)],
    classification: noActiveWork ? "NO_ACTIVE_WORK" : objective ? null : buildStatus === "PARTIAL" ? "STATE_PARTIAL" : "NO_DURABLE_OBJECTIVE",
    missingRequirements: objective ? [...objective.missingRequirements] : [],
    r3CommercialObjective: null,
    terminalReason: null,
    toolExecutionCount: null,
    outboxWritten: null,
    outboxId: null,
    toolComparison: null,
    addedDbReads: readMetric(input.metrics, "dbReads"),
    addedHttpReads: readMetric(input.metrics, "httpReads"),
    sessionAvailable: input.sessionAvailable ?? (input.conversationContext.sessionVersion !== null || input.conversationContext.recentMessages.length > 0),
    sessionVersion: input.conversationContext.sessionVersion
  };
}

export function buildFailedAgentTurnInputShadowObservation(input: BuildAgentTurnInputShadowFailureInput): AgentTurnInputShadowObservation {
  const capabilities = buildToolDescriptions().map((description) => description.name);
  return {
    schemaVersion: AGENT_TURN_INPUT_SHADOW_SCHEMA_VERSION,
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    inboundMessageId: input.inboundMessageId,
    case: { workId: null, workVersion: null, objectiveId: null, objectiveType: null, objectiveStatus: null },
    state: {
      cartPresent: false,
      destinationStatus: "UNKNOWN",
      shippingStatus: "UNKNOWN",
      quoteStatus: null,
      quoteGrounding: null,
      identityLevel: input.trustedCustomerSession?.runtimeIdentity.identityLevel ?? "LEVEL_0_ANONYMOUS"
    },
    capabilityNames: capabilities,
    buildStatus: "FAILED",
    warnings: [input.warning],
    classification: null,
    missingRequirements: [],
    r3CommercialObjective: null,
    terminalReason: null,
    toolExecutionCount: null,
    outboxWritten: null,
    outboxId: null,
    toolComparison: null,
    addedDbReads: readMetric(input.metrics, "dbReads"),
    addedHttpReads: readMetric(input.metrics, "httpReads"),
    sessionAvailable: input.sessionAvailable ?? false,
    sessionVersion: null
  };
}

export async function buildAgentTurnInputShadow(input: BuildAgentTurnInputShadowInput): Promise<AgentTurnInputShadowPreparation> {
  const capabilities = await buildCapabilities(input.trustedCustomerSession, input.opportunityId, Number(input.conversationId), input.correlationId ?? "shadow");
  const executionPolicy = buildExecutionPolicy(capabilities, input.trustedCustomerSession, input.humanOwnerActive, input.aiBlocked);
  const builder = input.buildAgentTurnInputFn ?? buildAgentTurnInput;
  const agentTurnInput = builder({
    domainReadModel: input.domainReadModel,
    currentTurn: input.currentTurn,
    conversationContext: input.conversationContext,
    capabilities,
    executionPolicy,
    capabilityEligibility: input.capabilityEligibility
  });
  const hasActiveWork = input.domainReadModel.case.workId !== null;
  const workReadFailed = input.domainReadModel.case.freshness.reason === "commercial_work_read_failed";
  const noActiveWork = !hasActiveWork && input.domainReadModel.case.status === "NOT_CREATED" && !workReadFailed;
  const statePartial = !noActiveWork && isStatePartial(input.domainReadModel);
  const buildStatus: AgentTurnInputShadowBuildStatus = noActiveWork
    ? "NO_ACTIVE_WORK"
    : workReadFailed || statePartial
      ? "PARTIAL"
      : hasActiveWork
        ? "BUILT"
        : "PARTIAL";
  return { agentTurnInput, observation: buildObservation(input, buildStatus, []) };
}

function normalizeObjectiveType(value: string): string {
  const normalized = value.trim().toUpperCase();
  const aliases: Record<string, string> = {
    DISCOVER_NEED: "discover_need",
    QUALIFY: "qualify",
    RECOMMEND: "recommend",
    RECOMMEND_PRODUCTS: "recommend",
    COMPARE: "compare",
    HANDLE_OBJECTION: "handle_objection",
    CREATE_QUOTE: "prepare_quote",
    PREPARE_QUOTE: "prepare_quote",
    ADVANCE_PURCHASE: "advance_purchase",
    RETAIN_INTEREST: "retain_interest",
    HANDOFF: "handoff",
    NONE: "none"
  };
  return aliases[normalized] ?? value.trim().toLowerCase();
}

export function finalizeAgentTurnInputShadowObservation(input: {
  observation: AgentTurnInputShadowObservation;
  r3CommercialObjective: string | null;
  terminalReason: string | null;
  toolExecutionCount: number;
  outboxWritten: boolean;
  outboxId: number | null;
}): AgentTurnInputShadowObservation {
  const observation = input.observation;
  const failed = observation.buildStatus === "FAILED";
  const noActiveWork = !failed && observation.buildStatus === "NO_ACTIVE_WORK" && observation.warnings.includes("no_active_work");
  const hasActiveWork = observation.case.workId !== null;
  const hasObjective = observation.case.objectiveType !== null;
  let classification: AgentTurnInputShadowClassification | null = null;
  if (failed) classification = null;
  else if (noActiveWork) classification = "NO_ACTIVE_WORK";
  else if (!hasActiveWork && observation.buildStatus === "PARTIAL") classification = "STATE_PARTIAL";
  else if (!hasObjective) classification = "NO_DURABLE_OBJECTIVE";
  else if (input.r3CommercialObjective !== null) {
    classification = normalizeObjectiveType(observation.case.objectiveType!) === normalizeObjectiveType(input.r3CommercialObjective)
      ? "OBJECTIVE_MATCH"
      : "OBJECTIVE_MISMATCH";
  } else if (observation.buildStatus === "PARTIAL") {
    classification = "STATE_PARTIAL";
  }

  const toolComparison = hasObjective && observation.missingRequirements.length > 0 && input.toolExecutionCount === 0
    ? "OBJECTIVE_REQUIRES_PROGRESS_BUT_NO_TOOL_USED"
    : null;

  return {
    ...observation,
    classification,
    r3CommercialObjective: input.r3CommercialObjective,
    terminalReason: input.terminalReason,
    toolExecutionCount: input.toolExecutionCount,
    outboxWritten: input.outboxWritten,
    outboxId: input.outboxId,
    toolComparison
  };
}
