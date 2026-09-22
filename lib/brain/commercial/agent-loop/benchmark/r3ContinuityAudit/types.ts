import type { BenchmarkProviderCallRecord } from "../types";
import type { BenchmarkE2EDurableStateSnapshot, BenchmarkE2EFlagsConfig } from "../r3CommercialE2E/types";

/**
 * P7.13 - R3 Continuity Vulnerability & Degradation Audit. Benchmark-only
 * types, never imported by production code. Every field here is a bounded
 * projection of something this repo already produces (crm_request_facts,
 * agent_sessions, BenchmarkProviderCallRecord, BenchmarkE2EDurableStateSnapshot) -
 * see docs/audits/r3-p7-13-continuity-vulnerability-degradation.md section 1
 * for why DRM/AgentTurnInput are recorded as shadow-only observability, never
 * as "what the model saw".
 */

export const CONTINUITY_CONVERSATION_LABELS = ["A", "B", "C", "D", "E"] as const;
export type ContinuityConversationLabel = (typeof CONTINUITY_CONVERSATION_LABELS)[number];

export const CONTINUITY_CONVERSATION_PERSONAS: Record<ContinuityConversationLabel, string> = {
  A: "SIMPLE_BUYER",
  B: "INDECISIVE_BUYER",
  C: "MULTI_PRODUCT",
  D: "CASUAL_RETURNING",
  E: "CHAOTIC_ADVERSARIAL"
};

// ---------------------------------------------------------------------------
// Fact lineage - task sections 5/8
// ---------------------------------------------------------------------------

export const CONTINUITY_FACT_KEYS = ["selection", "destination", "shipping", "quote", "objective"] as const;
export type ContinuityFactKey = (typeof CONTINUITY_FACT_KEYS)[number];

/**
 * One fact's state as seen from each layer, captured at one turn boundary.
 * `agentInputValue`/`providerVisibleValue` are deliberately the SAME source
 * (commercialContextSummary) per the audit's section 1.6 finding - kept as
 * two fields because the task's own vocabulary (sections 5/8) expects both,
 * and collapsing them would hide that this codebase has no independent
 * "AgentTurnInput reaches the provider" path to compare against.
 */
export type ContinuityFactLineageEntry = {
  turnIndex: number;
  conversation: ContinuityConversationLabel;
  factKey: ContinuityFactKey;
  originTurn: number | null;
  currentTruth: unknown;
  durableFactId: string | null;
  drmValue: unknown;
  agentInputValue: unknown;
  providerVisibleValue: unknown;
  summaryMentionsFact: boolean | null;
};

// ---------------------------------------------------------------------------
// Session / compaction observability - task sections 19-21
// ---------------------------------------------------------------------------

export type ContinuitySessionSnapshot = {
  sessionId: string | null;
  status: string | null;
  compactedThroughSeq: number | null;
  compactedPrefixTextLength: number | null;
  /** Synthetic fixture conversations only (no real customer PII) - kept in full so keyword-based fact-mention checks (section 20) are possible. */
  compactedPrefixText: string | null;
};

export type ContinuityCompactionEvent = {
  turnIndex: number;
  conversation: ContinuityConversationLabel;
  compactionIndex: number;
  preCompactedThroughSeq: number | null;
  postCompactedThroughSeq: number | null;
  summaryTextLengthBefore: number | null;
  summaryTextLengthAfter: number | null;
  factsKnownBefore: Record<ContinuityFactKey, unknown>;
  factsKnownAfter: Record<ContinuityFactKey, unknown>;
  factLost: ContinuityFactKey[];
  factChanged: ContinuityFactKey[];
};

// ---------------------------------------------------------------------------
// Provider payload / tool surface - task sections 25-27
// ---------------------------------------------------------------------------

export type ContinuityProviderPayloadSnapshot = {
  turnIndex: number;
  conversation: ContinuityConversationLabel;
  reason: string;
  messageCount: number;
  /** P7.13-A section 19. Detected via the literal finalization-phase marker in the system prompt text - "unknown" only when no system message was captured at all. */
  phase: "gathering" | "finalization" | "unknown";
  systemPromptHash: string | null;
  systemPromptLength: number | null;
  /** P7.13-A section 19. Chars from the "Available tools:" marker to the end of the system prompt (gathering phase only, null on finalization/unknown) - isolates the per-tool JSON-schema catalog from the rest of the system prompt. */
  toolCatalogLength: number | null;
  eligibleCapabilityNames: readonly string[] | null;
  eligibleCapabilityNamesHash: string | null;
  /** P7.13-A section 5. Which message the extractor actually found commercialContext in this turn. */
  commercialContextSource: "legacy_user" | "harness_aligned_system" | "not_found";
  commercialContextParseStatus: "ok" | "malformed" | "absent";
  commercialContextJson: unknown;
  rawHistoryTokensEstimate: number;
  providerInputTokens: number | null;
  providerOutputTokens: number | null;
};

// ---------------------------------------------------------------------------
// Compaction eligibility trace - P7.13-A section 8-13
// ---------------------------------------------------------------------------

/**
 * Benchmark-only, read-only mirror of runSessionCompaction.ts's own eligibility
 * decision (task section 9) - built by independently calling the same
 * exported, pure/read functions production already uses
 * (loadPersistentSessionContext, resolveValidCompactionCutoff,
 * shouldTriggerSessionCompaction), never by modifying or duplicating
 * runSessionCompactionIfEligible itself. Captured AFTER each turn so
 * compactionAttempted/compactionSucceeded reflect what runSalesAgentRuntimeCycle
 * actually did this turn (via sessionAfter.compactedThroughSeq and the
 * surfaced runtimeWarnings), not a second, independent compaction run.
 */
export type ContinuityCompactionEligibilityTrace = {
  turnIndex: number;
  conversation: ContinuityConversationLabel;
  localTurn: number;
  sessionId: string | null;
  rawMessageCount: number;
  uncompactedMessageCount: number;
  compactedThroughSeqBefore: number | null;
  compactedThroughSeqAfter: number | null;
  targetRecentMessages: number;
  maxRawMessages: number;
  sessionCompactionEnabled: boolean;
  persistentSessionCognitionEnabled: boolean;
  /** shouldTriggerSessionCompaction(uncompactedMessageCount, maxRawMessages), evaluated on the pre-turn read - task section 9 category A vs B/C/D/E. */
  compactionEligible: boolean;
  /** True when compactedThroughSeq actually advanced this turn (the only ground truth this trace has for "attempted and reached a decision point"; production's own ran/persisted flags are not returned to the caller - see compactionSkippedReason for what IS surfaced). */
  compactionSucceeded: boolean;
  /** runSalesAgentRuntimeCycle.ts only ever pushes a warning for the ran&&!persisted case (session_compaction_failed:<reason>) - every other outcome (not eligible, eligible-but-nothing-to-compact, no session) is silently indistinguishable from production's own return value alone. This field carries whatever runtime.warnings DID surface this turn, verbatim, never fabricated. */
  compactionSkippedReason: string | null;
};

// ---------------------------------------------------------------------------
// Provider call outcomes - P7.13-A section 14-17
// ---------------------------------------------------------------------------

export const CONTINUITY_INVALID_JSON_BUCKETS = ["TRUNCATED_JSON", "EMPTY_RESPONSE", "UNKNOWN_NON_TRUNCATED", "NOT_APPLICABLE"] as const;
export type ContinuityInvalidJsonBucket = (typeof CONTINUITY_INVALID_JSON_BUCKETS)[number];

/**
 * Benchmark-only, per-call (never per-turn) provider outcome record - every
 * call in every turn, not only the 6 scheduled ContinuityProviderPayloadSnapshot
 * turns. Built entirely from fields BenchmarkProviderCallRecord already
 * captures (instrumentedProvider.ts) - never a raw response body/text, which
 * httpAgentLoopProvider.ts's own classifier deliberately never surfaces past
 * the JSON-parse boundary (providerFailureClassification.ts: "never carries
 * ... any part of a provider response body") - touching that file is out of
 * scope for this instrumentation-only phase (task section 2). invalidJsonBucket
 * is therefore a best-effort split using only finishReason/outputTokens, never
 * a claim about the actual raw text; see the audit doc's P7.13-A section 16.
 */
export type ContinuityProviderCallOutcome = {
  turnIndex: number;
  conversation: ContinuityConversationLabel;
  callIndex: number;
  phase: "gathering" | "finalization" | "unknown";
  outcome: string;
  errorCode: string | null;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  invalidJsonBucket: ContinuityInvalidJsonBucket;
};

// ---------------------------------------------------------------------------
// Failure taxonomy - task section 9
// ---------------------------------------------------------------------------

export const CONTINUITY_FAILURE_CATEGORIES = [
  "SOURCE_FACT_MISSING",
  "SOURCE_FACT_STALE",
  "PROJECTION_LOSS",
  "DRM_LOSS",
  "AGENT_INPUT_LOSS",
  "SUMMARY_LOSS",
  "SUMMARY_CONTRADICTION",
  "STALE_FACT_RESURRECTION",
  "MODEL_IGNORED_VISIBLE_FACT",
  "MODEL_REASKED_VISIBLE_FACT",
  "MODEL_REINTRODUCED_OLD_STATE",
  "OBJECTIVE_RESET",
  "CONVERSATION_RESET",
  "REGREETING",
  "TOOL_POLICY_FAILURE",
  "FALSE_SUCCESS_CLAIM",
  "DURABLE_MUTATION_FAILURE",
  "CROSS_LAYER_INCONSISTENCY",
  "UNKNOWN"
] as const;
export type ContinuityFailureCategory = (typeof CONTINUITY_FAILURE_CATEGORIES)[number];

export const CONTINUITY_ROOT_CAUSE_LAYERS = [
  "DATA_SOURCE",
  "COMMERCIAL_WORK",
  "DRM",
  "AGENT_INPUT",
  "SESSION",
  "COMPACTION",
  "SETTLEMENT",
  "PROMPT_ASSEMBLY",
  "MODEL_POLICY",
  "GATEWAY",
  "UNKNOWN"
] as const;
export type ContinuityRootCauseLayer = (typeof CONTINUITY_ROOT_CAUSE_LAYERS)[number];

export const CONTINUITY_SEVERITIES = ["CRITICAL", "IMPORTANT", "BEHAVIORAL"] as const;
export type ContinuitySeverity = (typeof CONTINUITY_SEVERITIES)[number];

export type ContinuityFailureRecord = {
  turnIndex: number;
  conversation: ContinuityConversationLabel;
  category: ContinuityFailureCategory;
  rootCauseLayer: ContinuityRootCauseLayer;
  severity: ContinuitySeverity;
  detail: string;
  factKey: ContinuityFactKey | null;
  compactionIndexAtFailure: number;
};

// ---------------------------------------------------------------------------
// Invariants - task section 36
// ---------------------------------------------------------------------------

export type ContinuityInvariantCheck = { name: string; ok: boolean; hard: boolean; detail: string | null };

// ---------------------------------------------------------------------------
// Probes - task sections 13-18, 22, 32-33
// ---------------------------------------------------------------------------

export const CONTINUITY_PROBE_TYPES = [
  "MEMORY_SURVIVAL",
  "RE_QUESTION",
  "RE_GREETING",
  "OBJECTIVE_SURVIVAL",
  "STATE_CONFLICT",
  "OLD_STATE_RESURRECTION",
  "TOOL_POLICY",
  "PAUSE_RESUME"
] as const;
export type ContinuityProbeType = (typeof CONTINUITY_PROBE_TYPES)[number];

export type ContinuityProbeMeta = {
  probeType: ContinuityProbeType;
  targetFactKey?: ContinuityFactKey;
  originTurn?: number;
  depth?: number;
  expectedValue?: unknown;
  pauseMinutes?: number;
  note?: string;
};

// ---------------------------------------------------------------------------
// Stress plan (frozen, pre-generated) - task section 12
// ---------------------------------------------------------------------------

export type ContinuityExpectedMutation = "NONE" | "SELECT" | "MODIFY" | "REPLACE" | "CANCEL" | "KEEP";
export type ContinuityExpectedToolClass = "READ" | "COMMERCIAL_ACTION" | "NONE";

export type ContinuityPlannedTurn = {
  conversation: ContinuityConversationLabel;
  localIndex: number;
  message: string;
  category: string;
  expectedMutation: ContinuityExpectedMutation;
  expectedToolClass: ContinuityExpectedToolClass;
  allowClarification: boolean;
  factsThatMustSurvive: readonly ContinuityFactKey[];
  probe: ContinuityProbeMeta | null;
  /** Section 32: shifts the fixture's synthetic "current time" for this turn only (minutes added since the conversation's previous turn). */
  simulatedPauseMinutes: number;
};

// ---------------------------------------------------------------------------
// Turn trace - task section 7
// ---------------------------------------------------------------------------

export type ContinuityToolCallTrace = { capability: string; status: string; errorCode: string | null };

export type ContinuityTurnTrace = {
  turnIndex: number;
  conversation: ContinuityConversationLabel;
  localIndex: number;
  compactionGenerationBefore: number;
  probe: ContinuityProbeMeta | null;
  category: string;
  customerMessage: string;
  durableFactsBefore: Record<ContinuityFactKey, unknown>;
  sessionBefore: ContinuitySessionSnapshot;
  modelResponse: string | null;
  terminalReason: string;
  handoffReason: string | null;
  /**
   * P7.13-A. cycleResult.runtime.reason, verbatim, for EVERY terminalReason -
   * salesAgentRuntime.ts's failedResult()/blockedResult() populate this same
   * field the "handoff" case already used, but the pre-P7.13-A harness only
   * ever forwarded it when status==="handoff", silently dropping it for
   * "failed"/"blocked" (see docs/audits/r3-p7-13-...md section 7 finding on
   * turn D10/turnIndex 53: terminalReason "failed", modelResponse null, and
   * no diagnostic signal anywhere in the old artifacts).
   */
  runtimeReason: string | null;
  /** P7.13-A. cycleResult.runtime.warnings, verbatim - includes session_compaction_failed:<reason> when compaction ran and failed to persist (runSalesAgentRuntimeCycle.ts's own warning, previously dropped entirely by this harness). */
  runtimeWarnings: readonly string[];
  toolCalls: readonly ContinuityToolCallTrace[];
  eligibleCapabilityNames: readonly string[] | null;
  durableFactsAfter: Record<ContinuityFactKey, unknown>;
  sessionAfter: ContinuitySessionSnapshot;
  compactionHappenedThisTurn: boolean;
  confirmationClass: string | null;
  missingFactKind: string | null;
  falseSuccessClaim: boolean;
  regreeted: boolean;
  invariantChecks: readonly ContinuityInvariantCheck[];
  providerCalls: readonly BenchmarkProviderCallRecord[];
  durableStateAfterTurn: BenchmarkE2EDurableStateSnapshot | null;
  /** P7.13-A section 8-13. See ContinuityCompactionEligibilityTrace's own comment. */
  compactionEligibility: ContinuityCompactionEligibilityTrace;
  /** P7.13-A section 14-17. One entry per provider call this turn, never only the scheduled-snapshot turns. */
  providerCallOutcomes: readonly ContinuityProviderCallOutcome[];
};

// ---------------------------------------------------------------------------
// Manifest / artifacts - task section 46
// ---------------------------------------------------------------------------

export type ContinuityManifest = {
  runId: string;
  gitSha: string | null;
  startedAt: string;
  mode: "smoke" | "main";
  model: string | null;
  temperature: number | null;
  thinking: "enabled" | "disabled" | null;
  maxOutputTokens: number | null;
  timeoutMs: number | null;
  maxModelRetries: number | null;
  flags: BenchmarkE2EFlagsConfig;
  benchmarkOverrides: Record<string, string>;
  conversations: readonly { label: ContinuityConversationLabel; persona: string; plannedTurns: number }[];
  totalPlannedTurns: number;
  freezeHash: string;
};
