import { createHash } from "node:crypto";
import type { BenchmarkProviderCallRecord } from "../types";
import type { ContinuityProviderPayloadSnapshot, ContinuityConversationLabel } from "./types";

/**
 * P7.13 (task section 26/27). This codebase's AgentLoopProviderRequest never
 * carries tool JSON schemas as part of the per-request payload (agentLoopProviderTypes.ts:
 * only `messages`/`correlationId` - see docs/audits/r3-p7-13-...md section 1.6),
 * so "tool surface" here is a documented proxy, not the raw schema: the
 * system-prompt hash (first system-role message, immutable per
 * buildAgentStepPromptPackage.ts unless S1/prompts change - forbidden this
 * phase) plus the eligible-capability-name set the P6.3 shadow reports each
 * turn (the one real per-turn signal of which tools the model was told about).
 * A change in either hash across a long conversation with no S1/flag change
 * is itself the finding (section 26: "si cambia inesperadamente, clasificar
 * como harness/context construction bug").
 */

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function extractSystemPromptText(providerCalls: readonly BenchmarkProviderCallRecord[]): string | null {
  const lastCall = providerCalls[providerCalls.length - 1];
  const systemMessage = lastCall?.requestMessages?.find((message) => message.role === "system");
  return typeof systemMessage?.content === "string" ? systemMessage.content : null;
}

/**
 * P7.13-A (task section 3-5). Verified against the real code, not inferred:
 * buildHarnessAlignedMessages (harnessAlignedMessageProjection.ts:86) emits
 * the per-turn dynamic runtime context (the block that carries
 * commercialContext) as a SECOND role:"system" message, prefixed with this
 * exact literal label, positioned right after the immutable systemInstructions
 * message and before persistentSessionHistoricalMessages (which may itself
 * start with an unrelated role:"system" compacted-prefix message - this label
 * is what tells the two apart, never "first"/"last" system message). Under
 * legacy/persistent mode (harnessAlignedMessageModelEnabled=false,
 * buildAgentStepPromptPackage.ts:968-985), the same data instead travels as a
 * `commercialContext` field inside the JSON-stringified last `user` message.
 */
const RUNTIME_CONTEXT_LABEL = "RUNTIME CONTEXT (system-provided, not authored by the customer): ";

export type CommercialContextExtractionSource = "legacy_user" | "harness_aligned_system" | "not_found";
export type CommercialContextParseStatus = "ok" | "malformed" | "absent";

export type CommercialContextExtraction = {
  source: CommercialContextExtractionSource;
  commercialContextJson: unknown;
  parseStatus: CommercialContextParseStatus;
};

function extractCommercialContextField(parsed: unknown): { value: unknown; ok: boolean } {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { value: null, ok: false };
  const commercialContext = (parsed as Record<string, unknown>).commercialContext;
  return commercialContext !== undefined ? { value: commercialContext, ok: true } : { value: null, ok: false };
}

/**
 * Benchmark-only, dual-mode extractor (task section 5). Never "first JSON
 * found" - each branch is anchored to the exact message the runtime is
 * verified to construct for that mode (see the module comment above and
 * harnessAlignedMessageProjection.ts). Checked harness-aligned FIRST since
 * that is the only shape where a role:"system" runtime-context message can
 * exist at all; legacy mode never produces one.
 */
export function extractProviderVisibleCommercialContext(providerCalls: readonly BenchmarkProviderCallRecord[]): CommercialContextExtraction {
  const lastCall = providerCalls[providerCalls.length - 1];
  const messages = lastCall?.requestMessages ?? [];

  const runtimeContextMessage = messages.find(
    (message) => message.role === "system" && typeof message.content === "string" && message.content.startsWith(RUNTIME_CONTEXT_LABEL)
  );
  if (runtimeContextMessage) {
    const jsonText = (runtimeContextMessage.content as string).slice(RUNTIME_CONTEXT_LABEL.length);
    try {
      const { value, ok } = extractCommercialContextField(JSON.parse(jsonText));
      return { source: "harness_aligned_system", commercialContextJson: ok ? value : null, parseStatus: ok ? "ok" : "malformed" };
    } catch {
      return { source: "harness_aligned_system", commercialContextJson: null, parseStatus: "malformed" };
    }
  }

  const userMessages = messages.filter((message) => message.role === "user");
  const lastUser = userMessages[userMessages.length - 1];
  if (typeof lastUser?.content === "string") {
    try {
      const { value, ok } = extractCommercialContextField(JSON.parse(lastUser.content));
      return { source: "legacy_user", commercialContextJson: ok ? value : null, parseStatus: ok ? "ok" : "malformed" };
    } catch {
      return { source: "legacy_user", commercialContextJson: null, parseStatus: "malformed" };
    }
  }

  return { source: "not_found", commercialContextJson: null, parseStatus: "absent" };
}

/** Rough token estimate (chars/4, same order-of-magnitude heuristic used across P7.10-P7.12) - never a real tokenizer count. */
function estimateTokens(providerCalls: readonly BenchmarkProviderCallRecord[]): number {
  const lastCall = providerCalls[providerCalls.length - 1];
  const totalChars = (lastCall?.requestMessages ?? []).reduce((sum, message) => sum + (typeof message.content === "string" ? message.content.length : 0), 0);
  return Math.round(totalChars / 4);
}

/**
 * P7.13-A section 19 (system prompt growth). Benchmark-only phase/layer
 * split, anchored to two literal markers verified against
 * buildAgentStepPromptPackage.ts, never a guess: "no more tools are
 * available" only ever appears in the finalization branch's loop-contract
 * text (buildLoopContractLines, phase==="finalization"), and "Available
 * tools:" only ever appears at the end of the gathering branch's
 * buildEvidenceAndToolRulesLines, immediately before the per-tool catalog
 * (renderToolLine, one line per AGENT_LOOP_TOOL_POOL entry, each carrying
 * that tool's full inputSchema inline). Splitting on it isolates the one
 * component of the system prompt whose size is a function of the tool
 * catalog rather than fixed instruction text - the prime suspect for the
 * ~26KB->~47KB growth the readiness report observed but did not diagnose.
 */
const FINALIZATION_PHASE_MARKER = "no more tools are available";
const TOOL_CATALOG_MARKER = "Available tools:";

function detectPhase(systemPromptText: string | null): "gathering" | "finalization" | "unknown" {
  if (systemPromptText === null) return "unknown";
  return systemPromptText.includes(FINALIZATION_PHASE_MARKER) ? "finalization" : "gathering";
}

function toolCatalogLength(systemPromptText: string | null): number | null {
  if (systemPromptText === null) return null;
  const markerIndex = systemPromptText.indexOf(TOOL_CATALOG_MARKER);
  return markerIndex === -1 ? null : systemPromptText.length - markerIndex;
}

export function buildProviderPayloadSnapshot(input: {
  turnIndex: number;
  conversation: ContinuityConversationLabel;
  reason: string;
  providerCalls: readonly BenchmarkProviderCallRecord[];
  eligibleCapabilityNames: readonly string[] | null;
}): ContinuityProviderPayloadSnapshot {
  const lastCall = input.providerCalls[input.providerCalls.length - 1];
  const systemPromptText = extractSystemPromptText(input.providerCalls);
  const eligibleSorted = input.eligibleCapabilityNames ? [...input.eligibleCapabilityNames].sort() : null;
  const contextExtraction = extractProviderVisibleCommercialContext(input.providerCalls);
  return {
    turnIndex: input.turnIndex,
    conversation: input.conversation,
    reason: input.reason,
    messageCount: lastCall?.requestMessages?.length ?? 0,
    phase: detectPhase(systemPromptText),
    systemPromptHash: systemPromptText ? sha256(systemPromptText) : null,
    systemPromptLength: systemPromptText ? systemPromptText.length : null,
    toolCatalogLength: toolCatalogLength(systemPromptText),
    eligibleCapabilityNames: eligibleSorted,
    eligibleCapabilityNamesHash: eligibleSorted ? sha256(JSON.stringify(eligibleSorted)) : null,
    commercialContextSource: contextExtraction.source,
    commercialContextParseStatus: contextExtraction.parseStatus,
    commercialContextJson: contextExtraction.commercialContextJson,
    rawHistoryTokensEstimate: estimateTokens(input.providerCalls),
    providerInputTokens: lastCall?.inputTokens ?? null,
    providerOutputTokens: lastCall?.outputTokens ?? null
  };
}
