import type {
  AutonomousCommercialLoopInput,
  AutonomousCommercialLoopResult,
  AutonomousLoopMode,
  AutonomousLoopRuntimeSnapshot
} from "../autonomous-loop";
import type { FollowUpMutationApplyResult, FollowUpMutationPlan } from "../follow-up-replanning";

export type ScenarioCategory =
  | "sales"
  | "follow_up"
  | "risk"
  | "human_handoff"
  | "transport"
  | "idempotency"
  | "lifecycle"
  | "failure";

export type ScenarioInitialState = {
  runtimeSeed: {
    opportunities: unknown[];
    decisions: unknown[];
    actions: unknown[];
    outbox: unknown[];
    deliveryResults: unknown[];
    auditEvents: unknown[];
  };
  configuration: {
    sandboxAutonomyEnabled: boolean;
    autonomousReplyEnabled: boolean;
    whitelistedWaIds: string[];
    executionGateEnabled: boolean;
    outboxBridgeEnabled: boolean;
    outboxWorkerEnabled: boolean;
    messageTransportEnabled: boolean;
    followUpEnabled: boolean;
    sandboxRequired: boolean;
  };
};

export type ScenarioStep = {
  stepId: string;
  title: string;
  now: string;
  mode: ScenarioExecutionMode;
  input: AutonomousCommercialLoopInput;
  expectedCheckpointIds: string[];
  notes: string[];
  replayFollowUp?: boolean;
};

export type ScenarioDefinition = {
  scenarioId: string;
  name: string;
  description: string;
  category: ScenarioCategory;
  tags: string[];
  initialState: ScenarioInitialState;
  steps: ScenarioStep[];
  expectations: ScenarioExpectation[];
  metadata: {
    version: string;
    deterministic: true;
    syntheticDataOnly: true;
  };
};

export type ScenarioExpectation = {
  expectationId: string;
  stepId: string | null;
  type:
    | "loop_status"
    | "final_stage"
    | "action_status"
    | "outbox_status"
    | "delivery_status"
    | "follow_up_decision"
    | "audit_event_exists"
    | "runtime_count"
    | "invariant"
    | "no_real_side_effect";
  path: string;
  operator: "equals" | "not_equals" | "contains" | "exists" | "not_exists" | "greater_than" | "less_than";
  expected: unknown;
};

export type ScenarioValidationError = {
  code: string;
  messageSafe: string;
  path: string;
};

export type ScenarioValidationResult =
  | {
      ok: true;
      value: ScenarioDefinition;
      warnings: string[];
    }
  | {
      ok: false;
      value: null;
      warnings: string[];
      errors: ScenarioValidationError[];
    };

export type ScenarioSafeInputSummary = {
  scenarioId: string;
  stepId: string;
  mode: ScenarioExecutionMode;
  now: string;
  correlationId: string;
  tenantId: string;
  waIdMasked: string | null;
  caseId: string | number | null;
  opportunityId: string | number | null;
  messageId: string;
  actionTypeHint: string | null;
  transportScenario: string;
  noteCount: number;
};

export type ScenarioStateDiff = {
  opportunities: {
    added: string[];
    updated: string[];
    removed: string[];
  };
  decisions: {
    added: string[];
  };
  actions: {
    added: string[];
    updated: string[];
    removed: string[];
  };
  outbox: {
    added: Array<{
      id: string;
      status: string;
    }>;
    updated: Array<{
      id: string;
      fromStatus: string;
      toStatus: string;
    }>;
  };
  audit: {
    addedCount: number;
  };
};

export type ScenarioExpectationResult = {
  resultId: string;
  expectationId: string;
  stepId: string | null;
  type: ScenarioExpectation["type"];
  path: string;
  operator: ScenarioExpectation["operator"];
  expected: unknown;
  actual: unknown;
  passed: boolean;
  messageSafe: string;
};

export type ScenarioInvariantResult = {
  invariantId: string;
  passed: boolean;
  severity: "error" | "warning";
  message: string;
  entityIds: string[];
};

export type ScenarioFollowUpReplayResult = {
  schedulingResult: import("../follow-up-scheduling").FollowUpSchedulingResult | null;
  mutationPlan: FollowUpMutationPlan | null;
  applyResult: FollowUpMutationApplyResult | null;
};

export type ScenarioStepResult = {
  stepId: string;
  index: number;
  title: string;
  inputSummary: ScenarioSafeInputSummary;
  loopResult: AutonomousCommercialLoopResult;
  previousSnapshot: AutonomousLoopRuntimeSnapshot;
  nextSnapshot: AutonomousLoopRuntimeSnapshot;
  stateDiff: ScenarioStateDiff;
  expectationResults: ScenarioExpectationResult[];
  invariantResults: ScenarioInvariantResult[];
  followUpReplay: ScenarioFollowUpReplayResult | null;
  passed: boolean;
};

export type ScenarioExecutionResult = {
  runId: string;
  scenarioId: string;
  scenarioName: string;
  scenarioCategory: ScenarioCategory;
  status: "passed" | "failed" | "invalid" | "partially_passed";
  steps: ScenarioStepResult[];
  summary: {
    totalSteps: number;
    passedSteps: number;
    failedSteps: number;
    totalExpectations: number;
    passedExpectations: number;
    failedExpectations: number;
    totalInvariants: number;
    passedInvariants: number;
    failedInvariants: number;
  };
  finalSnapshot: AutonomousLoopRuntimeSnapshot;
  report: ScenarioSafeReport;
  startedAt: string;
  completedAt: string;
};

export type ScenarioSafeReport = {
  scenario: {
    id: string;
    name: string;
    category: ScenarioCategory;
  };
  result: {
    status: string;
    durationLogicalMs: number;
  };
  steps: Array<{
    stepId: string;
    title: string;
    status: string;
    loopStatus: string;
    actionType: string | null;
    actionStatus: string | null;
    outboxStatus: string | null;
    deliveryStatus: string | null;
    followUpDecision: string | null;
    expectationsPassed: number;
    expectationsFailed: number;
    invariantsFailed: number;
  }>;
  failures: Array<{
    stepId: string;
    code: string;
    messageSafe: string;
  }>;
};

export type ScenarioRuntimeFailureMode =
  | "none"
  | "after_outbox"
  | "after_delivery"
  | "after_follow_up"
  | "after_audit";

export type ScenarioExecutionDependencies = {
  runtime?: import("./inMemoryScenarioRuntime").InMemoryScenarioRuntime;
  loopExecutor?: typeof import("../autonomous-loop").executeAutonomousLoop;
  continueOnStepFailure?: boolean;
  modeOverride?: ScenarioExecutionMode;
  failureMode?: ScenarioRuntimeFailureMode;
};

export type ScenarioCatalogEntry = ScenarioDefinition;

export type ScenarioCatalog = readonly ScenarioCatalogEntry[];

export type ScenarioSimulationFlags = {
  enabled: boolean;
  allowExecuteFake: boolean;
};

export type ScenarioReportExport = {
  runId: string;
  scenarioId: string;
  scenarioName: string;
  report: ScenarioSafeReport;
};

export type ScenarioExecutionModeValue = AutonomousLoopMode;

export type ScenarioExecutionMode = AutonomousLoopMode;
