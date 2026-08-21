import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { POST as legacyPost } from "@/app/api/marketing/copilot/route";
import { POST as createSessionPost } from "@/app/api/marketing/copilot/sessions/route";
import { DELETE as deleteSessionDelete } from "@/app/api/marketing/copilot/sessions/[sessionId]/route";
import { POST as exportPost } from "@/app/api/marketing/copilot/sessions/[sessionId]/export/route";
import { POST as messagePost } from "@/app/api/marketing/copilot/sessions/[sessionId]/messages/route";
import { POST as refreshPost } from "@/app/api/marketing/copilot/sessions/[sessionId]/refresh/route";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const SESSION_ID = "00000000-0000-4000-8000-000000000001";

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

test("marketing copilot proxy stays closed when the feature flag is disabled", async () => {
  process.env.MARKETING_COPILOT_ENABLED = "false";

  const response = await createSessionPost(jsonRequest("/api/marketing/copilot/sessions", {}));
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.code, "marketing_copilot_disabled");
});

test("marketing copilot proxy validates public request shape before forwarding", async () => {
  configureProxyEnv();

  const response = await messagePost(jsonRequest(`/api/marketing/copilot/sessions/${SESSION_ID}/messages`, { question: "   " }), context());
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, "invalid_question");
});

test("legacy one-shot proxy remains compatible and forwards only controlled payload with the internal token", async () => {
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

  const response = await legacyPost(jsonRequest("/api/marketing/copilot", { question: "  Cuantos clientes hay en cada cluster? ", featureSnapshotId: 42 }));
  const body = await response.json();

  assert.equal(forwarded, true);
  assert.equal(response.status, 200);
  assert.equal(body.status, "answered");
  assert.equal(body.provenance.featureSnapshot.snapshotId, "1001");
});

test("session creation calls the Customer Profile session endpoint with server-side token", async () => {
  configureProxyEnv();
  globalThis.fetch = (async (input, init) => {
    assert.equal(input, "http://127.0.0.1:3101/v1/customer-intelligence/copilot/sessions");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("x-internal-copilot-token"), "internal-token-1234");
    assert.deepEqual(JSON.parse(String(init?.body)), { featureSnapshotId: "17" });
    return Response.json(createdSession(), { status: 201 });
  }) as typeof fetch;

  const response = await createSessionPost(jsonRequest("/api/marketing/copilot/sessions", { featureSnapshotId: 17 }));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.status, "created");
  assert.equal(body.session.sessionId, SESSION_ID);
  assert.equal(JSON.stringify(body).includes("internal-token-1234"), false);
});

test("multi-turn messages reuse the provided sessionId", async () => {
  configureProxyEnv();
  const calls: Array<{ input: string; body: unknown }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({ input: String(input), body: JSON.parse(String(init?.body)) });
    return Response.json(answeredSessionTurn({ answer: calls.length === 1 ? "Primera respuesta." : "Segunda respuesta." }), { status: 200 });
  }) as typeof fetch;

  const first = await messagePost(jsonRequest(`/api/marketing/copilot/sessions/${SESSION_ID}/messages`, { question: "Cuantos clientes hay?" }), context());
  const second = await messagePost(jsonRequest(`/api/marketing/copilot/sessions/${SESSION_ID}/messages`, { question: "Cual tiene mayor ticket promedio?" }), context());

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(
    calls.map((call) => call.input),
    [
      `http://127.0.0.1:3101/v1/customer-intelligence/copilot/sessions/${SESSION_ID}/messages`,
      `http://127.0.0.1:3101/v1/customer-intelligence/copilot/sessions/${SESSION_ID}/messages`
    ]
  );
  assert.deepEqual(calls.map((call) => call.body), [{ question: "Cuantos clientes hay?" }, { question: "Cual tiene mayor ticket promedio?" }]);
});

test("new chat can delete the backend session best-effort through the proxy", async () => {
  configureProxyEnv();
  globalThis.fetch = (async (input, init) => {
    assert.equal(input, `http://127.0.0.1:3101/v1/customer-intelligence/copilot/sessions/${SESSION_ID}`);
    assert.equal(init?.method, "DELETE");
    assert.equal(new Headers(init?.headers).get("x-internal-copilot-token"), "internal-token-1234");
    return Response.json({ status: "deleted" }, { status: 200 });
  }) as typeof fetch;

  const response = await deleteSessionDelete(new Request(`http://localhost/api/marketing/copilot/sessions/${SESSION_ID}`, { method: "DELETE" }), context());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { status: "deleted" });
});

test("refresh context calls the real session refresh endpoint", async () => {
  configureProxyEnv();
  globalThis.fetch = (async (input, init) => {
    assert.equal(input, `http://127.0.0.1:3101/v1/customer-intelligence/copilot/sessions/${SESSION_ID}/refresh`);
    assert.equal(init?.method, "POST");
    return Response.json({ status: "refreshed", session: createdSession().session }, { status: 200 });
  }) as typeof fetch;

  const response = await refreshPost(jsonRequest(`/api/marketing/copilot/sessions/${SESSION_ID}/refresh`, {}), context());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "refreshed");
});

test("export proxy transmits XLSX bytes and attachment headers", async () => {
  configureProxyEnv();
  globalThis.fetch = (async (input, init) => {
    assert.equal(input, `http://127.0.0.1:3101/v1/customer-intelligence/copilot/sessions/${SESSION_ID}/export`);
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("x-internal-copilot-token"), "internal-token-1234");
    assert.deepEqual(JSON.parse(String(init?.body)), { queryId: "q1", format: "xlsx" });
    return new Response(new Uint8Array([80, 75, 3, 4]), {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": 'attachment; filename="customer-intelligence-2026.xlsx"'
      }
    });
  }) as typeof fetch;

  const response = await exportPost(jsonRequest(`/api/marketing/copilot/sessions/${SESSION_ID}/export`, { queryId: "q1", format: "xlsx" }), context());
  const bytes = new Uint8Array(await response.arrayBuffer());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="customer-intelligence-2026.xlsx"');
  assert.deepEqual([...bytes], [80, 75, 3, 4]);
});

test("export button remains protected from browser secrets on upstream errors", async () => {
  configureProxyEnv();
  globalThis.fetch = (async () => Response.json({ error: "query_not_found", message: "missing" }, { status: 404 })) as typeof fetch;

  const response = await exportPost(jsonRequest(`/api/marketing/copilot/sessions/${SESSION_ID}/export`, { queryId: "q1", format: "xlsx" }), context());
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(JSON.stringify(body).includes("internal-token-1234"), false);
});

function configureProxyEnv() {
  Object.assign(process.env, {
    MARKETING_COPILOT_ENABLED: "true",
    MARKETING_COPILOT_BACKEND_BASE_URL: "http://127.0.0.1:3101/",
    MARKETING_COPILOT_INTERNAL_TOKEN: "internal-token-1234",
    MARKETING_COPILOT_TIMEOUT_MS: "1000"
  });
}

function context() {
  return { params: Promise.resolve({ sessionId: SESSION_ID }) };
}

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function createdSession() {
  return {
    status: "created",
    session: {
      sessionId: SESSION_ID,
      sessionVersion: "customer-intelligence-copilot-session-v1",
      createdAt: "2026-08-20T12:00:00.000Z",
      lastActivityAt: "2026-08-20T12:00:00.000Z",
      expiresAt: "2026-08-20T13:00:00.000Z",
      pinnedContext: provenance(),
      turnCount: 0,
      resultCount: 0
    }
  };
}

function answeredSessionTurn(overrides: Partial<{ answer: string }> = {}) {
  return {
    sessionId: SESSION_ID,
    turnId: "00000000-0000-4000-8000-000000000002",
    queryIds: ["q1"],
    sourceQueryIds: [],
    ...answeredResponse(),
    answer: overrides.answer ?? "Hay 123 clientes distribuidos en 4 clusters."
  };
}

function answeredResponse() {
  return {
    status: "answered",
    answer: "Hay 123 clientes distribuidos en 4 clusters.",
    analysis: {
      contractVersion: "customer-intelligence-copilot-v1",
      analysisPlanVersion: "customer-intelligence-copilot-analysis-plan-v1",
      queryCount: 1,
      queryPlanHashes: ["hash-1"],
      resultRowCount: 4,
      executionDurationMs: 23,
      plannerModel: "openai_compatible:model",
      answerModel: "openai_compatible:model"
    },
    provenance: provenance()
  };
}

function provenance() {
  return {
    featureSnapshot: {
      snapshotId: "1001",
      referenceTime: "2026-08-20T00:00:00.000Z",
      featureVersion: "customer_features_v1",
      populationPolicyVersion: "active_customers_v1"
    },
    rfmSnapshot: {
      snapshotId: "501",
      referenceTime: "2026-08-18T00:00:00.000Z",
      calculationVersion: "rfm-v1"
    },
    clusterSnapshot: {
      snapshotId: "301",
      referenceTime: "2026-08-20T01:00:00.000Z",
      modelId: "cluster-model",
      modelVersion: "cluster-v1"
    },
    population: {
      featurePopulation: 123,
      rfmMatched: 100,
      clusterMatched: 80,
      bothMatched: 70,
      neitherMatched: 13,
      rfmCoveragePct: 81.3,
      clusterCoveragePct: 65
    },
    contractVersion: "customer-intelligence-read-model-v1"
  };
}
