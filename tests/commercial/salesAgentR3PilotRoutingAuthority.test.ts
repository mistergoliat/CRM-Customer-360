import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle/runNativeAutonomousCycle";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import type { AgentLoopProvider } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";

/**
 * SALES-AGENT-R3-V1.7, task sections 6C/6D/7. Real MariaDB (crm_test), same
 * convention as tests/commercial/runNativeAutonomousCycleOptOut.test.ts.
 *
 * This proves, at the runNativeAutonomousCycle runtime-selection level
 * (never just by reading the source), that:
 *
 *   C. the intended R3 branch is reachable when BRAIN_SALES_AGENT_RUNTIME_ENABLED=true,
 *      the waId is allowlisted, and CommercialWork/multi-request/Agent Tool
 *      Loop are all disabled;
 *   D. with those legacy runtime flags false, no earlier branch preempts
 *      SalesAgentRuntime for the same turn;
 *   7. under the full intended EC2 pilot flag set (R3 on, every legacy
 *      runtime off, the entire R1 dispatch/action-lifecycle stack off),
 *      the turn still routes to SalesAgentRuntime, the R3 cycle runs, and
 *      dispatches through the canonical outbox with zero crm_agent_actions
 *      rows created (the R1 action-queue table CommercialWork/legacy/R1
 *      dispatch would otherwise write to).
 *
 * A plain "respond" script (no tool calls) is used throughout so no catalog
 * HTTP stub or network access of any kind is needed - matching the task's
 * own "no external Meta network access" requirement.
 */
Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true",
  BRAIN_WHATSAPP_TEST_MODE_ENABLED: "false"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

async function withEnv<T>(overrides: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previous = { ...process.env };
  Object.assign(process.env, overrides);
  try {
    return await fn();
  } finally {
    process.env = previous;
  }
}

async function insertConversation(): Promise<{ id: number; publicId: string; waId: string }> {
  const publicId = `conv-r3p-${randomUUID().slice(0, 8)}`;
  const waId = `5699${Date.now()}`.slice(0, 15);
  const [result] = await getPool().execute(
    `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id, status, owner_type, ai_enabled, human_owner_active)
     VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0)`,
    [publicId, `phone-${randomUUID().slice(0, 8)}`, waId]
  );
  return { id: Number((result as { insertId: number }).insertId), publicId, waId };
}

async function countAgentActionsForConversation(conversationId: number): Promise<number> {
  const [rows] = await getPool().execute("SELECT id FROM crm_agent_actions WHERE conversation_case_id = ?", [String(conversationId)]);
  return (rows as unknown[]).length;
}

function respondOnlyProvider(message: string): AgentLoopProvider {
  return createFakeAgentLoopProvider({ script: [{ type: "respond", message }] });
}

/** Every legacy runtime-selection flag runNativeAutonomousCycle checks, explicitly false. */
const LEGACY_RUNTIME_OFF = {
  BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED: "false",
  BRAIN_MULTI_REQUEST_RUNTIME_ENABLED: "false",
  BRAIN_AGENT_TOOL_LOOP_ENABLED: "false",
  BRAIN_MULTI_INTENT_PLANNER_ENABLED: "false",
  BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED: "false"
};

/** The entire R1 action-lifecycle/dispatch stack, explicitly false - none of it is required for R3 to dispatch (V1.5/V1.6's own "false dependency removal" proof, re-verified here one level up at the routing-selection layer). */
const R1_DISPATCH_STACK_OFF = {
  BRAIN_AGENT_ACTION_QUEUE_ENABLED: "false",
  BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "false",
  BRAIN_EXECUTION_GATE_ENABLED: "false",
  BRAIN_OUTBOX_BRIDGE_ENABLED: "false",
  BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "false",
  BRAIN_AUTONOMOUS_REPLY_ENABLED: "false"
};

function r3PilotEnv(waId: string) {
  return {
    ...LEGACY_RUNTIME_OFF,
    BRAIN_SALES_AGENT_RUNTIME_ENABLED: "true",
    BRAIN_SALES_AGENT_RUNTIME_WA_IDS: waId,
    BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true"
  };
}

function assertOnlySalesAgentRuntimeRan(result: Awaited<ReturnType<typeof runNativeAutonomousCycle>>) {
  assert.equal(result.ran, true);
  assert.equal(result.reason, "sales_agent_runtime");
  assert.notEqual(result.salesAgentRuntime, null, "SalesAgentRuntime must have run");
  assert.notEqual(result.salesAgentRuntime, undefined, "SalesAgentRuntime must have run");
  assert.equal(result.commercialWork ?? null, null, "CommercialWork must never run for this turn");
  assert.equal(result.multiRequest ?? null, null, "the multi-request runtime must never run for this turn");
  assert.equal(result.agentLoop ?? null, null, "the Agent Tool Loop (and, transitively, the multi-intent planner) must never run for this turn");
  assert.equal(result.loop, null, "the legacy shadow/operational-loop pipeline must never run for this turn");
  assert.equal(result.shadow, null, "the legacy shadow evaluation must never run for this turn");
  assert.equal(result.bridge, null, "the legacy execution bridge (R1 action queue) must never run for this turn");
}

test("[PR1] C/D: R3 on + allowlisted, CommercialWork/multi-request/ATL/multi-intent/legacy off -> SalesAgentRuntime is authoritative, no earlier branch preempts it", async () => {
  const conversation = await insertConversation();
  const provider = respondOnlyProvider("Hola, en que te puedo ayudar?");

  await withEnv(r3PilotEnv(conversation.waId), async () => {
    const result = await runNativeAutonomousCycle({
      conversationId: conversation.id,
      conversationPublicId: conversation.publicId,
      customerMasterId: null,
      waId: conversation.waId,
      phoneNumberId: "phone-r3-pilot-test",
      messageId: `wamid.r3-pilot.${conversation.id}`,
      messageText: "Hola",
      correlationId: `corr-r3-pilot-${conversation.id}`,
      currentTime: new Date().toISOString(),
      agentLoopProvider: provider
    });

    assertOnlySalesAgentRuntimeRan(result);
    assert.equal(result.salesAgentRuntime!.runtime.status, "responded");
    assert.equal(result.salesAgentRuntime!.dispatch.outboxWritten, true);
  });
});

test("[PR1b] a waId NOT in BRAIN_SALES_AGENT_RUNTIME_WA_IDS never reaches SalesAgentRuntime, even with the flag on (sanity check for PR1's own allowlist gate)", async () => {
  const conversation = await insertConversation();
  const notCalled: AgentLoopProvider = {
    name: "must-not-be-called",
    async invoke() {
      throw new Error("must not be invoked for a non-allowlisted waId");
    }
  };

  await withEnv(
    {
      ...r3PilotEnv("56900000000" /* a different waId than conversation.waId */),
      BRAIN_AUTONOMOUS_TEST_WA_IDS: conversation.waId // otherwise Step 0's own pilot allowlist would short-circuit first and this test would prove nothing about the R3-specific allowlist
    },
    async () => {
      const result = await runNativeAutonomousCycle({
        conversationId: conversation.id,
        conversationPublicId: conversation.publicId,
        customerMasterId: null,
        waId: conversation.waId,
        phoneNumberId: "phone-r3-pilot-test",
        messageId: `wamid.r3-pilot-neg.${conversation.id}`,
        messageText: "Hola",
        correlationId: `corr-r3-pilot-neg-${conversation.id}`,
        currentTime: new Date().toISOString(),
        agentLoopProvider: notCalled
      });

      assert.equal(result.salesAgentRuntime ?? null, null, "SalesAgentRuntime must not run for a waId outside its own allowlist");
      assert.notEqual(result.reason, "sales_agent_runtime");
    }
  );
});

test("[PR2] section 7 productive pilot routing proof: R3 on, every legacy runtime off, the ENTIRE R1 dispatch stack off - still routes to SalesAgentRuntime, R3 cycle runs, zero crm_agent_actions rows", async () => {
  const conversation = await insertConversation();
  const provider = respondOnlyProvider("Claro, contamos con varias opciones.");

  await withEnv({ ...r3PilotEnv(conversation.waId), ...R1_DISPATCH_STACK_OFF }, async () => {
    const result = await runNativeAutonomousCycle({
      conversationId: conversation.id,
      conversationPublicId: conversation.publicId,
      customerMasterId: null,
      waId: conversation.waId,
      phoneNumberId: "phone-r3-pilot-test",
      messageId: `wamid.r3-pilot-full.${conversation.id}`,
      messageText: "Hola, tienen mancuernas?",
      correlationId: `corr-r3-pilot-full-${conversation.id}`,
      currentTime: new Date().toISOString(),
      agentLoopProvider: provider
    });

    assertOnlySalesAgentRuntimeRan(result);
    assert.equal(result.salesAgentRuntime!.runtime.status, "responded");
    assert.equal(result.salesAgentRuntime!.dispatch.outboxWritten, true, "a responded turn must dispatch through the canonical outbox on R3's own flags alone, per V1.5/V1.6");
    assert.equal(await countAgentActionsForConversation(conversation.id), 0, "no R1 action-queue row may ever be created for an R3 turn, with or without the R1 stack enabled");
  });
});
