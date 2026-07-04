import { buildNativeCommercialContext } from "../context/buildNativeCommercialContext";
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
};

export type NativeAutonomousCycleResult = {
  ran: boolean;
  reason?: string;
  shadow: CommercialShadowResult | null;
  loop: CommercialOperationalLoopResult | null;
  bridge: CommercialExecutionBridgeResult | null;
  multiRequest?: MultiRequestCycleResult | null;
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
  // Authoritative runtime switch: with the multi-request flag on, the legacy
  // single-intent pipeline below never runs for this turn - one runtime or
  // the other, never both.
  if (isMultiRequestRuntimeEnabled()) {
    const multiRequest = await runMultiRequestAutonomousCycle({
      conversationId: input.conversationId,
      inboundMessageId: input.messageId === null || input.messageId === undefined ? "" : String(input.messageId),
      messageText: input.messageText,
      correlationId: input.correlationId
    });
    return {
      ran: multiRequest.ran,
      reason: multiRequest.reason ?? "multi_request_runtime",
      shadow: null,
      loop: null,
      bridge: null,
      multiRequest,
      warnings: multiRequest.warnings
    };
  }

  if (!isAutonomyCycleEnabled()) {
    return { ran: false, reason: "autonomous_cycle_disabled", shadow: null, loop: null, bridge: null, warnings: [] };
  }

  const shadowFlags = buildCommercialShadowFeatureFlags();
  const loopFlags = buildCommercialLoopFeatureFlags();
  const bridgeFlags = buildCommercialBridgeFeatureFlags();

  if (!shadowFlags.commercialShadowEnabled) {
    return { ran: false, reason: "shadow_disabled", shadow: null, loop: null, bridge: null, warnings: [] };
  }

  const warnings: string[] = [];
  const startedAt = Date.now();
  const currentTime = input.currentTime;

  // Fase 1: build native commercial context
  const snapshot = await buildNativeCommercialContext({
    conversationPublicId: input.conversationPublicId,
    currentTime
  });

  if (snapshot.status === "not_found") {
    return { ran: false, reason: "conversation_not_found", shadow: null, loop: null, bridge: null, warnings: [] };
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
      provider: null,
      runtimeOptions: {
        enabled: true,
        mode: salesAgentDryRun ? "dry_run" : "live",
        timeoutMs: runtimeTimeoutMs,
        maxInputCharacters: 20000,
        maxOutputCharacters: 12000,
        strictValidation: true,
        allowedCapabilities: [],
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
      allowedCapabilities: [],
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

  // Fase 4: execution bridge (action queue + outbox)
  let bridge: CommercialExecutionBridgeResult | null = null;
  if (loop && bridgeFlags.actionQueueEnabled) {
    try {
      bridge = await runCommercialExecutionBridge({
        operationalLoopResult: loop,
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
    loop,
    bridge,
    warnings
  };
}
