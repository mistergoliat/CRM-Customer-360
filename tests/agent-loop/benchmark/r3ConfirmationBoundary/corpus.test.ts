import assert from "node:assert/strict";
import test from "node:test";
import { SEMANTICS_SCENARIOS } from "@/lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/semanticsCorpus";
import { interleavedScenarioIds, isActionableGroup, REPLICATION_GROUPS, REPLICATION_SCENARIOS, REPLICATION_SCENARIO_IDS, scenarioById, toBenchmarkCase, turnAnnotations } from "@/lib/brain/commercial/agent-loop/benchmark/r3ConfirmationBoundary/corpus";

/**
 * SALES-AGENT-R3-P7.11. Pure/in-memory: corpus shape, group distribution, no exact-message
 * duplication with the P7.10 corpus, no accidental ambiguity, and multi-turn facts-completion
 * metadata (group B: product always resolvable from the customer's own text, never the
 * assistant's reply).
 */

test("P7.11: exactly 48 scenarios, distributed A12/B12/C6/D6/E8/F4", () => {
  assert.equal(REPLICATION_SCENARIOS.length, 48);
  const counts = Object.fromEntries(REPLICATION_GROUPS.map((group) => [group, REPLICATION_SCENARIOS.filter((scenario) => scenario.group === group).length]));
  assert.deepEqual(counts, { A: 12, B: 12, C: 6, D: 6, E: 8, F: 4 });
  assert.equal(new Set(REPLICATION_SCENARIO_IDS).size, 48, "unique caseIds");
});

test("P7.11: 72 turns total (48 single-turn groups except B, which has 3 turns x 12)", () => {
  const totalTurns = REPLICATION_SCENARIOS.reduce((sum, scenario) => sum + scenario.turns.length, 0);
  assert.equal(totalTurns, 12 + 12 * 3 + 6 + 6 + 8 + 4);
  for (const scenario of REPLICATION_SCENARIOS.filter((entry) => entry.group === "B")) assert.equal(scenario.turns.length, 3, `${scenario.caseId}: group B is 3 turns`);
  for (const scenario of REPLICATION_SCENARIOS.filter((entry) => entry.group !== "B")) assert.equal(scenario.turns.length, 1, `${scenario.caseId}: single turn`);
});

test("P7.11: no scenario message is an exact string duplicate of any P7.10 corpus message", () => {
  const p710Messages = new Set(SEMANTICS_SCENARIOS.flatMap((scenario) => scenario.turns));
  for (const scenario of REPLICATION_SCENARIOS) for (const turn of scenario.turns) assert.equal(p710Messages.has(turn), false, `${scenario.caseId}: "${turn}" duplicates a P7.10 message verbatim`);
});

test("P7.11: no message is duplicated within the P7.11 corpus itself", () => {
  const messages = REPLICATION_SCENARIOS.flatMap((scenario) => scenario.turns);
  assert.equal(new Set(messages).size, messages.length);
});

test("P7.11: every actionable group (A, B, C, D, F) scenario declares exactly one expected item with a fixture product and a positive integer quantity", () => {
  for (const scenario of REPLICATION_SCENARIOS) {
    if (!isActionableGroup(scenario.group)) continue;
    assert.ok(scenario.expected, `${scenario.caseId}: expected required`);
    assert.equal(scenario.expected!.length, 1, `${scenario.caseId}: exactly one expected item`);
    const [item] = scenario.expected!;
    assert.ok(["31", "32"].includes(item.productId), `${scenario.caseId}: fixture product`);
    assert.ok(Number.isInteger(item.quantity) && item.quantity > 0, `${scenario.caseId}: positive integer quantity`);
  }
});

test("P7.11: group E (informational) scenarios declare no expected item and are not actionable", () => {
  for (const scenario of REPLICATION_SCENARIOS.filter((entry) => entry.group === "E")) {
    assert.equal(scenario.expected, undefined, `${scenario.caseId}: no expected item`);
    assert.equal(isActionableGroup(scenario.group), false);
  }
});

test("P7.11: group A/C/D/E/F messages carry the product noun ('barra') at first mention - no accidental bare-'Pro'/bare-'Classic' ambiguity", () => {
  for (const scenario of REPLICATION_SCENARIOS.filter((entry) => entry.group !== "B")) {
    for (const turn of scenario.turns) {
      if (/\b(classic|pro)\b/i.test(turn)) assert.ok(/barras?\s+(classic|pro)\b/i.test(turn) || /\bde\s+esas?\b/i.test(turn), `${scenario.caseId}: "${turn}" names a product without the disambiguating noun`);
    }
  }
});

test("P7.11: group B - the product is always named by the customer (never inferred from the assistant) in turn 1 or turn 2, with the 'barra' noun; turn 3 (the analysed turn) states only the quantity", () => {
  for (const scenario of REPLICATION_SCENARIOS.filter((entry) => entry.group === "B")) {
    const [t1, t2, t3] = scenario.turns;
    const namesProduct = (text: string) => /barras?\s+(classic|pro)\b/i.test(text);
    assert.ok(namesProduct(t1) || namesProduct(t2), `${scenario.caseId}: product must be named by the customer in turn 1 or 2`);
    assert.equal(namesProduct(t3), false, `${scenario.caseId}: turn 3 must not (re)name the product - it should only state the quantity`);
    assert.ok(/\d+|una?|dos|tres|cuatro|cinco/i.test(t3), `${scenario.caseId}: turn 3 states a quantity`);
  }
});

test("P7.11: F (correction/replacement) scenarios seed a durable selection different from the expectation", () => {
  for (const scenario of REPLICATION_SCENARIOS.filter((entry) => entry.group === "F")) {
    assert.ok(scenario.seedSelection && scenario.seedSelection.length === 1, `${scenario.caseId}: seeded selection`);
    const seed = scenario.seedSelection![0];
    const expected = scenario.expected![0];
    assert.ok(seed.productId !== expected.productId || seed.quantity !== expected.quantity, `${scenario.caseId}: the correction must actually change something`);
  }
});

test("P7.11: turnAnnotations - context turns are 'other', the last turn carries the group semantics (explicit_purchase with the declared quantity, or informational for E); D carries create_quote as a commit alternative", () => {
  for (const scenario of REPLICATION_SCENARIOS) {
    const annotations = turnAnnotations(scenario);
    assert.equal(annotations.length, scenario.turns.length);
    for (const context of annotations.slice(0, -1)) assert.equal(context.kind, "other");
    const last = annotations[annotations.length - 1];
    if (scenario.group === "E") assert.equal(last.kind, "informational");
    else {
      assert.equal(last.kind, "explicit_purchase");
      if (last.kind === "explicit_purchase") {
        assert.equal(last.statedQuantity, scenario.expected![0].quantity);
        assert.deepEqual(last.commitAlternatives, scenario.group === "D" ? ["create_quote"] : undefined);
      }
    }
  }
});

test("P7.11: interleavedScenarioIds visits every scenario exactly once, round-robin across the six groups", () => {
  const ids = interleavedScenarioIds();
  assert.equal(ids.length, 48);
  assert.equal(new Set(ids).size, 48);
  assert.deepEqual([...ids].sort(), [...REPLICATION_SCENARIO_IDS].sort());
  assert.deepEqual(ids.slice(0, 6).map((id) => scenarioById(id).group), ["A", "B", "C", "D", "E", "F"]);
});

test("P7.11: scenarioById resolves every declared id and rejects an unknown one", () => {
  for (const id of REPLICATION_SCENARIO_IDS) assert.equal(scenarioById(id).caseId, id);
  assert.throws(() => scenarioById("NOT_A_SCENARIO"));
});

test("P7.11: toBenchmarkCase renders every turn with an offline script and seeds F scenarios' initial selection", () => {
  for (const scenario of REPLICATION_SCENARIOS) {
    const benchmarkCase = toBenchmarkCase(scenario);
    assert.equal(benchmarkCase.caseId, scenario.caseId);
    assert.equal(benchmarkCase.turns.length, scenario.turns.length);
    for (const turn of benchmarkCase.turns) assert.ok(turn.offlineScript.length > 0);
    assert.equal(typeof benchmarkCase.setup, scenario.seedSelection ? "function" : "undefined");
  }
});
