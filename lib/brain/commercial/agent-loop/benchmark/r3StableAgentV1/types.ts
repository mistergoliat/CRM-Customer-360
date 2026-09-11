import type { AgentLoopResult, AgentLoopStepRecord, AgentLoopTerminalReason, AgentStep, PendingCatalogActionStep } from "../../agentStepTypes";
import type { AgentLoopToolName } from "../../runAgentToolLoop";
import type { RecentCatalogContext } from "../../recentCatalogContext";
import type { BenchmarkOfflineStep, BenchmarkProviderCallRecord, BenchmarkTurnTrace } from "../types";

/**
 * R3 Stable Agent Acceptance Harness V1. Frozen golden case set - separate
 * from the legacy C01-C12 corpus and MI01-MI06 multi-intent corpus (neither
 * is touched by this task). Reuses BenchmarkOfflineStep/BenchmarkProviderCallRecord/
 * BenchmarkTurnTrace from the existing benchmark/types.ts unchanged - this
 * module only adds the golden-case-specific ground truth/scoring vocabulary
 * the task itself asks for (PASS/FAIL/NOT_APPLICABLE/UNVERIFIABLE across 8
 * named dimensions), which the legacy BenchmarkGroundTruth/BenchmarkCaseScore
 * do not express.
 */

export const GOLDEN_CASE_CATEGORIES = ["NO_TOOL", "SIMPLE_TOOL_SELECTION", "TOOL_BOUNDARY", "OBSERVATION_REPLAN", "COMMERCIAL_MUTATION"] as const;
export type GoldenCaseCategory = (typeof GOLDEN_CASE_CATEGORIES)[number];

export const GOLDEN_SCORE_VALUES = ["PASS", "FAIL", "NOT_APPLICABLE", "UNVERIFIABLE"] as const;
export type GoldenScoreValue = (typeof GOLDEN_SCORE_VALUES)[number];

export type GoldenActionType = "use_tool" | "respond" | "handoff";

/** Ground truth for a full-turn case, run through the real, unmodified runAgentToolLoop. */
export type GoldenTurnExpectation = {
  /** Tools that must complete (status "completed") for the case to pass. Empty for no-tool/negative cases. */
  requiredTools: AgentLoopToolName[];
  /** Tools that must never be invoked, regardless of outcome. */
  forbiddenTools: AgentLoopToolName[];
  /** The model's first gathering-phase decision type, when this case cares - null means "not checked". */
  firstActionType: GoldenActionType | null;
  /** The one tool this case is primarily testing tool-selection for - null when N/A (e.g. pure no-tool cases). */
  expectedTool: AgentLoopToolName | null;
  /** Expected loop.terminalReason - null means "not checked" (rare; kept for cases with a genuinely open terminal outcome). */
  terminalReason: AgentLoopTerminalReason | null;
  /**
   * Case-specific structural argument-semantics check (e.g. select_products
   * targets exactly {10,15,20,25}, set_shipping_destination resolves to
   * Providencia). Absent means "no case-specific semantics beyond required/forbidden tools".
   */
  argumentSemantics?: (loop: AgentLoopResult) => { pass: GoldenScoreValue; notes: string[] };
  /**
   * CM-005 only: a benchmark-only (never production) heuristic mirroring
   * commercialMutationClaims.ts's own narrow-regex discipline, scoped to
   * quote-confirmation language, since the production regex is deliberately
   * narrow to select_products claims only (task: never touch that regex).
   */
  checkFalseQuoteClaim?: boolean;
};

export type GoldenTurnCase = {
  mode: "turn";
  caseId: string;
  category: GoldenCaseCategory;
  description: string;
  customerMessage: string;
  commercialContextSummary: Record<string, unknown>;
  recentCatalogContext?: RecentCatalogContext | null;
  pendingCatalogAction?: PendingCatalogActionStep | null;
  /** Same discipline as the legacy corpus's own BenchmarkCase.setup - runs once per case-run against that run's fresh, isolated opportunityId/conversationId. */
  setup?: (input: { opportunityId: number; conversationId: number }) => Promise<void>;
  /** Consumed by the existing offlineProvider.ts unchanged. */
  offlineScript: BenchmarkOfflineStep[];
  expected: GoldenTurnExpectation;
  notes: string;
};

/**
 * Ground truth for a single-decision "observation -> replan" probe (category
 * D). Deliberately bypasses runAgentToolLoop's own turn/step bookkeeping -
 * these cases test exactly one model decision given a real-shaped, injected
 * prior ToolObservation, mirroring the repo's own established pattern
 * (scripts/live-semantic-discovery-benchmark.ts's askAgentStep) rather than
 * inventing a second planner or a parallel turn engine.
 */
export type GoldenReplanExpectation = {
  allowedNextActionTypes: GoldenActionType[];
  allowedNextTools?: AgentLoopToolName[];
  /** productIds this case's injected observation actually evidenced - a use_tool argument citing any other id is a grounding failure. */
  groundedProductIds: string[];
};

export type GoldenDecisionCase = {
  mode: "decision";
  caseId: string;
  category: "OBSERVATION_REPLAN";
  description: string;
  customerMessage: string;
  priorSteps: AgentLoopStepRecord[];
  /** Consumed by the existing offlineProvider.ts unchanged (a single-entry script) - a well-behaved answer matching this case's own expectation, never a claim about real model behavior. */
  offlineNextStep: BenchmarkOfflineStep;
  expected: GoldenReplanExpectation;
  notes: string;
};

export type GoldenCase = GoldenTurnCase | GoldenDecisionCase;

export type GoldenDimension =
  | "actionTypePass"
  | "toolSelectionPass"
  | "argumentStructurePass"
  | "argumentSemanticsPass"
  | "evidenceGroundingPass"
  | "observationReplanPass"
  | "mutationGroundingPass"
  | "taskCompletionPass";

export type GoldenCaseScore = {
  caseId: string;
  category: GoldenCaseCategory;
  runIndex: number;
  expectedAction: GoldenActionType | null;
  actualAction: GoldenActionType | null;
  expectedTool: AgentLoopToolName | null;
  actualTool: AgentLoopToolName | string | null;
  terminalReason: AgentLoopTerminalReason | null;
  toolExecutionCount: number;
  decisionCount: number;
  llmCallCount: number;
  falseCommercialConfirmation: boolean;
  dimensions: Record<GoldenDimension, GoldenScoreValue>;
  overallPass: boolean;
  failureReason: string | null;
};

export type GoldenTurnRunResult = {
  caseId: string;
  category: GoldenCaseCategory;
  runIndex: number;
  mode: "turn";
  loop: AgentLoopResult;
  totalElapsedMs: number;
  providerCalls: BenchmarkProviderCallRecord[];
  trace: BenchmarkTurnTrace;
  score: GoldenCaseScore;
};

export type GoldenDecisionRunResult = {
  caseId: string;
  category: "OBSERVATION_REPLAN";
  runIndex: number;
  mode: "decision";
  nextStep: AgentStep | null;
  invalidOutputReason: string | null;
  elapsedMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  score: GoldenCaseScore;
};

export type GoldenRunResult = GoldenTurnRunResult | GoldenDecisionRunResult;

export type GoldenRunMode = "offline" | "live";

export type GoldenRunSummary = {
  mode: GoldenRunMode;
  model: string | null;
  runsPerCase: number;
  startedAt: string;
  finishedAt: string;
  results: GoldenRunResult[];
};
