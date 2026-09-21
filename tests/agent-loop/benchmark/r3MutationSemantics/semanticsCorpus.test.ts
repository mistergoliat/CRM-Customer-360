import assert from "node:assert/strict";
import test from "node:test";
import { buildCurrentToolSurface } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/toolSurface";
import { buildTrueHarnessSystemPrompt } from "@/lib/brain/commercial/agent-loop/benchmark/r3TrueAB/trueHarnessPrompt";
import { SALES_AGENT_CONFIGURATION_SAFE_DEFAULT } from "@/lib/brain/commercial/sales-agent-configuration";
import { isActionableGroup, SEMANTICS_ANNOTATION_RESOLVER, SEMANTICS_SCENARIOS, SPEECH_ACT_GROUPS, scenarioById, toBenchmarkCase, turnAnnotations, type SpeechActGroup } from "@/lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/semanticsCorpus";
import { S1_CONSEQUENCE_TEXT, SEMANTICS_VARIANT_IDS } from "@/lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/semanticsSurfaces";
import { buildSemanticsPlan, interleavedScenarioIds } from "@/lib/brain/commercial/agent-loop/benchmark/r3MutationSemantics/runSemantics";

const ofGroup = (group: SpeechActGroup) => SEMANTICS_SCENARIOS.filter((scenario) => scenario.group === group);
const lastTurn = (caseId: string) => scenarioById(caseId).turns[scenarioById(caseId).turns.length - 1];

test("P7.10 corpus: 46 scenarios stratified 12 D / 8 I / 8 Q / 8 N / 6 F / 4 R, unique ids", () => {
  assert.equal(SEMANTICS_SCENARIOS.length, 46);
  assert.deepEqual(Object.fromEntries(SPEECH_ACT_GROUPS.map((group) => [group, ofGroup(group).length])), { D: 12, I: 8, Q: 8, N: 8, F: 6, R: 4 });
  assert.equal(new Set(SEMANTICS_SCENARIOS.map((scenario) => scenario.caseId)).size, 46);
});

test("P7.10 corpus: every non-N scenario is ACTIONABLE by construction (declared expectation, quantity named in the message, product identifiable) and no N scenario is", () => {
  const quantityToken: Record<number, RegExp> = { 1: /\b(una?|1)\b/i, 2: /\b(dos|2)\b/i, 3: /\b(tres|3)\b/i, 4: /\b(cuatro|4)\b/i, 5: /\b(cinco|5)\b/i };
  for (const scenario of SEMANTICS_SCENARIOS) {
    assert.equal(isActionableGroup(scenario.group), scenario.group !== "N");
    if (scenario.group === "N") {
      assert.equal(scenario.expected, undefined, scenario.caseId);
      assert.equal(scenario.turns.length, 1);
      assert.ok(lastTurn(scenario.caseId).includes("?"), `${scenario.caseId} is a question`);
      continue;
    }
    assert.equal(scenario.expected?.length, 1, scenario.caseId);
    const expected = scenario.expected![0];
    assert.ok(quantityToken[expected.quantity].test(lastTurn(scenario.caseId)), `${scenario.caseId}: the last turn states quantity ${expected.quantity}`);
    if (!scenario.productFromContext) assert.ok((expected.productId === "31" ? /classic/i : /\bpro\b/i).test(scenario.turns.join(" ")), `${scenario.caseId}: the product is named in the conversation`);
  }
});

test("P7.10 corpus: no intentionally ambiguous phrasing in the main corpus", () => {
  for (const scenario of SEMANTICS_SCENARIOS.filter((entry) => entry.group !== "N")) assert.equal(/\bcreo\b|quiz[aá]s?|puede ser|estoy entre|dud|no s[eé]|\bo\b/i.test(lastTurn(scenario.caseId)), false, scenario.caseId);
});

test("P7.10 corpus: D is declarative (no imperative or quote verb), I is imperative, Q is quote-action, D >= 12 / I >= 8 / Q >= 8 / N >= 8", () => {
  const imperative = /agr[eé]g|\bpon(me)?\b|\bdeja\b|a[nñ]ad|s[uú]ma|an[oó]ta/i;
  const quote = /cot[ií]z/i;
  for (const scenario of ofGroup("D")) {
    assert.equal(imperative.test(lastTurn(scenario.caseId)) || quote.test(lastTurn(scenario.caseId)), false, scenario.caseId);
    assert.ok(/quiero|necesito|me llevo|prefiero|quisiera|me quedo|voy a llevar|me gustar[ií]a/i.test(lastTurn(scenario.caseId)), `${scenario.caseId} expresses a desire`);
  }
  for (const scenario of ofGroup("I")) assert.ok(imperative.test(lastTurn(scenario.caseId)), scenario.caseId);
  for (const scenario of ofGroup("Q")) {
    assert.ok(quote.test(lastTurn(scenario.caseId)), scenario.caseId);
    assert.equal(scenario.identityLevel, "LEVEL_2_MASTER_RESOLVED");
  }
  assert.ok(ofGroup("D").length >= 12 && ofGroup("I").length >= 8 && ofGroup("Q").length >= 8 && ofGroup("N").length >= 8);
});

test("P7.10 corpus: follow-ups need >= 2 turns with the facts complete on the last one; replacements seed a durable selection and expect an exact final selection", () => {
  assert.ok(ofGroup("F").length >= 6);
  for (const scenario of ofGroup("F")) assert.ok(scenario.turns.length >= 2, scenario.caseId);
  assert.deepEqual(ofGroup("F").filter((scenario) => scenario.productFromContext).map((scenario) => scenario.caseId), ["F01"]);
  assert.ok(ofGroup("R").length >= 4);
  for (const scenario of ofGroup("R")) {
    assert.ok((scenario.seedSelection?.length ?? 0) >= 1, scenario.caseId);
    assert.deepEqual(scenario.seedSelection?.length === 1 && scenario.expected?.length === 1, true);
    assert.notDeepEqual(scenario.seedSelection?.[0], scenario.expected?.[0], `${scenario.caseId}: the expectation differs from the seed`);
  }
});

test("P7.10 corpus: the only bare 'Pro' names are the two flagged fixture-limitation scenarios", () => {
  const bare = SEMANTICS_SCENARIOS.filter((scenario) => /\bPro\b/.test(lastTurn(scenario.caseId)) && !/barras?\s+(olímpicas?\s+)?Pro/i.test(lastTurn(scenario.caseId)) && scenario.group !== "N" && scenario.group !== "F" && scenario.group !== "R");
  assert.deepEqual(bare.map((scenario) => scenario.caseId).sort(), ["D03", "D05"]);
  for (const scenario of bare) assert.deepEqual(scenario.fixtureFlags, ["bare_pro_name"]);
});

test("P7.10 corpus: no message is copied from the prompt or the tool contracts", () => {
  const haystack = [buildTrueHarnessSystemPrompt(SALES_AGENT_CONFIGURATION_SAFE_DEFAULT), S1_CONSEQUENCE_TEXT, ...buildCurrentToolSurface().tools.map((entry) => entry.description)].join("\n").toLowerCase();
  for (const scenario of SEMANTICS_SCENARIOS) for (const turn of scenario.turns) assert.equal(haystack.includes(turn.toLowerCase().replace(/[¿?]/g, "")), false, scenario.caseId);
});

test("P7.10 corpus: annotations are declared per scenario - context turns `other`, the last turn carries the group semantics", () => {
  for (const scenario of SEMANTICS_SCENARIOS) {
    const annotations = turnAnnotations(scenario);
    assert.equal(annotations.length, scenario.turns.length);
    assert.ok(annotations.slice(0, -1).every((annotation) => annotation.kind === "other"));
    const last = annotations[annotations.length - 1];
    if (scenario.group === "N") assert.equal(last.kind, "informational");
    else assert.deepEqual([last.kind, last.kind === "explicit_purchase" ? last.statedQuantity : null], ["explicit_purchase", scenario.expected![0].quantity]);
    assert.deepEqual(SEMANTICS_ANNOTATION_RESOLVER.annotationFor(scenario.caseId, scenario.turns.length - 1), last);
  }
});

test("P7.10 corpus: every scenario converts to a benchmark case with the seeded setup only where declared", () => {
  for (const scenario of SEMANTICS_SCENARIOS) {
    const testCase = toBenchmarkCase(scenario);
    assert.equal(testCase.turns.length, scenario.turns.length);
    assert.equal(testCase.setup !== undefined, scenario.seedSelection !== undefined, scenario.caseId);
    assert.deepEqual(testCase.turns.map((turn) => turn.customerMessage), scenario.turns);
  }
});

test("P7.10 plan: 46 x 3 x 3 = 414 runs, S0/S1/S2 interleaved back to back per (scenario, run), the first arm rotates deterministically, runs of a scenario are spread out", () => {
  const ids = interleavedScenarioIds();
  assert.equal(ids.length, 46);
  assert.equal(new Set(ids).size, 46);
  assert.deepEqual(ids.slice(0, 6), ["D01", "IM01", "Q01", "N01", "F01", "R01"], "round-robin across speech acts");
  const plan = buildSemanticsPlan(ids, 3);
  assert.equal(plan.length, 414);
  assert.deepEqual(plan, buildSemanticsPlan(ids, 3), "deterministic");
  for (let index = 0; index < plan.length; index += 3) {
    assert.equal(plan[index].pairId, plan[index + 1].pairId);
    assert.equal(plan[index].pairId, plan[index + 2].pairId, "the three variants of a group run back to back");
    assert.deepEqual([plan[index].positionInGroup, plan[index + 1].positionInGroup, plan[index + 2].positionInGroup], [0, 1, 2]);
    assert.equal(new Set([plan[index].variant, plan[index + 1].variant, plan[index + 2].variant]).size, 3);
  }
  const leaders = plan.filter((entry) => entry.positionInGroup === 0);
  assert.equal(leaders.length, 138);
  for (const variant of SEMANTICS_VARIANT_IDS) assert.equal(leaders.filter((entry) => entry.variant === variant).length, 46, `${variant} leads a third of the groups`);
  // no variant is ever run in a block: consecutive runs always change variant
  for (let index = 1; index < plan.length; index += 1) if (plan[index].pairId === plan[index - 1].pairId) assert.notEqual(plan[index].variant, plan[index - 1].variant);
  const d01 = plan.filter((entry) => entry.caseId === "D01").map((entry) => entry.sequenceIndex);
  assert.ok(d01[3] - d01[0] > 100, "the runs of one scenario are separated in time (outer loop = run ordinal)");
  // the leader rotates across consecutive groups (S0, S1, S2, S0, ...), so no variant is systematically first for a scenario type
  assert.deepEqual([plan[0].variant, plan[3].variant, plan[6].variant, plan[9].variant], ["S0_CURRENT_SEMANTICS", "S1_CONSEQUENCE_STATEMENT", "S2_COHERENT_REVERSIBLE_SEMANTICS", "S0_CURRENT_SEMANTICS"]);
});
