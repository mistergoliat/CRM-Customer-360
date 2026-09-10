import assert from "node:assert/strict";
import test from "node:test";
import { askAgentStep } from "../../../scripts/live-semantic-discovery-benchmark";
import { getSemanticVocabularyForPrompt, resetSearchProductsBySemanticsRegistryForTests } from "@/lib/brain/commercial/capability-gateway/searchProductsBySemanticsCapability";
import type { AgentLoopProvider, AgentLoopProviderMessage } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import type { CatalogPort, CatalogPortResult, CatalogProductSemanticsRegistry, CatalogTrainingSemanticsRegistry } from "@/lib/catalog/types";

/**
 * SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B5.1, Part 3. DB-free wiring tests
 * only - never a real Catalog Service or DeepSeek call (the fake CatalogPort
 * and fake AgentLoopProvider below are explicit test doubles). Verifies that
 * the benchmark's askAgentStep() forwards a real, non-null projected
 * SemanticVocabulary into buildAgentStepPromptPackage() - never that the real
 * production Catalog Service is reachable (that is an EC2-only fact this
 * suite cannot and does not claim to validate).
 */
function fakeCatalogPort(): CatalogPort {
  const productRegistry: CatalogProductSemanticsRegistry = {
    schemaVersion: "1",
    ontologyVersion: "commercial-product-ontology-v3",
    ontologyHash: "a".repeat(64),
    status: "PUBLISHED",
    axes: [
      { axis: "PRODUCT_FAMILY", values: [{ code: "JAULA", labelEs: "Jaula", definition: "Jaula de entrenamiento", status: "ACTIVE", residual: false }] },
      { axis: "DISCIPLINE", values: [{ code: "STRENGTH", labelEs: "Fuerza", definition: "Entrenamiento de fuerza", status: "ACTIVE", residual: false }] },
      { axis: "USE_CONTEXT", values: [{ code: "HOME_GYM", labelEs: "Gimnasio en casa", definition: "Uso domestico", status: "ACTIVE", residual: false }] }
    ]
  };
  const trainingRegistry: CatalogTrainingSemanticsRegistry = {
    schemaVersion: "2",
    registryVersion: "training-semantic-registry-v2",
    registryHash: "b".repeat(64),
    status: "PUBLISHED",
    exerciseCapabilities: [],
    trainingFunctions: [],
    bodyRegions: ["LOWER_BODY"],
    muscleGroups: [],
    trainingPatterns: [],
    exerciseDerivedRelations: [],
    familyTrainingFunctionDerivations: [],
    semanticBoundaries: { exerciseCapability: "EXERCISE_CAPABILITY", trainingFunction: "TRAINING_FUNCTION", deadlift: { dedicatedMachine: "DEADLIFT_MACHINE", deadliftJack: "DEADLIFT_JACK", barbell: "BARBELL_DEADLIFT", familyDerived: true }, squat: { forbiddenGenericCode: "SQUAT", explicitCapabilities: [], genericEquipmentPolicy: "EXPLICIT_ONLY" } }
  };
  return {
    async searchProducts() {
      throw new Error("not implemented");
    },
    async getProductDetails() {
      throw new Error("not implemented");
    },
    async batchGetProducts() {
      throw new Error("not implemented");
    },
    async exploreCatalog() {
      throw new Error("not implemented");
    },
    async resolveProductIntent() {
      throw new Error("not implemented");
    },
    async getProductSemanticsRegistry(): Promise<CatalogPortResult<CatalogProductSemanticsRegistry>> {
      return { ok: true, value: productRegistry };
    },
    async getTrainingSemanticsRegistry(): Promise<CatalogPortResult<CatalogTrainingSemanticsRegistry>> {
      return { ok: true, value: trainingRegistry };
    },
    async querySemanticDiscovery() {
      throw new Error("not implemented");
    }
  };
}

function fakeProvider(capturedMessages: { last: AgentLoopProviderMessage[] | null }): AgentLoopProvider {
  return {
    name: "fake-test-provider",
    async invoke(request) {
      capturedMessages.last = request.messages;
      return {
        rawOutput: { type: "respond", message: "ok" },
        inputTokens: 10,
        outputTokens: 5
      };
    }
  };
}

test.beforeEach(() => {
  resetSearchProductsBySemanticsRegistryForTests();
});

test("[TR-B5.1] askAgentStep forwards a non-null projected semanticVocabulary into buildAgentStepPromptPackage", async () => {
  const semanticVocabulary = await getSemanticVocabularyForPrompt(fakeCatalogPort(), "corr-test-1");
  assert.ok(semanticVocabulary, "expected a resolved vocabulary from the fake registry");

  const captured: { last: AgentLoopProviderMessage[] | null } = { last: null };
  const result = await askAgentStep({ label: "CASE_TEST", customerMessage: "quiero algo para entrenar piernas en mi casa", semanticVocabulary: semanticVocabulary! }, fakeProvider(captured));

  assert.equal(result.outcome, "respond");
  assert.ok(captured.last, "expected the provider to have been invoked with messages");

  const serialized = JSON.stringify(captured.last);
  // Representative projected codes (from the fake registries above) must be present.
  assert.match(serialized, /HOME_GYM/);
  assert.match(serialized, /LOWER_BODY/);
  // Internal registry metadata must never leak into the prompt.
  assert.doesNotMatch(serialized, /ontologyHash/);
  assert.doesNotMatch(serialized, /registryHash/);
  assert.doesNotMatch(serialized, /ontologyVersion/);
  assert.doesNotMatch(serialized, /registryVersion/);
  assert.doesNotMatch(serialized, /a{64}/);
  assert.doesNotMatch(serialized, /b{64}/);
});
