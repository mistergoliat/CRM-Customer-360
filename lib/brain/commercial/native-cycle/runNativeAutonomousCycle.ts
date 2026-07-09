import { createCustomer360QueryService } from "@/lib/domains/customer-360";
import { normalizePhoneChile } from "@/lib/customer-identity/normalize";
import { buildNativeCommercialContext } from "../context/buildNativeCommercialContext";
import { loadAutonomousCustomerContext } from "../context/loadAutonomousCustomerContext";
import type { AutonomousCustomerContextLoadResult, AutonomousCustomerContextLoadState, LoadCustomer360Fn } from "../context/loadAutonomousCustomerContext";
import { resolveNativeCustomerSession } from "./customer-session";
import type { CustomerSessionDecisionContext, ResolveNativeCustomerSessionDependencies } from "./customer-session";
import { runCommercialShadowEvaluation } from "../shadow/runCommercialShadowEvaluation";
import { runCommercialOperationalLoop } from "../operational-loop";
import { runCommercialExecutionBridge } from "../execution-bridge";
import { evaluateCommercialShadowResult } from "../evaluation";
import { SALES_AGENT_CONTRACT_VERSION, SALES_AGENT_PROMPT_VERSION } from "../sales-agent/runtimeTypes";
import { COMMERCIAL_POLICY_VERSION } from "../policy/policyConstants";
import {
  buildCommercialShadowFeatureFlags,
  buildCommercialLoopFeatureFlags,
  buildCommercialBridgeFeatureFlags,
  buildCommercialCyclePolicyFlags,
  buildCommercialCycleTimeouts,
  buildCommercialSalesAgentDryRun,
  readEnvFlag
} from "../config/commercialCycleConfig";
import { buildNativeBrainContextShim } from "./buildNativeBrainContextShim";
import { isMultiRequestRuntimeEnabled, runMultiRequestAutonomousCycle } from "../multi-request";
import type { MultiRequestCycleResult } from "../multi-request";
import type { CommercialShadowResult } from "../shadow";
import type { CommercialOperationalLoopResult } from "../operational-loop";
import type { CommercialExecutionBridgeResult } from "../execution-bridge";
import type { BrainContextResolveResponse } from "../../context/types";
import { runCapabilityExecutionStage } from "./runCapabilityExecutionStage";
import { buildCatalogGroundedMessage } from "./buildCatalogGroundedMessage";
import type { CatalogGroundingResult } from "./buildCatalogGroundedMessage";
import { applyCatalogGroundingToNextAction } from "./applyCatalogGroundingToNextAction";
import { listAliasedSalesAgentToolNames } from "../capability-gateway/toolAliases";
import type { SalesAgentProvider } from "../sales-agent/runtimeTypes";

/**
 * Capabilities the native cycle's sales agent is allowed to request this
 * turn. Derived from the single centralized alias table (never a hardcoded
 * list here): only LLM tool names backed by a registered Capability Gateway
 * capability are advertised - advertising a tool the backend cannot execute
 * would let policy keep a request nothing ever fulfills.
 */
const NATIVE_CYCLE_ALLOWED_CAPABILITIES = listAliasedSalesAgentToolNames();

// ACS-R1-04-T05: shared, lazily-created Customer 360 query service - same
// cached-singleton pattern as getSharedCatalogPort in capability-gateway/registry.ts.
let cachedCustomer360Service: ReturnType<typeof createCustomer360QueryService> | null = null;
const defaultLoadCustomer360: LoadCustomer360Fn = (customerId) => {
  if (!cachedCustomer360Service) cachedCustomer360Service = createCustomer360QueryService();
  return cachedCustomer360Service.loadByCustomerId(customerId);
};

export type NativeAutonomousCycleInput = {
  conversationId: number;
  conversationPublicId: string;
  customerMasterId: number | null;
  waId: string;
  phoneNumberId: string;
  messageId: string | number | null;
  messageText: string;
  correlationId: string;
  currentTime: string;
  abortSignal?: AbortSignal | null;
  /** Test-only injection point; production callers never set this (defaults to the configured runtime provider). */
  provider?: SalesAgentProvider | null;
  /** Test-only injection point; production callers never set this (defaults to the real Customer 360 query service). */
  loadCustomer360?: LoadCustomer360Fn | null;
  /** Test-only injection point; production callers never set this (defaults to the real identity/onboarding/Gateway services). */
  customerSessionDependencies?: ResolveNativeCustomerSessionDependencies | null;
};

export type NativeAutonomousCycleResult = {
  ran: boolean;
  reason?: string;
  shadow: CommercialShadowResult | null;
  loop: CommercialOperationalLoopResult | null;
  bridge: CommercialExecutionBridgeResult | null;
  multiRequest?: MultiRequestCycleResult | null;
  catalogCapability?: CatalogGroundingResult | null;
  /** ACS-R1-04-T05: state of the single Customer 360 load for this turn ("not_requested" when there was no customerMasterId to load). */
  customerContextState?: AutonomousCustomerContextLoadState;
  /** ACS-R1-04-T06: the minimized decision context handed to whichever runtime ran this turn. */
  customerSession?: CustomerSessionDecisionContext;
  warnings: string[];
};

function parseEnvCsv(name: string, fallback: string[] = []): string[] {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function isAutonomyCycleEnabled(): boolean {
  return (
    readEnvFlag("BRAIN_SALES_AGENT_ENABLED", false) ||
    readEnvFlag("BRAIN_COMMERCIAL_SHADOW_ENABLED", false) ||
    readEnvFlag("BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED", false)
  );
}

function dedupeWarnings(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Shared application service: runs the full autonomous commercial cycle from
 * native WhatsApp inbound context without going through the legacy n8n
 * processInbound path. Called from processNativeWhatsAppInbound after the
 * inbound message is persisted.
 *
 * Both paths share:
 * - buildNativeCommercialContext (context source)
 * - runCommercialShadowEvaluation (LLM + policy)
 * - runCommercialOperationalLoop (decision)
 * - runCommercialExecutionBridge (action persistence + outbox)
 *
 * No logic is duplicated — the native shim adapts the context shape to what
 * the existing pipeline expects, without copying any of its internals.
 */
export async function runNativeAutonomousCycle(
  input: NativeAutonomousCycleInput
): Promise<NativeAutonomousCycleResult> {
  // Step 1: which runtime, if any, is enabled this turn. Multi-request is
  // authoritative when on - the legacy pipeline below never runs the same
  // turn (checked first, same priority as before ACS-R1-04-T05).
  const multiRequestEnabled = isMultiRequestRuntimeEnabled();

  if (!multiRequestEnabled) {
    if (!isAutonomyCycleEnabled()) {
      // Step 2: nothing will run this turn - Customer 360 is never loaded.
      return { ran: false, reason: "autonomous_cycle_disabled", shadow: null, loop: null, bridge: null, catalogCapability: null, warnings: [] };
    }
    if (!buildCommercialShadowFeatureFlags().commercialShadowEnabled) {
      // Step 2: legacy is gated off too - Customer 360 is never loaded.
      return { ran: false, reason: "shadow_disabled", shadow: null, loop: null, bridge: null, catalogCapability: null, warnings: [] };
    }
  }

  // Step 3 (ACS-R1-04-T06): resolve the customer session once - local
  // identity resolution, onboarding load/reconciliation, at-most-one
  // external resolve_customer call, this-turn consent, and the Customer 360
  // access gate. Uses only input.customerMasterId (the pre-existing native
  // resolver's conversation.customer_id) as a reconciliation signal, never
  // as authoritative identity - see resolveNativeCustomerSession.
  const normalizedPhone = normalizePhoneChile(input.waId) ?? input.waId;
  const session = await resolveNativeCustomerSession({
    conversationId: String(input.conversationId),
    opportunityId: null,
    trustedInbound: {
      channel: "whatsapp",
      externalId: input.waId,
      normalizedPhone,
      messageId: String(input.messageId ?? input.correlationId),
      receivedAt: input.currentTime
    },
    messageText: input.messageText,
    correlationId: input.correlationId,
    priorConversationCustomerId: input.customerMasterId === null || input.customerMasterId === undefined ? null : String(input.customerMasterId),
    dependencies: input.customerSessionDependencies ?? undefined
  });

  // Step 3 continued (ACS-R1-04-T05, gated): Customer 360 loads at most once
  // per turn, using the customerId only when contextAccess authorizes it -
  // never simply because a customer was identified (task section 11).
  const loadCustomer360 = input.loadCustomer360 ?? defaultLoadCustomer360;
  const customerId = session.execution.contextAccess === "none" ? null : session.execution.identity.customerId;
  const customer360: AutonomousCustomerContextLoadResult = await loadAutonomousCustomerContext({ customerId, loadCustomer360 });

  // Step 4/5: select exactly one runtime and hand it the reduced projections.
  if (multiRequestEnabled) {
    const multiRequest = await runMultiRequestAutonomousCycle({
      conversationId: input.conversationId,
      inboundMessageId: input.messageId === null || input.messageId === undefined ? "" : String(input.messageId),
      messageText: input.messageText,
      correlationId: input.correlationId,
      customerContext: customer360.context,
      customerContextState: customer360.state,
      customerSession: session.decision
    });
    return {
      ran: multiRequest.ran,
      reason: multiRequest.reason ?? "multi_request_runtime",
      shadow: null,
      loop: null,
      bridge: null,
      multiRequest,
      catalogCapability: null,
      customerContextState: customer360.state,
      customerSession: session.decision,
      // Step 6: structured Customer 360 + session warnings, merged with the runtime's own.
      warnings: dedupeWarnings([...multiRequest.warnings, ...customer360.warnings, ...session.warnings])
    };
  }

  const shadowFlags = buildCommercialShadowFeatureFlags();
  const loopFlags = buildCommercialLoopFeatureFlags();
  const bridgeFlags = buildCommercialBridgeFeatureFlags();

  const warnings: string[] = [...customer360.warnings, ...session.warnings];
  const startedAt = Date.now();
  const currentTime = input.currentTime;

  // Fase 1: build native commercial context. Never loads Customer 360 itself
  // - the already-loaded projection is merged in right after.
  const rawSnapshot = await buildNativeCommercialContext({
    conversationPublicId: input.conversationPublicId,
    currentTime
  });
  const snapshot = { ...rawSnapshot, customer360: customer360.context, customer360State: customer360.state, customerSession: session.decision };

  if (snapshot.status === "not_found") {
    return {
      ran: false,
      reason: "conversation_not_found",
      shadow: null,
      loop: null,
      bridge: null,
      catalogCapability: null,
      customerContextState: customer360.state,
      customerSession: session.decision,
      warnings: dedupeWarnings(warnings)
    };
  }

  // Build shim objects that the legacy pipeline can consume via its
  // normalizeCommercialBrainContext / normalizeCommercialInboundMessage adapters
  const brainContextShim = buildNativeBrainContextShim(
    snapshot,
    input.messageText,
    input.waId,
    input.phoneNumberId,
    input.conversationId,
    currentTime
  );

  const inboundMessageShim = {
    channel: "whatsapp" as const,
    source: "n8n_meta_webhook" as const,
    contextMode: "native" as const,
    waId: input.waId,
    phoneNumberId: input.phoneNumberId,
    messageId: String(input.messageId ?? input.correlationId),
    messageText: input.messageText,
    conversationCaseId: input.conversationId,
    options: {
      dryRun: false,
      executeActions: false,
      returnInstructionsForN8n: false,
      debug: false
    },
    receivedAt: currentTime,
    metadata: {
      correlationId: input.correlationId,
      conversationPublicId: input.conversationPublicId,
      customerMasterId: input.customerMasterId,
      source: "native_autonomous_cycle"
    }
  };

  const salesAgentDryRun = buildCommercialSalesAgentDryRun();
  const { shadowTimeoutMs, contextTimeoutMs, runtimeTimeoutMs, policyTimeoutMs } = buildCommercialCycleTimeouts();

  // Fase 2: run shadow evaluation (LLM + policy)
  let shadow: CommercialShadowResult | null = null;
  try {
    shadow = await runCommercialShadowEvaluation({
      inboundMessage: inboundMessageShim as never,
      brainContext: brainContextShim as unknown as BrainContextResolveResponse,
      correlationId: input.correlationId,
      currentTime,
      timezone: "UTC",
      requestedMode: "standard",
      options: { timeoutMs: shadowTimeoutMs, contextTimeoutMs, runtimeTimeoutMs, policyTimeoutMs },
      provider: input.provider ?? null,
      runtimeOptions: {
        enabled: true,
        mode: salesAgentDryRun ? "dry_run" : "live",
        timeoutMs: runtimeTimeoutMs,
        maxInputCharacters: 20000,
        maxOutputCharacters: 12000,
        strictValidation: true,
        allowedCapabilities: NATIVE_CYCLE_ALLOWED_CAPABILITIES,
        captureRawOutput: false,
        includePromptPreview: false,
        dryRun: salesAgentDryRun,
        abortSignal: input.abortSignal ?? null
      },
      policyFlags: buildCommercialCyclePolicyFlags(shadowFlags.commercialPolicyEnabled),
      shadowFlags,
      contractVersion: SALES_AGENT_CONTRACT_VERSION,
      promptVersion: SALES_AGENT_PROMPT_VERSION,
      policyVersion: COMMERCIAL_POLICY_VERSION,
      allowedCapabilities: NATIVE_CYCLE_ALLOWED_CAPABILITIES,
      metadata: inboundMessageShim.metadata,
      abortSignal: input.abortSignal ?? null
    });
  } catch (error) {
    warnings.push(`shadow_failed: ${error instanceof Error ? error.message : "unknown"}`);
  }

  // Fase 3: operational loop (decision)
  let loop: CommercialOperationalLoopResult | null = null;
  if (shadow && loopFlags.commercialOperationalLoopEnabled) {
    try {
      const evaluation = evaluateCommercialShadowResult({
        sampleId: input.correlationId,
        timestamp: currentTime,
        scenario: "native_autonomous_cycle",
        expectedTags: [],
        shadowResult: shadow,
        metadata: inboundMessageShim.metadata,
        currentTime
      });

      loop = await runCommercialOperationalLoop({
        inboundMessage: inboundMessageShim as never,
        brainContext: brainContextShim as unknown as BrainContextResolveResponse,
        commercialContext: shadow.context?.commercialContext ?? null,
        salesAgentResult: shadow.context?.runtimeResult?.result ?? null,
        commercialPolicyResult: shadow.context?.policyResult ?? null,
        commercialEvaluationResult: evaluation,
        commercialShadowResult: shadow,
        currentTime,
        correlationId: input.correlationId,
        processInboundRunId: String(input.messageId ?? input.correlationId),
        salesAgentRunId: shadow.context?.runtimeResult?.result?.runId ?? null,
        featureFlags: loopFlags,
        mode: "shadow",
        contractVersion: shadow.versions.contractVersion ?? null,
        policyVersion: shadow.versions.policyVersion ?? null,
        runtimeVersion: shadow.versions.runtimeVersion ?? null,
        promptVersion: shadow.versions.promptVersion ?? null,
        evaluationVersion: evaluation.versionInfo.evaluationVersion,
        metadata: { correlationId: input.correlationId, source: "native_autonomous_cycle" },
        abortSignal: null,
        clock: undefined
      });
    } catch (error) {
      warnings.push(`loop_failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  // Fase 3.5: Capability Gateway - generic execution stage runs whatever
  // tool requests survived policy (today: search_products via the
  // searchProducts alias), then the catalog-specific projector grounds the
  // loop's draft message in that verified data (never the LLM's own
  // unverified claim). Runs after the loop so opportunityId is known.
  let catalogCapability: CatalogGroundingResult | null = null;
  let groundedLoop = loop;
  if (loop) {
    try {
      const opportunityId = loop.resultingState?.opportunityId ?? null;
      const stage = await runCapabilityExecutionStage({
        shadow,
        conversationId: input.conversationId,
        opportunityId,
        correlationId: input.correlationId,
        trustedCustomerSession: session.execution
      });
      catalogCapability = await buildCatalogGroundedMessage(stage.executions, {
        correlationId: input.correlationId,
        conversationId: input.conversationId,
        opportunityId: typeof opportunityId === "number" ? opportunityId : null
      });
      groundedLoop = applyCatalogGroundingToNextAction(loop, catalogCapability);
    } catch (error) {
      warnings.push(`catalog_capability_failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  // Fase 4: execution bridge (action queue + outbox)
  let bridge: CommercialExecutionBridgeResult | null = null;
  if (groundedLoop && bridgeFlags.actionQueueEnabled) {
    try {
      bridge = await runCommercialExecutionBridge({
        operationalLoopResult: groundedLoop,
        currentTime,
        timezone: "UTC",
        featureFlags: bridgeFlags,
        sandboxWaIds: parseEnvCsv("BRAIN_AUTONOMOUS_TEST_WA_IDS"),
        allowedActionTypes: parseEnvCsv("BRAIN_AUTONOMOUS_ALLOWED_ACTION_TYPES", ["send_whatsapp_reply", "request_more_context"]),
        maxRiskLevel: process.env.BRAIN_AUTONOMOUS_MAX_RISK_LEVEL?.trim() || "low"
      });
    } catch (error) {
      warnings.push(`bridge_failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  return {
    ran: true,
    shadow,
    loop: groundedLoop,
    bridge,
    catalogCapability,
    customerContextState: customer360.state,
    customerSession: session.decision,
    warnings: dedupeWarnings(warnings)
  };
}
