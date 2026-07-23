import { createCustomer360QueryService } from "@/lib/domains/customer-360";
import { normalizePhoneChile } from "@/lib/customer-identity/normalize";
import { buildNativeCommercialContext } from "../context/buildNativeCommercialContext";
import { loadAutonomousCustomerContext } from "../context/loadAutonomousCustomerContext";
import type { AutonomousCustomerContextLoadResult, AutonomousCustomerContextLoadState, LoadCustomer360Fn } from "../context/loadAutonomousCustomerContext";
import { resolveNativeCustomerSession, runCustomerOnboardingPostPlanStage } from "./customer-session";
import type { CustomerSessionDecisionContext, ResolveNativeCustomerSessionDependencies } from "./customer-session";
import { applyOnboardingGroundingToNextAction } from "./applyOnboardingGroundingToNextAction";
import { runCommercialShadowEvaluation } from "../shadow/runCommercialShadowEvaluation";
import { runCommercialOperationalLoop } from "../operational-loop";
import { runCommercialExecutionBridge } from "../execution-bridge";
import { evaluateCommercialShadowResult } from "../evaluation";
import { SALES_AGENT_CONTRACT_VERSION, SALES_AGENT_PROMPT_VERSION } from "../sales-agent/runtimeTypes";
import { COMMERCIAL_POLICY_VERSION } from "../policy/policyConstants";
import {
  buildAgentToolLoopFeatureFlags,
  buildCommercialShadowFeatureFlags,
  buildCommercialLoopFeatureFlags,
  buildCommercialBridgeFeatureFlags,
  buildCommercialCyclePolicyFlags,
  buildCommercialCycleTimeouts,
  buildCommercialSalesAgentDryRun,
  readEnvFlag
} from "../config/commercialCycleConfig";
import { runNativeAgentToolLoopCycle, runNativeAgentToolLoopCycleConfigurationFailure } from "../agent-loop";
import type { NativeAgentToolLoopCycleResult } from "../agent-loop";
import { createHttpAgentLoopProvider } from "../agent-loop/providers/httpAgentLoopProvider";
import type { AgentLoopProvider } from "../agent-loop/agentLoopProviderTypes";
import { buildNativeBrainContextShim } from "./buildNativeBrainContextShim";
import { loadAutonomousPilotAllowlist, isWaIdAuthorizedForPilot } from "@/lib/brain/runtime/autonomousRuntimeConfig";
import { detectExplicitOptOutCommand, isCustomerOptedOut, recordCustomerOptOut } from "../optOutStore";
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
import { resolveSalesAgentConfiguration } from "../sales-agent-configuration";
import type { ResolvedSalesAgentConfiguration } from "../sales-agent-configuration";

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
  /** Test-only injection point for the agent-loop path (ACS-R1-05.1-T02.1); production callers never set this (defaults to the real HTTP provider). */
  agentLoopProvider?: AgentLoopProvider | null;
};

/** ACS-R1-05-T06.2 (C2): the commercial need for this turn, read from already-loaded, persisted sources - never re-derived from free text, never invented. */
export type NativeAutonomousCycleCommercialNeed = {
  productQuery: string | null;
  usage: string | null;
  budgetMax: number | null;
  currency: string | null;
};

export type NativeAutonomousCycleResult = {
  ran: boolean;
  reason?: string;
  shadow: CommercialShadowResult | null;
  loop: CommercialOperationalLoopResult | null;
  bridge: CommercialExecutionBridgeResult | null;
  multiRequest?: MultiRequestCycleResult | null;
  /** ACS-R1-05.1-T02.1: set only when BRAIN_AGENT_TOOL_LOOP_ENABLED is on for this turn - mutually exclusive with shadow/loop/bridge. */
  agentLoop?: NativeAgentToolLoopCycleResult | null;
  catalogCapability?: CatalogGroundingResult | null;
  /** ACS-R1-04-T05: state of the single Customer 360 load for this turn ("not_requested" when there was no customerMasterId to load). */
  customerContextState?: AutonomousCustomerContextLoadState;
  /** ACS-R1-04-T06: the minimized decision context handed to whichever runtime ran this turn. */
  customerSession?: CustomerSessionDecisionContext;
  /** ACS-R1-05-T06.2: null only when the legacy runtime never reached the point where a commercial need could be read (e.g. conversation_not_found, multi-request runtime). */
  commercialNeed?: NativeAutonomousCycleCommercialNeed | null;
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
  // Step 0 (ACS-R1-05-T06.1, P1-5 pilot isolation): when BRAIN_AUTONOMOUS_TEST_WA_IDS
  // is configured, a wa_id outside it gets zero autonomous side effects - no
  // LLM call, no Customer 360 load, no resolveNativeCustomerSession (which can
  // call the external Customer Service), no decision/action persistence, no
  // outbox write. Checked before anything else, for both the legacy and
  // multi-request runtimes below - an empty allowlist means no restriction is
  // configured and every existing caller keeps its current behavior.
  const pilotAllowlist = loadAutonomousPilotAllowlist();
  if (!isWaIdAuthorizedForPilot(input.waId, pilotAllowlist)) {
    return { ran: false, reason: "wa_id_not_authorized_for_pilot", shadow: null, loop: null, bridge: null, catalogCapability: null, commercialNeed: null, warnings: [] };
  }

  // Step 0.5 (ACS-R1-05.1-T02.3D, decision 11): a customer who has
  // explicitly opted out never gets another autonomous message this turn -
  // no LLM call, no Customer 360 load, no decision/action persistence, no
  // outbox write. Same "checked before anything else" placement as Step 0.
  // An opt-out already on record short-circuits immediately; otherwise this
  // turn's own inbound text is checked for an explicit, unambiguous opt-out
  // command (never a fuzzy/keyword match on ordinary objections like "no" -
  // see optOutStore.ts) and recorded before this turn is gated the same way.
  if (await isCustomerOptedOut(input.waId)) {
    return { ran: false, reason: "customer_opted_out", shadow: null, loop: null, bridge: null, catalogCapability: null, commercialNeed: null, warnings: [] };
  }
  if (detectExplicitOptOutCommand(input.messageText)) {
    await recordCustomerOptOut({
      waId: input.waId,
      reason: "explicit_customer_command",
      sourceMessageId: input.messageId === null || input.messageId === undefined ? null : String(input.messageId)
    });
    return { ran: false, reason: "customer_opted_out", shadow: null, loop: null, bridge: null, catalogCapability: null, commercialNeed: null, warnings: [] };
  }

  // Step 1: which runtime, if any, is enabled this turn. Multi-request is
  // authoritative when on - the legacy pipeline below never runs the same
  // turn (checked first, same priority as before ACS-R1-04-T05).
  const multiRequestEnabled = isMultiRequestRuntimeEnabled();
  // ACS-R1-05.1-T02.1: the native agent tool loop has its own enablement
  // flag and does not depend on the legacy shadow/operational-loop flags
  // below - checked before those legacy-specific gates so it is never
  // accidentally disabled by a flag that has nothing to do with it.
  const agentToolLoopEnabled = buildAgentToolLoopFeatureFlags().agentToolLoopEnabled;

  if (!multiRequestEnabled && !agentToolLoopEnabled) {
    if (!isAutonomyCycleEnabled()) {
      // Step 2: nothing will run this turn - Customer 360 is never loaded.
      return { ran: false, reason: "autonomous_cycle_disabled", shadow: null, loop: null, bridge: null, catalogCapability: null, commercialNeed: null, warnings: [] };
    }
    if (!buildCommercialShadowFeatureFlags().commercialShadowEnabled) {
      // Step 2: legacy is gated off too - Customer 360 is never loaded.
      return { ran: false, reason: "shadow_disabled", shadow: null, loop: null, bridge: null, catalogCapability: null, commercialNeed: null, warnings: [] };
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
      commercialNeed: null,
      // Step 6: structured Customer 360 + session warnings, merged with the runtime's own.
      warnings: dedupeWarnings([...multiRequest.warnings, ...customer360.warnings, ...session.warnings])
    };
  }

  if (agentToolLoopEnabled) {
    // Step 4/5 (ACS-R1-05.1-T02.1): same read-only CommercialContextSnapshot
    // source as the legacy path below, but this branch stops here - no
    // brainContextShim, no shadow evaluation, no old operational loop, no
    // legacy capability-execution stage. runNativeAgentToolLoopCycle owns
    // the whole turn from here (loop, dispatch, audit event).
    const rawSnapshot = await buildNativeCommercialContext({
      conversationPublicId: input.conversationPublicId,
      currentTime: input.currentTime
    });
    const snapshot = { ...rawSnapshot, customer360: customer360.context, customer360State: customer360.state, customerSession: session.decision };

    if (snapshot.status === "not_found") {
      return {
        ran: false,
        reason: "conversation_not_found",
        shadow: null,
        loop: null,
        bridge: null,
        agentLoop: null,
        catalogCapability: null,
        customerContextState: customer360.state,
        customerSession: session.decision,
        commercialNeed: null,
        warnings: dedupeWarnings([...customer360.warnings, ...session.warnings])
      };
    }

    // ACS-R1-05.1-T02.3B: resolved exactly once per cycle. "Nothing
    // published" is not an error - resolveSalesAgentConfiguration() already
    // degrades that case on its own to a deployment/safe default, and the
    // cycle below proceeds normally, model included. A resolution failure
    // (a real DB/repository error - the resolver's fail-closed contract:
    // it never swallows this itself) is different in kind: it must never
    // be treated as license to invent a default personality and keep
    // calling the model. The model is never invoked for this turn; a real,
    // neutral handoff is dispatched instead
    // (runNativeAgentToolLoopCycleConfigurationFailure), and the technical
    // cause is recorded only internally (this cycle's own warnings - never
    // exposed to the customer, never persisted verbatim to a
    // commercial_event).
    let resolvedSalesAgentConfiguration: ResolvedSalesAgentConfiguration;
    try {
      resolvedSalesAgentConfiguration = await resolveSalesAgentConfiguration();
    } catch (error) {
      const technicalReason = `sales_agent_configuration_resolution_failed:${error instanceof Error ? error.message : "unknown"}`;
      const agentLoopResult = await runNativeAgentToolLoopCycleConfigurationFailure({
        conversationId: input.conversationId,
        waId: input.waId,
        inboundMessageId: String(input.messageId ?? input.correlationId),
        correlationId: input.correlationId,
        currentTime: input.currentTime,
        snapshot,
        technicalReason
      });

      return {
        ran: true,
        reason: "agent_tool_loop_configuration_unavailable",
        shadow: null,
        loop: null,
        bridge: null,
        agentLoop: agentLoopResult,
        catalogCapability: null,
        customerContextState: customer360.state,
        customerSession: session.decision,
        commercialNeed: null,
        warnings: dedupeWarnings([...customer360.warnings, ...session.warnings, ...agentLoopResult.loop.warnings, ...agentLoopResult.dispatch.warnings])
      };
    }

    const agentLoopResult = await runNativeAgentToolLoopCycle({
      conversationId: input.conversationId,
      waId: input.waId,
      inboundMessageId: String(input.messageId ?? input.correlationId),
      correlationId: input.correlationId,
      currentTime: input.currentTime,
      customerMessage: input.messageText,
      snapshot,
      provider:
        input.agentLoopProvider ??
        createHttpAgentLoopProvider({
          model: resolvedSalesAgentConfiguration.effectiveModelConfiguration.model,
          temperature: resolvedSalesAgentConfiguration.effectiveModelConfiguration.temperature,
          maxOutputTokens: resolvedSalesAgentConfiguration.effectiveModelConfiguration.maxOutputTokens,
          maxModelRetries: resolvedSalesAgentConfiguration.effectiveModelConfiguration.maxModelRetries
        }),
      trustedCustomerSession: session.execution,
      abortSignal: input.abortSignal ?? null,
      resolvedSalesAgentConfiguration
    });

    const commercialNeed: NativeAutonomousCycleCommercialNeed = {
      productQuery: null,
      usage: snapshot.needProfile?.useCase ?? null,
      budgetMax: snapshot.needProfile?.budgetMax ?? null,
      currency: null
    };

    return {
      ran: true,
      reason: "agent_tool_loop",
      shadow: null,
      loop: null,
      bridge: null,
      agentLoop: agentLoopResult,
      catalogCapability: null,
      customerContextState: customer360.state,
      customerSession: session.decision,
      commercialNeed,
      warnings: dedupeWarnings([
        ...customer360.warnings,
        ...session.warnings,
        ...agentLoopResult.loop.warnings,
        ...agentLoopResult.dispatch.warnings
      ])
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
      commercialNeed: null,
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
      catalogCapability = await buildCatalogGroundedMessage(
        stage.executions,
        {
          correlationId: input.correlationId,
          conversationId: input.conversationId,
          opportunityId: typeof opportunityId === "number" ? opportunityId : null
        },
        {
          budgetMax: snapshot.needProfile?.budgetMax ?? null,
          usage: snapshot.needProfile?.useCase ?? null
        }
      );
      groundedLoop = applyCatalogGroundingToNextAction(loop, catalogCapability);
    } catch (error) {
      warnings.push(`catalog_capability_failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  // Fase 3.6 (ACS-R1-04-T06.1): onboarding post-plan stage - legacy runtime
  // only. Reuses session.execution built in Step 3 (never reloads onboarding,
  // never re-resolves identity, never loads Customer 360 again). The
  // structured planned operation is the canonical loop's own next-action
  // type - never free-text keyword search.
  if (groundedLoop) {
    try {
      const postPlanResult = await runCustomerOnboardingPostPlanStage({
        plannedOperation: { operation: groundedLoop.selectedNextAction?.type ?? null },
        messageText: input.messageText,
        correlationId: input.correlationId,
        customerSessionExecution: session.execution,
        // ACS-R1-04-T07 correlation only - already computed above for the
        // catalog capability stage; never re-derived, never used to gate
        // create_customer/link_external_identity authority.
        opportunityId: groundedLoop.resultingState?.opportunityId != null ? String(groundedLoop.resultingState.opportunityId) : null,
        decisionId: groundedLoop.decisionRecord?.decisionId ?? null,
        dependencies: input.customerSessionDependencies ?? undefined
      });
      warnings.push(...postPlanResult.warnings);
      groundedLoop = applyOnboardingGroundingToNextAction(groundedLoop, postPlanResult);
    } catch (error) {
      warnings.push(`customer_onboarding_post_plan_failed: ${error instanceof Error ? error.message : "unknown"}`);
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

  // ACS-R1-05-T06.2 (C2/C9): commercial need read from already-loaded,
  // persisted sources only - crm_sales_need_profiles (via snapshot.needProfile,
  // loaded in Fase 1 above) for usage/budget, and the catalog stage's own
  // search query (never the raw inbound text) for productQuery. Never a
  // second DB read, never inferred from free text here.
  const commercialNeed: NativeAutonomousCycleCommercialNeed = {
    productQuery: catalogCapability?.searchResult?.data?.query ?? null,
    usage: snapshot.needProfile?.useCase ?? null,
    budgetMax: snapshot.needProfile?.budgetMax ?? null,
    currency: catalogCapability?.ranking?.picks[0]?.currency ?? null
  };

  return {
    ran: true,
    shadow,
    loop: groundedLoop,
    bridge,
    catalogCapability,
    customerContextState: customer360.state,
    customerSession: session.decision,
    commercialNeed,
    warnings: dedupeWarnings(warnings)
  };
}
