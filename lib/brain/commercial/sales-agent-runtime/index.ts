// SALES-AGENT-R3-V1.3. Public barrel for the SalesAgentRuntime boundary.

export { runSalesAgentRuntime, SALES_AGENT_RUNTIME_STATUSES } from "./salesAgentRuntime";
export type { SalesAgentRuntimeInput, SalesAgentRuntimeResult, SalesAgentRuntimeStatus } from "./salesAgentRuntime";

// SALES-AGENT-R3-V1.4. The routing seam's dispatch adapter.
export { runSalesAgentRuntimeCycle } from "./runSalesAgentRuntimeCycle";
export type { RunSalesAgentRuntimeCycleInput, SalesAgentRuntimeCycleResult } from "./runSalesAgentRuntimeCycle";

// SALES-AGENT-R3-V1.5. The R3-native response dispatcher for terminalReason
// "responded" - independent of the R1 dispatch stack (dispatchAgentLoopResponse).
export { dispatchSalesAgentResponse, SALES_AGENT_RESPONSE_DISPATCHER_VERSION } from "./dispatchSalesAgentResponse";
export type { DispatchSalesAgentResponseInput, DispatchSalesAgentResponseResult, DispatchSalesAgentResponseReason } from "./dispatchSalesAgentResponse";
