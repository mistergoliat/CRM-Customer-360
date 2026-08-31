// SALES-AGENT-R3-V1.3. Public barrel for the SalesAgentRuntime boundary.

export { runSalesAgentRuntime, SALES_AGENT_RUNTIME_STATUSES } from "./salesAgentRuntime";
export type { SalesAgentRuntimeInput, SalesAgentRuntimeResult, SalesAgentRuntimeStatus } from "./salesAgentRuntime";

// SALES-AGENT-R3-V1.4. The routing seam's dispatch adapter.
export { runSalesAgentRuntimeCycle } from "./runSalesAgentRuntimeCycle";
export type { RunSalesAgentRuntimeCycleInput, SalesAgentRuntimeCycleResult } from "./runSalesAgentRuntimeCycle";
