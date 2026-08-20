import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { POST } from "@/app/api/marketing/copilot/route";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

test("marketing copilot proxy stays closed when the feature flag is disabled", async () => {
  process.env.MARKETING_COPILOT_ENABLED = "false";

  const response = await POST(jsonRequest({ question: "Cuantos clientes hay?" }));
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.code, "marketing_copilot_disabled");
});

test("marketing copilot proxy validates public request shape before forwarding", async () => {
  configureProxyEnv();

  const response = await POST(jsonRequest({ question: "   " }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, "invalid_question");
});

test("marketing copilot proxy forwards only the controlled question payload with the internal token", async () => {
  configureProxyEnv();
  let forwarded = false;
  globalThis.fetch = (async (input, init) => {
    forwarded = true;
    assert.equal(input, "http://127.0.0.1:3101/v1/customer-intelligence/copilot");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("x-internal-copilot-token"), "internal-token-1234");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      question: "Cuantos clientes hay en cada cluster?",
      featureSnapshotId: "42"
    });
    return Response.json(answeredResponse(), { status: 200 });
  }) as typeof fetch;

  const response = await POST(jsonRequest({ question: "  Cuantos clientes hay en cada cluster? ", featureSnapshotId: 42 }));
  const body = await response.json();

  assert.equal(forwarded, true);
  assert.equal(response.status, 200);
  assert.equal(body.status, "answered");
  assert.equal(body.provenance.featureSnapshot.snapshotId, "1001");
});

test("marketing copilot proxy preserves upstream controlled error statuses", async () => {
  configureProxyEnv();
  globalThis.fetch = (async () => Response.json({ status: "unsupported_data", message: "Dato fuera del contrato analitico." }, { status: 422 })) as typeof fetch;

  const response = await POST(jsonRequest({ question: "Cuantos clientes abandonaron carrito ayer?" }));
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.status, "unsupported_data");
});

function configureProxyEnv() {
  Object.assign(process.env, {
    MARKETING_COPILOT_ENABLED: "true",
    MARKETING_COPILOT_BACKEND_BASE_URL: "http://127.0.0.1:3101/",
    MARKETING_COPILOT_INTERNAL_TOKEN: "internal-token-1234",
    MARKETING_COPILOT_TIMEOUT_MS: "1000"
  });
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/marketing/copilot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function answeredResponse() {
  return {
    status: "answered",
    answer: "Hay 123 clientes distribuidos en 4 clusters.",
    analysis: {
      queryCount: 1,
      queryPlanHashes: ["hash-1"],
      resultRowCount: 4,
      executionDurationMs: 23,
      plannerModel: "http_json:test",
      answerModel: "http_json:test"
    },
    provenance: {
      featureSnapshot: {
        snapshotId: "1001",
        referenceTime: "2026-08-20T00:00:00.000Z",
        featureVersion: "customer_features_v1",
        populationPolicyVersion: "active_customers_v1"
      },
      rfmSnapshot: null,
      clusterSnapshot: null,
      population: {
        featurePopulation: 123,
        rfmMatched: 0,
        clusterMatched: 0,
        bothMatched: 0,
        neitherMatched: 123,
        rfmCoveragePct: 0,
        clusterCoveragePct: 0
      }
    }
  };
}
