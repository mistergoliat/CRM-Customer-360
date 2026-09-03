// SALES-AGENT-R3-V1.3. Public barrel for the SalesAgentRuntime boundary.

export { runSalesAgentRuntime, SALES_AGENT_RUNTIME_STATUSES } from "./salesAgentRuntime";
export type { SalesAgentRuntimeInput, SalesAgentRuntimeResult, SalesAgentRuntimeStatus } from "./salesAgentRuntime";

// SALES-AGENT-R3-V1.4. The routing seam's dispatch adapter.
export { runSalesAgentRuntimeCycle, buildMinimalCommercialContextSummary } from "./runSalesAgentRuntimeCycle";
export type { RunSalesAgentRuntimeCycleInput, SalesAgentRuntimeCycleResult, SalesAgentRuntimeDispatchResult } from "./runSalesAgentRuntimeCycle";

// SALES-AGENT-R3-V1.5. The R3-native response dispatcher for terminalReason
// "responded" - independent of the R1 dispatch stack (dispatchAgentLoopResponse).
export { dispatchSalesAgentResponse, SALES_AGENT_RESPONSE_DISPATCHER_VERSION } from "./dispatchSalesAgentResponse";
export type { DispatchSalesAgentResponseInput, DispatchSalesAgentResponseResult, DispatchSalesAgentResponseReason } from "./dispatchSalesAgentResponse";

// SALES-AGENT-R3-V1.6. The shared governed-dispatch primitive, the
// technical-failure/ambiguous-handoff fallback dispatcher, the HARD_HANDOFF
// dispatcher (+ its eligibility gate), and the single terminal-outcome router
// runSalesAgentRuntimeCycle.ts now calls for every terminalReason.
export { dispatchGovernedSalesAgentMessage, buildSalesAgentR3DedupeKey } from "./dispatchGovernedSalesAgentMessage";
export type { DispatchGovernedSalesAgentMessageInput, DispatchGovernedSalesAgentMessageResult, DispatchGovernedSalesAgentMessageReason } from "./dispatchGovernedSalesAgentMessage";

export { dispatchSalesAgentFallback, SALES_AGENT_FALLBACK_DISPATCHER_VERSION } from "./dispatchSalesAgentFallback";
export type { DispatchSalesAgentFallbackInput, DispatchSalesAgentFallbackResult, DispatchSalesAgentFallbackReason, SalesAgentFallbackTerminalReason } from "./dispatchSalesAgentFallback";

export {
  dispatchSalesAgentHardHandoff,
  classifyHardHandoffEligibility,
  HARD_HANDOFF_ELIGIBLE_REASON_CODES,
  SALES_AGENT_HARD_HANDOFF_DISPATCHER_VERSION
} from "./dispatchSalesAgentHardHandoff";
export type { DispatchSalesAgentHardHandoffInput, DispatchSalesAgentHardHandoffResult, HardHandoffEligibility, HardHandoffEligibleReasonCode } from "./dispatchSalesAgentHardHandoff";

export { dispatchSalesAgentTerminalOutcome, SALES_AGENT_TERMINAL_DISPATCHER_VERSION } from "./dispatchSalesAgentTerminalOutcome";
export type { DispatchSalesAgentTerminalOutcomeInput, DispatchSalesAgentTerminalOutcomeResult } from "./dispatchSalesAgentTerminalOutcome";
