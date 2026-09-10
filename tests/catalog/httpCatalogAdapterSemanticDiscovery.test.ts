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
      productSemantics: { snapshotId: "sha256:" + "a".repeat(64), ontologyVersion: "v3", ontologyHash: "b".repeat(64) },
      trainingSemantics: null
    },
    query: { requirements: [], options: { limit: 20 } },
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
          ontologyVersion: "v3",
          ontologyHash: "b".repeat(64),
          classifierVersion: "c1"
        },
        trainingSemantics: null
      }
    ],
    totalMatches: 1,
    truncated: false,
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
    classificationStatus: "CLASSIFIED",
    primaryProductFamily: "JAULA",
    secondaryProductFamilies: [],
    disciplines: ["STRENGTH"],
    useContexts: ["HOME_GYM"]
  });
  assert.equal(result.value.results[0].trainingSemantics, null);
  assert.equal(result.value.totalMatches, 1);
  assert.equal(result.value.truncated, false);
  assert.equal(result.value.lineage.productSemantics?.snapshotId, "sha256:" + "a".repeat(64));
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

test("getProductSemanticsRegistry reads the real registry endpoint and parses axes/values", async () => {
  let requestPath: string | undefined;
  handler = (req, res) => {
    requestPath = req.url;
    sendJson(res, 200, {
      schemaVersion: "1",
      ontologyVersion: "v3",
      ontologyHash: "a".repeat(64),
      status: "PUBLISHED",
      axes: [
        {
          axis: "PRODUCT_FAMILY",
          values: [{ code: "JAULA", labelEs: "Jaula", definition: "Jaula de entrenamiento", status: "ACTIVE", residual: false }]
        },
        { axis: "DISCIPLINE", values: [] },
        { axis: "USE_CONTEXT", values: [] }
      ]
    });
  };
  const result = await makeAdapter().getProductSemanticsRegistry!({ correlationId: "corr-reg-1" });
  assert.equal(requestPath, "/v1/products/semantics/registry");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.axes.length, 3);
  assert.deepEqual(result.value.axes[0].values[0], { code: "JAULA", label: "Jaula", description: "Jaula de entrenamiento", residual: false });
});

test("getTrainingSemanticsRegistry reads the real registry endpoint and parses code lists", async () => {
  let requestPath: string | undefined;
  handler = (req, res) => {
    requestPath = req.url;
    sendJson(res, 200, {
      schemaVersion: "2",
      registryVersion: "v2",
      registryHash: "d".repeat(64),
      status: "PUBLISHED",
      exerciseCapabilities: [{ code: "SQUAT", status: "ACTIVE" }],
      trainingFunctions: [{ code: "PRIMARY_STRENGTH", status: "ACTIVE" }],
      bodyRegions: ["LOWER_BODY"],
      muscleGroups: ["QUADRICEPS"],
      trainingPatterns: ["SQUAT_PATTERN"],
      exerciseDerivedRelations: [],
      familyTrainingFunctionDerivations: [],
      semanticBoundaries: {}
    });
  };
  const result = await makeAdapter().getTrainingSemanticsRegistry!({ correlationId: "corr-reg-2" });
  assert.equal(requestPath, "/v1/products/training-semantics/registry");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.exerciseCapabilities, ["SQUAT"]);
  assert.deepEqual(result.value.trainingFunctions, ["PRIMARY_STRENGTH"]);
  assert.deepEqual(result.value.bodyRegions, ["LOWER_BODY"]);
});

test("getProductSemanticsRegistry rejects a malformed registry payload as invalid_response", async () => {
  handler = (_req, res) => sendJson(res, 200, { not: "a registry" });
  const result = await makeAdapter().getProductSemanticsRegistry!({ correlationId: "corr-reg-3" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "invalid_response");
});
