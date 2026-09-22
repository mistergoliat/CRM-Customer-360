import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { buildOneShotFaultExecutor } from "@/lib/brain/commercial/agent-loop/benchmark/r3ConversationalSoak/faultInjection";
import { createSoakSession, attachModel, runSoakTurn, teardownSoakSession } from "@/lib/brain/commercial/agent-loop/benchmark/r3ConversationalSoak/soakSession";
import { buildSoakSurface } from "@/lib/brain/commercial/agent-loop/benchmark/r3ConversationalSoak/surface";
import { createScriptedNativeModel } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/scriptedNativeModel";
import { buildSoakArtifactFiles, runSoak } from "@/lib/brain/commercial/agent-loop/benchmark/r3ConversationalSoak/runSoak";

/**
 * SALES-AGENT-R3-P7.12. DB-backed, OFFLINE (scripted native model, no LLM) tests against the real
 * Capability Gateway and crm_test. They prove WIRING: the turn-level session driver
 * (soakSession.ts) reaches the real Gateway exactly like runTrueHarnessCase, the one-shot fault
 * injector really is one-shot, cross-conversation isolation holds, and the artifact bundle is
 * well-formed. Behavior is measured live (script + docs/audits/r3-p7-12-...).
 */
Object.assign(process.env, {
  NODE_ENV: "test",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "crm_test",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

const surface = buildSoakSurface();
const selectClassic2 = { kind: "use_tool" as const, tool: "select_products", arguments: { items: [{ productId: "31", quantity: 2 }] } };
const groundClassic = { kind: "use_tool" as const, tool: "get_product_details", arguments: { productId: "31" } };
const respond = { kind: "respond" as const, message: "listo" };

test("P7.12 soakSession: one turn reaches the real Capability Gateway (audit rows + durable state), same as runTrueHarnessCase", async () => {
  const session = await createSoakSession({ label: "T1", identityLevel: "LEVEL_2_MASTER_RESOLVED", benchmarkRunId: `soak-test-${Date.now()}` });
  attachModel(session, createScriptedNativeModel([groundClassic, selectClassic2, respond]));
  try {
    const turn = await runSoakTurn(session, "quiero dos Classic", { surface, timeoutMs: 60000 });
    const select = turn.toolInvocations.find((invocation) => invocation.capability === "select_products");
    assert.equal(select?.gateway?.status, "completed");
    assert.deepEqual(turn.durableStateAfterTurn?.selection.items, [{ productId: "31", quantity: 2 }]);
    const rows = await queryRows<{ capability_name: string }>("SELECT capability_name FROM crm_capability_executions WHERE correlation_id = ? ORDER BY id ASC", [turn.correlationId]);
    assert.deepEqual(rows.map((row) => row.capability_name), ["get_product_details", "select_products"]);
  } finally {
    await teardownSoakSession(session);
  }
});

test("P7.12 soakSession: TWO turns on the SAME session share durable state and history (turn 2 sees turn 1's selection)", async () => {
  const session = await createSoakSession({ label: "T2", identityLevel: "LEVEL_2_MASTER_RESOLVED", benchmarkRunId: `soak-test-${Date.now()}` });
  attachModel(session, createScriptedNativeModel([groundClassic, selectClassic2, respond, respond]));
  try {
    await runSoakTurn(session, "quiero dos Classic", { surface, timeoutMs: 60000 });
    const second = await runSoakTurn(session, "gracias", { surface, timeoutMs: 60000 });
    assert.equal(second.turnOrdinal, 1);
    assert.deepEqual(second.durableStateBeforeTurn?.selection.items, [{ productId: "31", quantity: 2 }]);
    assert.deepEqual(second.durableStateAfterTurn?.selection.items, [{ productId: "31", quantity: 2 }], "unchanged - the second turn issued no mutating call");
    assert.equal(session.history.filter((message) => message.role === "user").length, 2);
  } finally {
    await teardownSoakSession(session);
  }
});

test("P7.12 fault injection: a one-shot fault on get_product_details blocks the SAME turn's select_products (evidence never observed); the NEXT turn is unaffected (truly one-shot)", async () => {
  const session = await createSoakSession({ label: "T3", identityLevel: "LEVEL_2_MASTER_RESOLVED", benchmarkRunId: `soak-test-${Date.now()}` });
  attachModel(session, createScriptedNativeModel([groundClassic, selectClassic2, respond, groundClassic, selectClassic2, respond]));
  try {
    const faulted = await runSoakTurn(session, "quiero dos Classic", { surface, timeoutMs: 60000, executeCapability: buildOneShotFaultExecutor({ targetCapability: "get_product_details", kind: "CATALOG_TIMEOUT" }) });
    const groundedCall = faulted.toolInvocations.find((invocation) => invocation.capability === "get_product_details");
    assert.equal(groundedCall?.gateway?.errorCode, "catalog_service_unavailable");
    const selectCall = faulted.toolInvocations.find((invocation) => invocation.capability === "select_products");
    assert.notEqual(selectCall?.toolObservation.status, "completed", "select_products must not complete without observed evidence in this turn");

    const clean = await runSoakTurn(session, "dale, de nuevo", { surface, timeoutMs: 60000 });
    const cleanGround = clean.toolInvocations.find((invocation) => invocation.capability === "get_product_details");
    assert.equal(cleanGround?.gateway?.status, "completed", "the fault does not leak into the next turn");
    assert.deepEqual(clean.durableStateAfterTurn?.selection.items, [{ productId: "31", quantity: 2 }]);
  } finally {
    await teardownSoakSession(session);
  }
});

test("P7.12 fault injection: a call to a DIFFERENT capability than the target is never faulted", async () => {
  const session = await createSoakSession({ label: "T4", identityLevel: "LEVEL_2_MASTER_RESOLVED", benchmarkRunId: `soak-test-${Date.now()}` });
  attachModel(session, createScriptedNativeModel([groundClassic, selectClassic2, respond]));
  try {
    const turn = await runSoakTurn(session, "quiero dos Classic", { surface, timeoutMs: 60000, executeCapability: buildOneShotFaultExecutor({ targetCapability: "create_quote", kind: "REGISTRY_MISMATCH" }) });
    const ground = turn.toolInvocations.find((invocation) => invocation.capability === "get_product_details");
    const select = turn.toolInvocations.find((invocation) => invocation.capability === "select_products");
    assert.equal(ground?.gateway?.status, "completed");
    assert.equal(select?.gateway?.status, "completed");
  } finally {
    await teardownSoakSession(session);
  }
});

test("P7.12 runSoak: offline, a small slice of the frozen plan across all 3 conversations - isolation holds, no HARD_FAILURE from harness wiring alone", async () => {
  const result = await runSoak({ mode: "offline", maxTurns: 9, maxWallClockMs: 5 * 60 * 1000 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.crossConversationLeak, false);
  assert.equal(result.isolationCheck.ok, true);
  assert.equal(result.allTurns.length, 9);
  assert.deepEqual(new Set(result.allTurns.map((turn) => turn.conversation)), new Set(["A", "B", "C"]));
  assert.equal(result.hardFailure, null);
  assert.equal(result.planExhausted, true);
});

test("P7.12 runSoak: cycles repeats the SAME frozen plan back to back on the same persistent sessions (mechanical replay, never new content) - crossing the plan-length boundary restarts conversation A's first message, sequenceIndex stays monotonic", async () => {
  const oneCycleLength = 183; // STRESS_PLAN.length (asserted structurally in stressPlan.test.ts)
  const result = await runSoak({ mode: "offline", maxTurns: oneCycleLength + 3, maxWallClockMs: 10 * 60 * 1000, cycles: 2 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.allTurns.length, oneCycleLength + 3);
  // allTurns is grouped by conversation (A's turns, then B's, then C's), so sequenceIndex is monotonic WITHIN each group, not across the flattened array; check the full set covers 0..N-1 exactly once.
  assert.deepEqual([...result.allTurns.map((t) => t.sequenceIndex)].sort((a, b) => a - b), result.allTurns.map((_t, i) => i));
  const boundary = result.allTurns.find((t) => t.sequenceIndex === oneCycleLength)!; // first turn of cycle 2
  assert.equal(boundary.conversation, "A");
  assert.equal(boundary.message, "Estoy viendo barras olimpicas");
});

test("P7.12 runSoak: the wall-clock ceiling stops the soak before the plan is exhausted (planExhausted=false), never a HARD_FAILURE by itself", async () => {
  const result = await runSoak({ mode: "offline", maxTurns: 9, maxWallClockMs: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.planExhausted, false);
  assert.equal(result.hardFailure, null);
});

test("P7.12 artifacts: the ten files, all JSON/JSONL parseable, manifest carries phase/S1 note/plan sizing, summary carries a valid robustness signal", async () => {
  const result = await runSoak({ mode: "offline", maxTurns: 9, maxWallClockMs: 5 * 60 * 1000 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const files = buildSoakArtifactFiles(result);
  assert.deepEqual(Object.keys(files).sort(), ["execution-plan.json", "failures.jsonl", "gateway-events.jsonl", "invariants.jsonl", "manifest.json", "provider-metrics.json", "state-snapshots.jsonl", "summary.json", "tool-calls.jsonl", "turns.jsonl"]);
  const manifest = JSON.parse(files["manifest.json"]);
  assert.equal(manifest.phase, "P7.12");
  assert.ok(manifest.harness.note.includes("S1"));
  assert.equal(manifest.plan.total, 9);
  const turnLines = files["turns.jsonl"].split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(turnLines.length, 9);
  for (const line of turnLines) assert.ok(["A", "B", "C"].includes(line.conversation));
  const invariantLines = files["invariants.jsonl"].split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(invariantLines.length >= 9 * 4, "at least the structural checks ran for every turn");
  const summary = JSON.parse(files["summary.json"]);
  assert.ok(["ROBUSTNESS_PASS", "ROBUSTNESS_PASS_WITH_RESIDUALS", "ROBUSTNESS_FAIL"].includes(summary.robustness.signal));
  assert.equal(summary.totalTurns, 9);
  assert.equal(files["execution-plan.json"].length > 0, true);
  JSON.parse(files["execution-plan.json"]); // parseable
  assert.equal(files["turns.jsonl"].includes("requestMessages"), false, "no full prompts in artifacts");
});

test("P7.12: static - the soak orchestration reuses the P7.8-R/P7.10/P7.11 true harness only (no R3 loop, no P4/P5/P6, no own executor)", () => {
  const DIR = join(process.cwd(), "lib/brain/commercial/agent-loop/benchmark/r3ConversationalSoak");
  const importsOf = (source: string) => [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  for (const file of ["soakSession.ts", "runSoak.ts", "stressPlan.ts", "analysis.ts", "invariants.ts", "faultInjection.ts"]) {
    const source = readFileSync(join(DIR, file), "utf8");
    for (const specifier of importsOf(source)) for (const pattern of [/runAgentToolLoop/, /buildAgentStepPromptPackage/, /validateAgentStep/, /agentStepTypes\/runAgentToolLoop/, /sales-agent-runtime/, /commercial-proposal/]) assert.equal(pattern.test(specifier), false, `${file} must not import ${specifier}`);
  }
  const session = readFileSync(join(DIR, "soakSession.ts"), "utf8");
  assert.ok(importsOf(session).includes("../r3TrueAB/trueHarnessLoop"), "the session driver goes through runTrueHarnessTurn (own loop -> Capability Gateway)");
});
