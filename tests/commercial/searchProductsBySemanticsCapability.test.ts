import assert from "node:assert/strict";
import test from "node:test";
import {
  searchProductsBySemanticsCapability,
  resetSearchProductsBySemanticsRegistryForTests,
  getSemanticVocabularyForPrompt,
  projectSemanticVocabulary
} from "../../lib/brain/commercial/capability-gateway/searchProductsBySemanticsCapability";
import type {
  CatalogPort,
  CatalogPortResult,
  CatalogProductSemanticsRegistry,
  CatalogSemanticDiscoveryInput,
  CatalogSemanticDiscoveryResult,
  CatalogTrainingSemanticsRegistry
} from "../../lib/catalog/types";

function productRegistry(): CatalogProductSemanticsRegistry {
  return {
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
}

function trainingRegistry(): CatalogTrainingSemanticsRegistry {
  return {
    schemaVersion: "2",
    registryVersion: "training-semantic-registry-v2",
    registryHash: "b".repeat(64),
    status: "PUBLISHED",
    exerciseCapabilities: [{ code: "SQUAT", canonicalName: "Squat", description: "Sentadilla", status: "ACTIVE", derivedBodyRegions: ["LOWER_BODY"], primaryMuscleGroups: ["QUADRICEPS"], secondaryMuscleGroups: [], trainingPatterns: ["SQUAT_PATTERN"] }],
    trainingFunctions: [{ code: "PRIMARY_STRENGTH", canonicalName: "Primary strength", description: "Fuerza primaria", status: "ACTIVE", allowedRelationTypes: ["DIRECT"], allowedEvidenceKinds: ["PRODUCT_FAMILY"] }],
    bodyRegions: ["LOWER_BODY"],
    muscleGroups: ["QUADRICEPS"],
    trainingPatterns: ["SQUAT_PATTERN"],
    exerciseDerivedRelations: [{ capabilityCode: "SQUAT", bodyRegions: ["LOWER_BODY"], primaryMuscleGroups: ["QUADRICEPS"], secondaryMuscleGroups: [], trainingPatterns: ["SQUAT_PATTERN"] }],
    familyTrainingFunctionDerivations: [{ productFamily: "JAULA", trainingFunctionCode: "PRIMARY_STRENGTH", relationType: "FAMILY_DERIVED", evidenceKind: "FAMILY_DERIVATION", status: "ACTIVE", rationale: "Fixture" }],
    semanticBoundaries: { exerciseCapability: "EXERCISE_CAPABILITY", trainingFunction: "TRAINING_FUNCTION", deadlift: { dedicatedMachine: "DEADLIFT_MACHINE", deadliftJack: "DEADLIFT_JACK", barbell: "BARBELL_DEADLIFT", familyDerived: true }, squat: { forbiddenGenericCode: "SQUAT", explicitCapabilities: ["SQUAT"], genericEquipmentPolicy: "EXPLICIT_ONLY" } }
  };
}

function semanticDiscoveryResult(overrides: Partial<CatalogSemanticDiscoveryResult> = {}): CatalogSemanticDiscoveryResult {
  return {
    schemaVersion: 1,
    query: { requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }], options: { limit: 20 } },
    results: [
      {
        productId: "1532",
        matchedRequirements: [{ axis: "PRODUCT_FAMILY", requestedCodes: ["JAULA"], matchedCodes: ["JAULA"], source: "PRODUCT_SEMANTICS", mode: "required", match: "any", reason: "required_match" }],
        productSemantics: { productId: "1532", classificationStatus: "CLASSIFIED", primaryProductFamily: { code: "JAULA", confidence: "EXPLICIT" }, secondaryProductFamilies: [], disciplines: [], useContexts: [], ontologyVersion: "commercial-product-ontology-v3", ontologyHash: "a".repeat(64), classifierVersion: "product-classifier-v1" },
        trainingSemantics: null
      }
    ],
    totalMatches: 1,
    truncated: false,
    lineage: { productSemantics: null, trainingSemantics: null },
    provenance: { source: "catalog_service_http", retrievedAt: new Date().toISOString(), cached: false },
    ...overrides
  };
}

function fakePort(overrides: Partial<CatalogPort> = {}): CatalogPort {
  const base: CatalogPort = {
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
      return { ok: true, value: productRegistry() };
    },
    async getTrainingSemanticsRegistry(): Promise<CatalogPortResult<CatalogTrainingSemanticsRegistry>> {
      return { ok: true, value: trainingRegistry() };
    },
    async querySemanticDiscovery(): Promise<CatalogPortResult<CatalogSemanticDiscoveryResult>> {
      return { ok: true, value: semanticDiscoveryResult() };
    }
  };
  return { ...base, ...overrides };
}

test.beforeEach(() => {
  resetSearchProductsBySemanticsRegistryForTests();
});

test("checkAvailability reports unavailable when the catalog service is not configured", async () => {
  const capability = searchProductsBySemanticsCapability(() => null);
  const availability = await capability.checkAvailability({ correlationId: "c" });
  assert.equal(availability.status, "unavailable");
});

test("declares the correct governance and evidence metadata", () => {
  const capability = searchProductsBySemanticsCapability(() => null);
  assert.deepEqual(capability.governance, { sideEffect: "read_only", authority: "autonomous", riskClass: "low" });
  assert.deepEqual(capability.evidenceProduced, ["PRODUCT_IDENTITY", "SEMANTIC_ELIGIBILITY"]);
  assert.equal(capability.evidenceRequired, undefined);
  assert.ok(capability.useWhen);
  assert.ok(capability.doNotUseWhen);
});

test("execute() rejects structurally malformed input as invalid_argument before any HTTP call", async () => {
  let called = false;
  const port = fakePort({
    async querySemanticDiscovery() {
      called = true;
      return { ok: true, value: semanticDiscoveryResult() };
    }
  });
  const capability = searchProductsBySemanticsCapability(() => port);

  const missingRequirements = await capability.execute({}, { correlationId: "c" });
  assert.equal(missingRequirements.status, "invalid_arguments");
  assert.equal(missingRequirements.errorCode, "invalid_argument");
  assert.equal(missingRequirements.retryable, false);

  const badMode = await capability.execute(
    { requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "sometimes", match: "any" }] },
    { correlationId: "c" }
  );
  assert.equal(badMode.status, "invalid_arguments");
  assert.equal(badMode.errorCode, "invalid_argument");

  const unknownAxis = await capability.execute(
    { requirements: [{ axis: "COLOR", codes: ["RED"], mode: "required", match: "any" }] },
    { correlationId: "c" }
  );
  assert.equal(unknownAxis.status, "invalid_arguments");
  assert.equal(unknownAxis.errorCode, "invalid_argument");

  assert.equal(called, false);
});

test("execute() rejects decimal/out-of-range limits, unknown properties, invalid schema versions, and malformed snapshot pins", async () => {
  let called = false;
  const port = fakePort({
    async querySemanticDiscovery() {
      called = true;
      return { ok: true, value: semanticDiscoveryResult() };
    }
  });
  const capability = searchProductsBySemanticsCapability(() => port);
  const base = { requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }] };
  const invalidInputs: Record<string, unknown>[] = [
    { ...base, limit: 20.7 },
    { ...base, limit: 0 },
    { ...base, limit: 101 },
    { ...base, unexpectedControl: true },
    { ...base, requirements: [{ ...base.requirements[0], extraControl: true }] },
    { ...base, schemaVersion: 2 },
    { ...base, expectedSnapshots: { productSemanticSnapshotId: "not-a-snapshot" } },
    { ...base, expectedSnapshots: { unknownSnapshot: "sha256:" + "a".repeat(64) } }
  ];
  for (const input of invalidInputs) {
    const result = await capability.execute(input, { correlationId: "c" });
    assert.equal(result.status, "invalid_arguments");
    assert.equal(result.errorCode, "invalid_argument");
    assert.equal(result.retryable, false);
  }
  assert.equal(called, false);
});

test("execute() forwards explicitly validated schemaVersion and expectedSnapshots without translating semantic codes", async () => {
  let captured: CatalogSemanticDiscoveryInput | undefined;
  const port = fakePort({
    async querySemanticDiscovery(input: CatalogSemanticDiscoveryInput) {
      captured = input;
      return { ok: true, value: semanticDiscoveryResult() };
    }
  });
  const capability = searchProductsBySemanticsCapability(() => port);
  await capability.execute({
    schemaVersion: 1,
    expectedSnapshots: { productSemanticSnapshotId: "sha256:" + "a".repeat(64) },
    requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }]
  }, { correlationId: "c" });
  assert.deepEqual(captured?.expectedSnapshots, { productSemanticSnapshotId: "sha256:" + "a".repeat(64) });
  assert.equal(captured?.schemaVersion, 1);
});

test("execute() rejects an unknown canonical code as invalid_code, listing only the bad code", async () => {
  const capability = searchProductsBySemanticsCapability(() => fakePort());
  const result = await capability.execute(
    { requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA", "UNKNOWN_CODE"], mode: "required", match: "any" }] },
    { correlationId: "c" }
  );
  assert.equal(result.status, "invalid_arguments");
  assert.equal(result.errorCode, "invalid_code");
  assert.equal(result.retryable, false);
  assert.deepEqual(result.data, { invalidRequirements: [{ axis: "PRODUCT_FAMILY", codes: ["UNKNOWN_CODE"] }] });
});

test("execute() returns a matched outcome for a real query result", async () => {
  const capability = searchProductsBySemanticsCapability(() => fakePort());
  const result = await capability.execute(
    { requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }] },
    { correlationId: "c" }
  );
  assert.equal(result.status, "completed");
  assert.equal(result.retryable, false);
  const data = result.data as { outcome: string; results: unknown[]; totalMatches: number; truncated: boolean };
  assert.equal(data.outcome, "matched");
  assert.equal(data.results.length, 1);
  assert.equal(data.totalMatches, 1);
  assert.ok(result.evidence.length > 0);
});

test("execute() returns a no_match outcome as a completed Gateway success, never a failure", async () => {
  const port = fakePort({
    async querySemanticDiscovery() {
      return { ok: true, value: semanticDiscoveryResult({ results: [], totalMatches: 0, truncated: false }) };
    }
  });
  const capability = searchProductsBySemanticsCapability(() => port);
  const result = await capability.execute(
    { requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }] },
    { correlationId: "c" }
  );
  assert.equal(result.status, "completed");
  const data = result.data as { outcome: string; results: unknown[]; totalMatches: number };
  assert.equal(data.outcome, "no_match");
  assert.equal(data.results.length, 0);
  assert.equal(data.totalMatches, 0);
});

test("execute() reports registry_mismatch (retryable) when the registry cannot be loaded/parsed", async () => {
  const port = fakePort({
    async getProductSemanticsRegistry() {
      return { ok: false, error: { code: "invalid_response", message: "malformed registry", retryable: false } };
    }
  });
  const capability = searchProductsBySemanticsCapability(() => port);
  const result = await capability.execute(
    { requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }] },
    { correlationId: "c" }
  );
  assert.equal(result.status, "temporarily_blocked");
  assert.equal(result.errorCode, "registry_mismatch");
  assert.equal(result.retryable, true);
});

test("execute() maps a technical query failure (timeout) to a retryable Gateway outcome", async () => {
  const port = fakePort({
    async querySemanticDiscovery() {
      return { ok: false, error: { code: "timeout", message: "Catalog service request timed out.", retryable: true } };
    }
  });
  const capability = searchProductsBySemanticsCapability(() => port);
  const result = await capability.execute(
    { requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }] },
    { correlationId: "c" }
  );
  assert.equal(result.status, "temporarily_blocked");
  assert.equal(result.retryable, true);
  assert.equal(result.errorCode, "timeout");
});

test("execute() supports training-axis requirements against the training registry", async () => {
  const port = fakePort({
    async querySemanticDiscovery(input: CatalogSemanticDiscoveryInput) {
      assert.equal(input.requirements[0].axis, "BODY_REGION");
      return { ok: true, value: semanticDiscoveryResult() };
    }
  });
  const capability = searchProductsBySemanticsCapability(() => port);
  const result = await capability.execute(
    { requirements: [{ axis: "BODY_REGION", codes: ["LOWER_BODY"], mode: "required", match: "any" }] },
    { correlationId: "c" }
  );
  assert.equal(result.status, "completed");
});

test("execute() rejects an unknown training-axis code as invalid_code too", async () => {
  const capability = searchProductsBySemanticsCapability(() => fakePort());
  const result = await capability.execute(
    { requirements: [{ axis: "MUSCLE_GROUP", codes: ["BICEPS"], mode: "required", match: "any" }] },
    { correlationId: "c" }
  );
  assert.equal(result.status, "invalid_arguments");
  assert.equal(result.errorCode, "invalid_code");
  assert.deepEqual(result.data, { invalidRequirements: [{ axis: "MUSCLE_GROUP", codes: ["BICEPS"] }] });
});

test("caches the registry across calls (registry fetched once)", async () => {
  let registryFetchCount = 0;
  const port = fakePort({
    async getProductSemanticsRegistry() {
      registryFetchCount += 1;
      return { ok: true, value: productRegistry() };
    }
  });
  const capability = searchProductsBySemanticsCapability(() => port);
  await capability.execute({ requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }] }, { correlationId: "c1" });
  await capability.execute({ requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }] }, { correlationId: "c2" });
  assert.equal(registryFetchCount, 1);
});

// ---------------------------------------------------------------------------
// SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B4.1 - Canonical Semantic Vocabulary
// Projection (projectSemanticVocabulary / getSemanticVocabularyForPrompt).
// ---------------------------------------------------------------------------

test("[TR-B4.1] projectSemanticVocabulary renders the product registry as axis/code/label/description, nothing else", () => {
  const vocabulary = projectSemanticVocabulary(productRegistry(), trainingRegistry());
  const productFamily = vocabulary.axes.find((entry) => entry.axis === "PRODUCT_FAMILY");
  assert.deepEqual(productFamily, { axis: "PRODUCT_FAMILY", codes: [{ code: "JAULA", label: "Jaula", description: "Jaula de entrenamiento" }] });
  const discipline = vocabulary.axes.find((entry) => entry.axis === "DISCIPLINE");
  assert.deepEqual(discipline, { axis: "DISCIPLINE", codes: [{ code: "STRENGTH", label: "Fuerza", description: "Entrenamiento de fuerza" }] });
});

test("[TR-B4.1] projectSemanticVocabulary renders the training registry as axis/code only (no label/description invented)", () => {
  const vocabulary = projectSemanticVocabulary(productRegistry(), trainingRegistry());
  const bodyRegion = vocabulary.axes.find((entry) => entry.axis === "BODY_REGION");
  assert.deepEqual(bodyRegion, { axis: "BODY_REGION", codes: [{ code: "LOWER_BODY" }] });
  const exerciseCapability = vocabulary.axes.find((entry) => entry.axis === "EXERCISE_CAPABILITY");
  assert.deepEqual(exerciseCapability, { axis: "EXERCISE_CAPABILITY", codes: [{ code: "SQUAT" }] });
  for (const code of exerciseCapability!.codes) {
    assert.ok(!("label" in code));
    assert.ok(!("description" in code));
  }
});

test("[TR-B4.1] projectSemanticVocabulary only ever surfaces real upstream codes - no independent hardcoded ontology exists", () => {
  const customProduct: CatalogProductSemanticsRegistry = {
    schemaVersion: "1",
    ontologyVersion: "v99",
    ontologyHash: "z".repeat(64),
    status: "PUBLISHED",
    axes: [
      { axis: "PRODUCT_FAMILY", values: [{ code: "TOTALLY_MADE_UP_CODE_XYZ", labelEs: "Custom", definition: "Custom fixture value", status: "ACTIVE", residual: false }] },
      { axis: "DISCIPLINE", values: [] },
      { axis: "USE_CONTEXT", values: [] }
    ]
  };
  const customTraining: CatalogTrainingSemanticsRegistry = {
    schemaVersion: "2",
    registryVersion: "v99",
    registryHash: "y".repeat(64),
    status: "PUBLISHED",
    exerciseCapabilities: [],
    trainingFunctions: [],
    bodyRegions: ["ANOTHER_MADE_UP_REGION"],
    muscleGroups: [],
    trainingPatterns: [],
    exerciseDerivedRelations: [],
    familyTrainingFunctionDerivations: [],
    semanticBoundaries: { exerciseCapability: "EXERCISE_CAPABILITY", trainingFunction: "TRAINING_FUNCTION", deadlift: { dedicatedMachine: "DEADLIFT_MACHINE", deadliftJack: "DEADLIFT_JACK", barbell: "BARBELL_DEADLIFT", familyDerived: true }, squat: { forbiddenGenericCode: "SQUAT", explicitCapabilities: [], genericEquipmentPolicy: "EXPLICIT_ONLY" } }
  };
  const vocabulary = projectSemanticVocabulary(customProduct, customTraining);
  const productFamily = vocabulary.axes.find((entry) => entry.axis === "PRODUCT_FAMILY");
  assert.deepEqual(productFamily?.codes, [{ code: "TOTALLY_MADE_UP_CODE_XYZ", label: "Custom", description: "Custom fixture value" }]);
  const bodyRegion = vocabulary.axes.find((entry) => entry.axis === "BODY_REGION");
  assert.deepEqual(bodyRegion?.codes, [{ code: "ANOTHER_MADE_UP_REGION" }]);
  // No LOWER_BODY/HOME_GYM/JAULA-style example values leak in from anywhere - the projection is a pure function of its input.
  const allCodes = vocabulary.axes.flatMap((entry) => entry.codes.map((code) => code.code));
  assert.deepEqual(allCodes.sort(), ["ANOTHER_MADE_UP_REGION", "TOTALLY_MADE_UP_CODE_XYZ"]);
});

test("[TR-B4.1] projectSemanticVocabulary excludes classifier internals - no hash/snapshot/checksum/status/residual fields anywhere in the output", () => {
  const vocabulary = projectSemanticVocabulary(productRegistry(), trainingRegistry());
  const serialized = JSON.stringify(vocabulary);
  for (const forbidden of ["ontologyHash", "ontologyVersion", "registryHash", "registryVersion", "snapshotId", "semanticChecksum", "classifierVersion", "residual", "status"]) {
    assert.ok(!serialized.includes(forbidden), `vocabulary must never expose "${forbidden}"`);
  }
});

test("[TR-B4.1] getSemanticVocabularyForPrompt returns null when the port is null (catalog not configured)", async () => {
  const vocabulary = await getSemanticVocabularyForPrompt(null, "corr-1");
  assert.equal(vocabulary, null);
});

test("[TR-B4.1] getSemanticVocabularyForPrompt returns null (never throws) when the registry cannot be loaded", async () => {
  const port = fakePort({
    async getProductSemanticsRegistry() {
      return { ok: false, error: { code: "unavailable", message: "down", retryable: true } };
    }
  });
  const vocabulary = await getSemanticVocabularyForPrompt(port, "corr-2");
  assert.equal(vocabulary, null);
});

test("[TR-B4.1] getSemanticVocabularyForPrompt reuses the same per-process registry cache execute() already populates (no second fetch)", async () => {
  let registryFetchCount = 0;
  const port = fakePort({
    async getProductSemanticsRegistry() {
      registryFetchCount += 1;
      return { ok: true, value: productRegistry() };
    }
  });
  const capability = searchProductsBySemanticsCapability(() => port);
  await capability.execute({ requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }] }, { correlationId: "c1" });
  assert.equal(registryFetchCount, 1);

  const vocabulary = await getSemanticVocabularyForPrompt(port, "corr-3");
  assert.equal(registryFetchCount, 1, "the vocabulary read must reuse the cache execute() already populated, never a second fetch");
  assert.ok(vocabulary);
});

test("[TR-B4.1] getSemanticVocabularyForPrompt fetches once across repeated calls (cache reuse)", async () => {
  let registryFetchCount = 0;
  const port = fakePort({
    async getProductSemanticsRegistry() {
      registryFetchCount += 1;
      return { ok: true, value: productRegistry() };
    }
  });
  await getSemanticVocabularyForPrompt(port, "corr-4");
  await getSemanticVocabularyForPrompt(port, "corr-5");
  assert.equal(registryFetchCount, 1);
});

test("[TR-B4.1] resetSearchProductsBySemanticsRegistryForTests forces a refresh - the next vocabulary reflects the updated registry", async () => {
  let currentProductRegistry = productRegistry();
  const port = fakePort({
    async getProductSemanticsRegistry() {
      return { ok: true, value: currentProductRegistry };
    }
  });

  const first = await getSemanticVocabularyForPrompt(port, "corr-6");
  const firstFamily = first?.axes.find((entry) => entry.axis === "PRODUCT_FAMILY");
  assert.deepEqual(firstFamily?.codes.map((c) => c.code), ["JAULA"]);

  currentProductRegistry = {
    ...currentProductRegistry,
    axes: currentProductRegistry.axes.map((entry) =>
      entry.axis === "PRODUCT_FAMILY" ? { ...entry, values: [{ code: "NUEVO_CODIGO", labelEs: "Nuevo", definition: "Recien publicado", status: "ACTIVE", residual: false }] } : entry
    )
  };

  const stillCached = await getSemanticVocabularyForPrompt(port, "corr-7");
  const stillCachedFamily = stillCached?.axes.find((entry) => entry.axis === "PRODUCT_FAMILY");
  assert.deepEqual(stillCachedFamily?.codes.map((c) => c.code), ["JAULA"], "without a reset, the stale cached registry is still served");

  resetSearchProductsBySemanticsRegistryForTests();
  const afterReset = await getSemanticVocabularyForPrompt(port, "corr-8");
  const afterResetFamily = afterReset?.axes.find((entry) => entry.axis === "PRODUCT_FAMILY");
  assert.deepEqual(afterResetFamily?.codes.map((c) => c.code), ["NUEVO_CODIGO"], "after a reset, the next read reflects the refreshed registry");
});
