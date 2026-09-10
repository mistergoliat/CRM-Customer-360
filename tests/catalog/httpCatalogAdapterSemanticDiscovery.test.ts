import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { createHttpCatalogAdapter } from "../../lib/catalog/httpCatalogAdapter";
import type { CatalogPort } from "../../lib/catalog/types";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let lastRequestBody: string | undefined;

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      lastRequestBody = chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : undefined;
      handler(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.beforeEach(() => {
  handler = (_req, res) => res.writeHead(500).end();
  lastRequestBody = undefined;
});

function makeAdapter(timeoutMs = 500): CatalogPort {
  return createHttpCatalogAdapter({ baseUrl, apiKey: "test-key", timeoutMs });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function semanticDiscoveryResponsePayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    lineage: {
      productSemantics: { snapshotId: "sha256:" + "a".repeat(64), semanticChecksum: "b".repeat(64), ontologyVersion: "commercial-product-ontology-v3", ontologyHash: "c".repeat(64), classifierVersion: "commercial-product-classifier-v3" },
      trainingSemantics: null
    },
    query: { requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }], options: { limit: 20 } },
    results: [
      {
        productId: 1532,
        matchedRequirements: [
          { axis: "PRODUCT_FAMILY", requestedCodes: ["JAULA"], matchedCodes: ["JAULA"], source: "PRODUCT_SEMANTICS", mode: "required", match: "any", reason: "required_match" }
        ],
        productSemantics: {
          productId: 1532,
          classificationStatus: "CLASSIFIED",
          primaryProductFamily: { code: "JAULA", confidence: "EXPLICIT" },
          secondaryProductFamilies: [],
          disciplines: [{ code: "STRENGTH", confidence: "EXPLICIT" }],
          useContexts: [{ code: "HOME_GYM", confidence: "STRONGLY_INFERRED" }],
          ontologyVersion: "commercial-product-ontology-v3",
          ontologyHash: "c".repeat(64),
          classifierVersion: "commercial-product-classifier-v3"
        },
        trainingSemantics: null
      }
    ],
    totalMatches: 1,
    truncated: false,
    ...overrides
  };
}

function productRegistryPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1",
    ontologyVersion: "commercial-product-ontology-v3",
    ontologyHash: "a".repeat(64),
    status: "PUBLISHED",
    axes: [
      { axis: "PRODUCT_FAMILY", values: [{ code: "JAULA", labelEs: "Jaula", definition: "Jaula de entrenamiento", status: "ACTIVE", residual: false }] },
      { axis: "DISCIPLINE", values: [] },
      { axis: "USE_CONTEXT", values: [] }
    ],
    ...overrides
  };
}

function trainingRegistryPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "2",
    registryVersion: "training-semantic-registry-v2",
    registryHash: "d".repeat(64),
    status: "PUBLISHED",
    exerciseCapabilities: [{ code: "SQUAT", canonicalName: "Squat", description: "Sentadilla", status: "ACTIVE", derivedBodyRegions: ["LOWER_BODY"], primaryMuscleGroups: ["QUADRICEPS"], secondaryMuscleGroups: [], trainingPatterns: ["SQUAT_PATTERN"] }],
    trainingFunctions: [{ code: "PRIMARY_STRENGTH", canonicalName: "Primary strength", description: "Fuerza primaria", status: "ACTIVE", allowedRelationTypes: ["DIRECT"], allowedEvidenceKinds: ["PRODUCT_FAMILY"] }],
    bodyRegions: ["LOWER_BODY"],
    muscleGroups: ["QUADRICEPS"],
    trainingPatterns: ["SQUAT_PATTERN"],
    exerciseDerivedRelations: [{ capabilityCode: "SQUAT", bodyRegions: ["LOWER_BODY"], primaryMuscleGroups: ["QUADRICEPS"], secondaryMuscleGroups: [], trainingPatterns: ["SQUAT_PATTERN"] }],
    familyTrainingFunctionDerivations: [{ productFamily: "JAULA", trainingFunctionCode: "PRIMARY_STRENGTH", relationType: "FAMILY_DERIVED", evidenceKind: "FAMILY_DERIVATION", status: "ACTIVE", rationale: "Fixture" }],
    semanticBoundaries: { exerciseCapability: "EXERCISE_CAPABILITY", trainingFunction: "TRAINING_FUNCTION", deadlift: { dedicatedMachine: "DEADLIFT_MACHINE", deadliftJack: "DEADLIFT_JACK", barbell: "BARBELL_DEADLIFT", familyDerived: true }, squat: { forbiddenGenericCode: "SQUAT", explicitCapabilities: ["SQUAT"], genericEquipmentPolicy: "EXPLICIT_ONLY" } },
    ...overrides
  };
}

test("querySemanticDiscovery posts the canonical request shape to the real endpoint", async () => {
  let requestPath: string | undefined;
  let requestMethod: string | undefined;
  let apiKeyHeader: string | string[] | undefined;
  let correlationHeader: string | string[] | undefined;
  handler = (req, res) => {
    requestPath = req.url;
    requestMethod = req.method;
    apiKeyHeader = req.headers["x-api-key"];
    correlationHeader = req.headers["x-correlation-id"];
    sendJson(res, 200, semanticDiscoveryResponsePayload());
  };

  const port = makeAdapter();
  const result = await port.querySemanticDiscovery!(
    { requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }], limit: 10 },
    { correlationId: "corr-sem-1" }
  );

  assert.equal(requestMethod, "POST");
  assert.equal(requestPath, "/v1/products/semantic-discovery/query");
  assert.equal(apiKeyHeader, "test-key");
  assert.equal(correlationHeader, "corr-sem-1");
  assert.ok(lastRequestBody);
  const body = JSON.parse(lastRequestBody!);
  assert.deepEqual(body, {
    schemaVersion: 1,
    requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }],
    options: { limit: 10 }
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.results.length, 1);
  assert.equal(result.value.results[0].productId, "1532");
  assert.deepEqual(result.value.results[0].productSemantics, {
    productId: "1532",
    classificationStatus: "CLASSIFIED",
    primaryProductFamily: { code: "JAULA", confidence: "EXPLICIT" },
    secondaryProductFamilies: [],
    disciplines: [{ code: "STRENGTH", confidence: "EXPLICIT" }],
    useContexts: [{ code: "HOME_GYM", confidence: "STRONGLY_INFERRED" }],
    ontologyVersion: "commercial-product-ontology-v3",
    ontologyHash: "c".repeat(64),
    classifierVersion: "commercial-product-classifier-v3"
  });
  assert.equal(result.value.results[0].trainingSemantics, null);
  assert.equal(result.value.totalMatches, 1);
  assert.equal(result.value.truncated, false);
  assert.equal(result.value.lineage.productSemantics?.snapshotId, "sha256:" + "a".repeat(64));
  assert.equal(result.value.lineage.productSemantics?.semanticChecksum, "b".repeat(64));
  assert.equal(result.value.lineage.productSemantics?.ontologyHash, "c".repeat(64));
  assert.equal(result.value.lineage.productSemantics?.classifierVersion, "commercial-product-classifier-v3");
});

test("querySemanticDiscovery preserves cross-domain evidence and both lineage authorities", async () => {
  handler = (_req, res) => sendJson(res, 200, semanticDiscoveryResponsePayload({
    lineage: {
      productSemantics: { snapshotId: "sha256:" + "a".repeat(64), semanticChecksum: "b".repeat(64), ontologyVersion: "commercial-product-ontology-v3", ontologyHash: "c".repeat(64), classifierVersion: "commercial-product-classifier-v3" },
      trainingSemantics: { snapshotId: "sha256:" + "d".repeat(64), semanticChecksum: "e".repeat(64), registryVersion: "training-semantic-registry-v2", registryHash: "f".repeat(64), classifierVersion: "training-semantic-classifier-v2.1", rulesHash: "1".repeat(64) }
    },
    query: { requirements: [
      { axis: "USE_CONTEXT", codes: ["HOME_GYM"], mode: "required", match: "any" },
      { axis: "BODY_REGION", codes: ["LOWER_BODY"], mode: "preferred", match: "any" }
    ], options: { limit: 20 } },
    results: [{
      productId: 1532,
      matchedRequirements: [
        { axis: "USE_CONTEXT", requestedCodes: ["HOME_GYM"], matchedCodes: ["HOME_GYM"], source: "PRODUCT_SEMANTICS", mode: "required", match: "any", relationTypes: ["DIRECT"], confidenceLevels: ["HIGH"], reason: "required_match" },
        { axis: "BODY_REGION", requestedCodes: ["LOWER_BODY"], matchedCodes: ["LOWER_BODY"], source: "TRAINING_SEMANTICS", mode: "preferred", match: "any", relationTypes: ["SUPPORTED"], confidenceLevels: ["MEDIUM"], reason: "preferred_match" }
      ],
      productSemantics: {
        productId: 1532,
        classificationStatus: "CLASSIFIED",
        primaryProductFamily: { code: "JAULA", confidence: "EXPLICIT" },
        secondaryProductFamilies: [],
        disciplines: [{ code: "STRENGTH", confidence: "EXPLICIT" }],
        useContexts: [{ code: "HOME_GYM", confidence: "EXPLICIT" }],
        ontologyVersion: "commercial-product-ontology-v3",
        ontologyHash: "c".repeat(64),
        classifierVersion: "commercial-product-classifier-v3"
      },
      trainingSemantics: {
        productId: 1532,
        resolutionState: "RESOLVED",
        coverageStatus: "COVERED",
        exerciseCapabilities: [{ code: "SQUAT", relationType: "DIRECT", classificationConfidence: "HIGH", evidence: [{ kind: "EXERCISE_CAPABILITY", sourceId: "1532", matchedText: "sentadilla" }] }],
        trainingFunctions: [{ code: "PRIMARY_STRENGTH", relationType: "SUPPORTED", evidence: [{ kind: "TRAINING_FUNCTION", ruleId: "rule-1" }] }],
        derived: { bodyRegions: ["LOWER_BODY"], primaryMuscleGroups: ["QUADRICEPS"], secondaryMuscleGroups: [], trainingPatterns: ["SQUAT_PATTERN"] }
      }
    }]
  }));
  const result = await makeAdapter().querySemanticDiscovery!({
    requirements: [
      { axis: "USE_CONTEXT", codes: ["HOME_GYM"], mode: "required", match: "any" },
      { axis: "BODY_REGION", codes: ["LOWER_BODY"], mode: "preferred", match: "any" }
    ]
  }, { correlationId: "corr-sem-cross" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.lineage.trainingSemantics?.registryVersion, "training-semantic-registry-v2");
  assert.equal(result.value.lineage.trainingSemantics?.rulesHash, "1".repeat(64));
  assert.deepEqual(result.value.results[0].matchedRequirements[0].relationTypes, ["DIRECT"]);
  assert.deepEqual(result.value.results[0].matchedRequirements[1].confidenceLevels, ["MEDIUM"]);
  assert.equal(result.value.results[0].matchedRequirements[1].reason, "preferred_match");
  assert.equal(result.value.results[0].trainingSemantics?.exerciseCapabilities[0].code, "SQUAT");
  assert.equal(result.value.results[0].trainingSemantics?.exerciseCapabilities[0].evidence?.[0].matchedText, "sentadilla");
});

test("querySemanticDiscovery never sends expectedSnapshots (no cross-call pinning)", async () => {
  handler = (req, res) => sendJson(res, 200, semanticDiscoveryResponsePayload());
  await makeAdapter().querySemanticDiscovery!(
    { requirements: [{ axis: "BODY_REGION", codes: ["LOWER_BODY"], mode: "required", match: "any" }] },
    { correlationId: "corr-sem-2" }
  );
  const body = JSON.parse(lastRequestBody!);
  assert.equal("expectedSnapshots" in body, false);
  assert.deepEqual(body.options, {});
});

test("a NO_MATCH result is a valid ok:true domain result, never an error", async () => {
  handler = (req, res) => sendJson(res, 200, semanticDiscoveryResponsePayload({ results: [], totalMatches: 0, truncated: false }));
  const result = await makeAdapter().querySemanticDiscovery!(
    { requirements: [{ axis: "PRODUCT_FAMILY", codes: ["NONEXISTENT"], mode: "required", match: "any" }] },
    { correlationId: "corr-sem-3" }
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.results.length, 0);
  assert.equal(result.value.totalMatches, 0);
});

test("querySemanticDiscovery maps INVALID_SEMANTIC_DISCOVERY_REQUEST to invalid_input", async () => {
  handler = (_req, res) => sendJson(res, 400, { error: { code: "INVALID_SEMANTIC_DISCOVERY_REQUEST", message: 'Unknown code "FOO" for axis PRODUCT_FAMILY', correlationId: "c" } });
  const result = await makeAdapter().querySemanticDiscovery!(
    { requirements: [{ axis: "PRODUCT_FAMILY", codes: ["FOO"], mode: "required", match: "any" }] },
    { correlationId: "corr-sem-4" }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_input");
  assert.equal(result.error.retryable, false);
});

test("querySemanticDiscovery maps TRAINING_SEMANTICS_UNAVAILABLE to a retryable unavailable", async () => {
  handler = (_req, res) => sendJson(res, 503, { error: { code: "TRAINING_SEMANTICS_UNAVAILABLE", message: "Active Training Semantic Snapshot V2 is not loaded", correlationId: "c" } });
  const result = await makeAdapter().querySemanticDiscovery!(
    { requirements: [{ axis: "BODY_REGION", codes: ["LOWER_BODY"], mode: "required", match: "any" }] },
    { correlationId: "corr-sem-5" }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "unavailable");
  assert.equal(result.error.retryable, true);
});

test("Catalog semantic HTTP errors normalize 401/403/409/503 consistently", async () => {
  const cases = [
    { status: 400, body: {}, code: "invalid_input", retryable: false },
    { status: 401, body: {}, code: "unauthorized", retryable: false },
    { status: 403, body: {}, code: "unauthorized", retryable: false },
    { status: 409, body: { error: { code: "PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH", message: "stale product snapshot" } }, code: "unavailable", retryable: true },
    { status: 503, body: {}, code: "unavailable", retryable: true }
  ] as const;
  for (const entry of cases) {
    handler = (_req, res) => sendJson(res, entry.status, entry.body);
    const result = await makeAdapter().querySemanticDiscovery!({ requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }] }, { correlationId: `corr-${entry.status}` });
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.error.code, entry.code);
    assert.equal(result.error.retryable, entry.retryable);
  }
});

test("semantic provider errors never expose the configured API key", async () => {
  handler = (_req, res) => sendJson(res, 503, { error: { code: "test-key", message: "provider echoed test-key" } });
  const result = await makeAdapter().querySemanticDiscovery!({ requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }] }, { correlationId: "corr-secret" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.message.includes("test-key"), false);
  assert.equal(result.error.providerErrorCode?.includes("test-key"), false);
});

test("querySemanticDiscovery reports a network/timeout failure distinctly", async () => {
  const port = createHttpCatalogAdapter({ baseUrl, apiKey: "test-key", timeoutMs: 20 });
  handler = () => {
    /* never responds - forces the client timeout */
  };
  const result = await port.querySemanticDiscovery!(
    { requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }] },
    { correlationId: "corr-sem-6" }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "timeout");
  assert.equal(result.error.retryable, true);
});

test("querySemanticDiscovery rejects a malformed response as invalid_response", async () => {
  handler = (_req, res) => sendJson(res, 200, { totally: "wrong shape" });
  const result = await makeAdapter().querySemanticDiscovery!(
    { requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }] },
    { correlationId: "corr-sem-7" }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response");
});

test("querySemanticDiscovery rejects an incompatible response schemaVersion", async () => {
  handler = (_req, res) => sendJson(res, 200, semanticDiscoveryResponsePayload({ schemaVersion: 2 }));
  const result = await makeAdapter().querySemanticDiscovery!({ requirements: [{ axis: "PRODUCT_FAMILY", codes: ["JAULA"], mode: "required", match: "any" }] }, { correlationId: "corr-sem-schema" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response");
});

test("getProductSemanticsRegistry reads the real registry endpoint and parses axes/values", async () => {
  let requestPath: string | undefined;
  let apiKeyHeader: string | string[] | undefined;
  let correlationHeader: string | string[] | undefined;
  handler = (req, res) => {
    requestPath = req.url;
    apiKeyHeader = req.headers["x-api-key"];
    correlationHeader = req.headers["x-correlation-id"];
    sendJson(res, 200, productRegistryPayload());
  };
  const result = await makeAdapter().getProductSemanticsRegistry!({ correlationId: "corr-reg-1" });
  assert.equal(requestPath, "/v1/products/semantics/registry");
  assert.equal(apiKeyHeader, "test-key");
  assert.equal(correlationHeader, "corr-reg-1");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.schemaVersion, "1");
  assert.equal(result.value.ontologyVersion, "commercial-product-ontology-v3");
  assert.equal(result.value.ontologyHash, "a".repeat(64));
  assert.equal(result.value.status, "PUBLISHED");
  assert.equal(result.value.axes.length, 3);
  assert.deepEqual(result.value.axes[0].values[0], { code: "JAULA", labelEs: "Jaula", definition: "Jaula de entrenamiento", status: "ACTIVE", residual: false });
});

test("getTrainingSemanticsRegistry reads and preserves the complete Training Registry V2 contract", async () => {
  let requestPath: string | undefined;
  let apiKeyHeader: string | string[] | undefined;
  let correlationHeader: string | string[] | undefined;
  handler = (req, res) => {
    requestPath = req.url;
    apiKeyHeader = req.headers["x-api-key"];
    correlationHeader = req.headers["x-correlation-id"];
    sendJson(res, 200, trainingRegistryPayload());
  };
  const result = await makeAdapter().getTrainingSemanticsRegistry!({ correlationId: "corr-reg-2" });
  assert.equal(requestPath, "/v1/products/training-semantics/registry");
  assert.equal(apiKeyHeader, "test-key");
  assert.equal(correlationHeader, "corr-reg-2");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.schemaVersion, "2");
  assert.equal(result.value.registryVersion, "training-semantic-registry-v2");
  assert.equal(result.value.registryHash, "d".repeat(64));
  assert.equal(result.value.exerciseCapabilities[0].code, "SQUAT");
  assert.equal(result.value.trainingFunctions[0].code, "PRIMARY_STRENGTH");
  assert.equal(result.value.exerciseDerivedRelations[0].capabilityCode, "SQUAT");
  assert.equal(result.value.familyTrainingFunctionDerivations[0].relationType, "FAMILY_DERIVED");
  assert.equal(result.value.semanticBoundaries.squat.genericEquipmentPolicy, "EXPLICIT_ONLY");
  assert.deepEqual(result.value.bodyRegions, ["LOWER_BODY"]);
});

test("getProductSemanticsRegistry rejects a malformed registry payload as invalid_response", async () => {
  handler = (_req, res) => sendJson(res, 200, { not: "a registry" });
  const result = await makeAdapter().getProductSemanticsRegistry!({ correlationId: "corr-reg-3" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response");
});

test("getProductSemanticsRegistry rejects an incorrect published ontology version", async () => {
  handler = (_req, res) => sendJson(res, 200, productRegistryPayload({ ontologyVersion: "commercial-product-ontology-v2" }));
  const result = await makeAdapter().getProductSemanticsRegistry!({ correlationId: "corr-reg-version" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response");
});

test("getTrainingSemanticsRegistry rejects a V1-only/incompatible registry", async () => {
  handler = (_req, res) => sendJson(res, 200, { schemaVersion: "1", registryVersion: "training-semantic-registry-v1", registryHash: "d".repeat(64), status: "PUBLISHED", exerciseCapabilities: [], trainingFunctions: [] });
  const result = await makeAdapter().getTrainingSemanticsRegistry!({ correlationId: "corr-reg-v1" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response");
});

test("getTrainingSemanticsRegistry rejects malformed V2 derived relations", async () => {
  handler = (_req, res) => sendJson(res, 200, trainingRegistryPayload({ exerciseDerivedRelations: [{ capabilityCode: "SQUAT" }] }));
  const result = await makeAdapter().getTrainingSemanticsRegistry!({ correlationId: "corr-reg-derived" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response");
});

test("transport failure is normalized as a retryable timeout/unavailable error", async () => {
  const port = createHttpCatalogAdapter({ baseUrl: "http://127.0.0.1:9", apiKey: "test-key", timeoutMs: 100 });
  const result = await port.getProductSemanticsRegistry!({ correlationId: "corr-transport" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "timeout");
  assert.equal(result.error.retryable, true);
});
