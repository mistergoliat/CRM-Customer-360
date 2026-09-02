// SALES-AGENT-R3-V1.8-D2. Single lazy-singleton accessor for the real,
// MariaDB-backed AgentSessionStore - extracted from shadowRecorder.ts (the
// only place that needed it before this task) now that salesAgentRuntime.ts
// and runSalesAgentRuntimeCycle.ts also need "the real store when the caller
// did not inject one." One shared instance, never three independent ones
// that could be reset inconsistently across tests.

import { createMariaDbAgentSessionStore } from "./mariaDbAgentSessionStore";
import type { AgentSessionStore } from "./store";

let defaultStore: AgentSessionStore | null = null;

export function getDefaultAgentSessionStore(): AgentSessionStore {
  if (!defaultStore) defaultStore = createMariaDbAgentSessionStore();
  return defaultStore;
}

/** Test-only: force the next call to getDefaultAgentSessionStore() to construct a fresh store (e.g. after resetPoolForTests()). */
export function resetDefaultAgentSessionStoreForTests(): void {
  defaultStore = null;
}
