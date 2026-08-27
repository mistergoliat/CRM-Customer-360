import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { POST as legacyPost } from "@/app/api/marketing/copilot/route";
import { POST as createSessionPost } from "@/app/api/marketing/copilot/sessions/route";
import { DELETE as deleteSessionDelete } from "@/app/api/marketing/copilot/sessions/[sessionId]/route";
import { POST as exportPost } from "@/app/api/marketing/copilot/sessions/[sessionId]/export/route";
import { POST as messagePost } from "@/app/api/marketing/copilot/sessions/[sessionId]/messages/route";
import { POST as refreshPost } from "@/app/api/marketing/copilot/sessions/[sessionId]/refresh/route";
import { GET as dashboardClustersGet } from "@/app/api/marketing/customer-intelligence/dashboard/clusters/route";
import { GET as dashboardContextGet } from "@/app/api/marketing/customer-intelligence/dashboard/context/route";
import { POST as dashboardIntersectionsPost } from "@/app/api/marketing/customer-intelligence/dashboard/intersections/route";
import { GET as dashboardOverviewGet } from "@/app/api/marketing/customer-intelligence/dashboard/overview/route";
import { GET as dashboardRfmGet } from "@/app/api/marketing/customer-intelligence/dashboard/rfm/route";

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

test("session message proxy forwards optional uiContext unchanged", async () => {
  configureProxyEnv();
  const uiContext = {
    intersection: {
      contractVersion: "customer-intelligence-copilot-ui-context-v1",
      filters: { and: [{ field: "rfm.segmentCode", operator: "eq", value: "CHAMPION" }] }
    }
  };
  globalThis.fetch = (async (input, init) => {
    assert.equal(input, `http://127.0.0.1:3101/v1/customer-intelligence/copilot/sessions/${SESSION_ID}/messages`);
    assert.deepEqual(JSON.parse(String(init?.body)), { question: "Que ves interesante?", uiContext });
    return Response.json(answeredSessionTurn(), { status: 200 });
  }) as typeof fetch;

  const response = await messagePost(jsonRequest(`/api/marketing/copilot/sessions/${SESSION_ID}/messages`, { question: "Que ves interesante?", uiContext }), context());

  assert.equal(response.status, 200);
});

test("session message proxy preserves invalid_ui_context as a deterministic 400", async () => {
  configureProxyEnv();
  globalThis.fetch = (async () =>
    Response.json(
      {
        sessionId: SESSION_ID,
        turnId: "00000000-0000-4000-8000-000000000003",
        queryIds: [],
        sourceQueryIds: [],
        status: "invalid_ui_context",
        finalResponseState: "failure",
        errors: ["unknown field: bogus.field"],
        contractVersion: "customer-intelligence-copilot-v1"
      },
      { status: 400 }
    )) as typeof fetch;

  const response = await messagePost(
    jsonRequest(`/api/marketing/copilot/sessions/${SESSION_ID}/messages`, {
      question: "Cuantos son?",
      uiContext: { intersection: { filters: { field: "bogus.field", operator: "eq", value: 1 } } }
    }),
    context()
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.status, "invalid_ui_context");
  assert.deepEqual(body.errors, ["unknown field: bogus.field"]);
});

test("dashboard proxy calls Customer Profile dashboard endpoints with the server-side token", async () => {
  configureProxyEnv();
  const calls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    calls.push(String(input));
    assert.equal(new Headers(init?.headers).get("x-internal-copilot-token"), "internal-token-1234");
    assert.equal(init?.method, "GET");
    return Response.json({ status: "available", contractVersion: "customer-intelligence-dashboard-context-v1", context: dashboardContext(), population: dashboardPopulation() }, { status: 200 });
  }) as typeof fetch;

  await dashboardContextGet(new Request("http://localhost/api/marketing/customer-intelligence/dashboard/context?featureSnapshotId=17"));
  await dashboardOverviewGet(new Request("http://localhost/api/marketing/customer-intelligence/dashboard/overview"));
  await dashboardRfmGet(new Request("http://localhost/api/marketing/customer-intelligence/dashboard/rfm"));
  await dashboardClustersGet(new Request("http://localhost/api/marketing/customer-intelligence/dashboard/clusters"));

  assert.deepEqual(calls, [
    "http://127.0.0.1:3101/v1/customer-intelligence/dashboard/context?featureSnapshotId=17",
    "http://127.0.0.1:3101/v1/customer-intelligence/dashboard/overview",
    "http://127.0.0.1:3101/v1/customer-intelligence/dashboard/rfm",
    "http://127.0.0.1:3101/v1/customer-intelligence/dashboard/clusters"
  ]);
});

test("dashboard intersections proxy forwards the canonical filter tree without client-side interpretation", async () => {
  configureProxyEnv();
  const filters = { and: [{ field: "cluster.clusterId", operator: "eq", value: 3 }] };
  globalThis.fetch = (async (input, init) => {
    assert.equal(input, "http://127.0.0.1:3101/v1/customer-intelligence/dashboard/intersections");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("x-internal-copilot-token"), "internal-token-1234");
    assert.deepEqual(JSON.parse(String(init?.body)), { filters });
    return Response.json({ status: "available", contractVersion: "customer-intelligence-dashboard-intersection-response-v1", context: dashboardContext(), intersection: { matchingPopulation: 8, featurePopulation: 20, rfmMatchedPopulation: 10, clusterMatchedPopulation: 12, bothMatchedPopulation: 7, rfmCoveragePct: 50, clusterCoveragePct: 60, requiredDimensions: ["cluster"] }, metrics: intersectionMetrics(), analyticalDefinition: { queryPlanHash: "a".repeat(64), filters }, execution: { queryCount: 1, filterLeafCount: 1, filterDepth: 1 } }, { status: 200 });
  }) as typeof fetch;

  const response = await dashboardIntersectionsPost(jsonRequest("/api/marketing/customer-intelligence/dashboard/intersections", { filters }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.intersection.matchingPopulation, 8);
});

test("dashboard intersections proxy surfaces invalid_intersection distinctly", async () => {
  configureProxyEnv();
  globalThis.fetch = (async () =>
    Response.json(
      { status: "invalid_intersection", errors: ["unknown field: rfm.nope"], contractVersion: "customer-intelligence-dashboard-intersection-response-v1" },
      { status: 400 }
    )) as typeof fetch;

  const response = await dashboardIntersectionsPost(jsonRequest("/api/marketing/customer-intelligence/dashboard/intersections", { filters: { field: "rfm.nope", operator: "eq", value: "X" } }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.status, "invalid_intersection");
  assert.deepEqual(body.errors, ["unknown field: rfm.nope"]);
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

function dashboardContext() {
  return {
    featureSnapshotId: "17",
    featureReferenceTime: "2026-08-19T00:00:00.000Z",
    featureVersion: "customer-analytics-features-v1",
    populationPolicyVersion: "customer-analytics-population-b-v1",
    rfmSnapshotId: "9",
    rfmReferenceTime: "2026-08-18T00:00:00.000Z",
    rfmCalculationVersion: "rfm-v1",
    clusterSnapshotId: "5",
    clusterReferenceTime: "2026-08-17T00:00:00.000Z",
    clusterModelVersion: "behavioral-kmeans-k4-v1",
    clusterInterpretationVersion: "v1"
  };
}

function dashboardPopulation() {
  return {
    featurePopulation: 20,
    rfmMatched: 10,
    clusterMatched: 12,
    bothMatched: 7,
    neitherMatched: 5,
    rfmCoveragePct: 50,
    clusterCoveragePct: 60
  };
}

function intersectionMetrics() {
  return {
    totalSpentTaxIncl: "1000.000000",
    averageOrderValueTaxIncl: "100.000000",
    averageTotalSpentTaxIncl: "125.000000",
    averageValidOrders: "2.000000",
    averageOrders365d: "1.000000",
    averageDaysSinceLastOrder: "20.000000",
    averagePurchaseFrequencyDays: null,
    purchaseFrequencyDaysSampleSize: 0,
    averageEffectiveDiversity: "0.500000",
    averageRepeatProductRate: "0.200000"
  };
}
