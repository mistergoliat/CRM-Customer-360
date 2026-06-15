import type { BrainAgentRunResponse } from "./types";

export type BrainAgentRunLogResult = {
  ok: boolean;
  status: "skipped";
  reason: string;
  logId: string | null;
};

export async function recordBrainAgentRun(response: BrainAgentRunResponse): Promise<BrainAgentRunLogResult> {
  void response;

  return {
    ok: true,
    status: "skipped",
    reason: "Agent run logging is a no-op until a safe backend table is approved.",
    logId: null
  };
}
