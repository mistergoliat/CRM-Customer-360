"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordBrainAgentRun = recordBrainAgentRun;
async function recordBrainAgentRun(response) {
    void response;
    return {
        ok: true,
        status: "skipped",
        reason: "Agent run logging is a no-op until a safe backend table is approved.",
        logId: null
    };
}
