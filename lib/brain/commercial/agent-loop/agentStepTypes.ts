/**
 * ACS-R1-05.1-T02.1 (Native Read-Only Agent Tool Loop). Minimal per-step
 * contract: the model answers exactly one question per call - "what is the
 * next step?" - never a full commercial document. Kept intentionally small;
 * do not add variants without a demonstrated need from real runtime code
 * (see docs/product/sales-agent-contract.md for why the older, monolithic
 * SalesAgentOutput contract is not extended for this loop).
 */

export const AGENT_STEP_TYPES = ["use_tool", "respond", "handoff"] as const;
export type AgentStepType = (typeof AGENT_STEP_TYPES)[number];

export type AgentStepUseTool = {
  type: "use_tool";
  tool: string;
  arguments: Record<string, unknown>;
};

export type AgentStepRespond = {
  type: "respond";
  message: string;
};

export type AgentStepHandoff = {
  type: "handoff";
  reason: string;
};

export type AgentStep = AgentStepUseTool | AgentStepRespond | AgentStepHandoff;

export const TOOL_OBSERVATION_STATUSES = ["completed", "failed", "blocked"] as const;
export type ToolObservationStatus = (typeof TOOL_OBSERVATION_STATUSES)[number];

/**
 * Structured, bounded and safe to feed back to the model. Never carries
 * credentials, full internal payloads, raw errors, SQL, or unrequested data -
 * see buildToolObservation.ts for the allowlisted projection per capability.
 */
export type ToolObservation = {
  tool: string;
  status: ToolObservationStatus;
  data?: unknown;
  errorCode?: string;
};

export const AGENT_LOOP_TERMINAL_REASONS = [
  "responded",
  "handoff",
  "max_steps_exceeded",
  "invalid_output",
  "provider_unavailable",
  "timeout"
] as const;
export type AgentLoopTerminalReason = (typeof AGENT_LOOP_TERMINAL_REASONS)[number];

export type AgentLoopStepRecord = {
  stepIndex: number;
  step: AgentStep;
  /** Governance verdict for use_tool steps only; null for respond/handoff. */
  governance: "authorized" | "blocked_unregistered" | "blocked_unauthorized" | "blocked_duplicate" | null;
  observation: ToolObservation | null;
};

export type AgentLoopResult = {
  ran: boolean;
  terminalReason: AgentLoopTerminalReason;
  steps: AgentLoopStepRecord[];
  toolExecutionCount: number;
  finalMessage: string | null;
  handoffReason: string | null;
  warnings: string[];
};
