import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { POST as evaluatePost } from "@/app/api/audiences/evaluate/route";
import { POST as exportPost } from "@/app/api/audiences/export/route";
import { GET as schemaGet } from "@/app/api/audiences/schema/route";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

const HOME_GYM_DEFINITION = {
  definitionVersion: "customer-intelligence-audience-definition-v1",
  root: { kind: "HAS_AFFINITY", axis: "USE_CONTEXT", code: "HOME_GYM", minScore: "0.30" }
};

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

test("evaluate proxy stays closed when the audience flag is disabled", async () => {
  process.env.CUSTOMER_INTELLIGENCE_AUDIENCE_ENABLED = "false";

  const response = await evaluatePost(jsonRequest({ definition: HOME_GYM_DEFINITION }));
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.code, "audience_workspace_disabled");
});

test("evaluate rejects a malformed definition before ever calling the backend", async () => {
  configureEnv();
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return Response.json({}, { status: 200 });
  }) as typeof fetch;

  const response = await evaluatePost(jsonRequest({ definition: { definitionVersion: "wrong", root: {} } }));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("evaluate forwards the compiled definition with the internal evaluate token, never the export tokens", async () => {
  configureEnv();
  globalThis.fetch = (async (input, init) => {
    assert.equal(input, "http://127.0.0.1:3010/v1/customer-intelligence/audiences/evaluate");
    assert.equal(new Headers(init?.headers).get("x-internal-customer-intelligence-token"), "evaluate-token");
    assert.equal(new Headers(init?.headers).has("x-internal-customer-intelligence-export-token"), false);
    assert.deepEqual(JSON.parse(String(init?.body)), { definition: HOME_GYM_DEFINITION, previewLimit: 25 });
    // Real envelope shape confirmed against MS-pesaschile-customer-profile's
    // EvaluateAudienceCapabilityResponse: { capabilityVersion, evaluation: {...}, preview }.
    return Response.json(
      {
        capabilityVersion: "customer-intelligence-audience-capability-v1",
        evaluation: { status: "completed", populationUniverseCount: 10000, matchedCount: 3174, falseCount: 6826, unknownCount: 0, trueCount: 3174 },
        preview: { rows: [], returned: 0, truncated: false }
      },
      { status: 200 }
    );
  }) as typeof fetch;

  const response = await evaluatePost(jsonRequest({ definition: HOME_GYM_DEFINITION, previewLimit: 25 }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.evaluation.matchedCount, 3174);
  assert.equal(JSON.stringify(body).includes("evaluate-token"), false);
});

test("evaluate accepts previewLimit=0 (the real backend's minimum, not 1)", async () => {
  configureEnv();
  let capturedBody: unknown = null;
  globalThis.fetch = (async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return Response.json({ capabilityVersion: "v", evaluation: { status: "completed", populationUniverseCount: 0, matchedCount: 0, falseCount: 0, unknownCount: 0 }, preview: null }, { status: 200 });
  }) as typeof fetch;

  const response = await evaluatePost(jsonRequest({ definition: HOME_GYM_DEFINITION, previewLimit: 0 }));
  assert.equal(response.status, 200);
  assert.deepEqual(capturedBody, { definition: HOME_GYM_DEFINITION, previewLimit: 0 });
});

test("evaluate passes through an upstream 400 without retrying or reinterpreting it", async () => {
  configureEnv();
  globalThis.fetch = (async () => Response.json({ code: "invalid_definition_semantics", message: "unsupported combination" }, { status: 400 })) as typeof fetch;

  const response = await evaluatePost(jsonRequest({ definition: HOME_GYM_DEFINITION }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, "invalid_definition_semantics");
});

test("export rejects a field outside the allowlist server-side, regardless of what the client sends", async () => {
  configureEnv();
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response(new ArrayBuffer(0));
  }) as typeof fetch;

  const response = await exportPost(jsonRequest({ definition: HOME_GYM_DEFINITION, format: "CSV", fields: ["customerId", "rut"] }));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("export requires the PII token when PII fields are requested, and does not call upstream without it", async () => {
  configureEnv({ withPiiToken: false });
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response(new ArrayBuffer(0));
  }) as typeof fetch;

  const response = await exportPost(jsonRequest({ definition: HOME_GYM_DEFINITION, format: "CSV", fields: ["customerId", "email"] }));
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.code, "audience_pii_export_not_configured");
  assert.equal(called, false);
});

test("export forwards binary bytes untouched and preserves headers, including matched-count", async () => {
  configureEnv();
  const csvBytes = new TextEncoder().encode("customerId,email\n1,a@example.com\n");
  globalThis.fetch = (async (input, init) => {
    assert.equal(input, "http://127.0.0.1:3010/v1/customer-intelligence/audiences/export");
    assert.equal(new Headers(init?.headers).get("x-internal-customer-intelligence-export-token"), "export-token");
    assert.equal(new Headers(init?.headers).get("x-internal-customer-intelligence-pii-export-token"), "pii-token");
    return new Response(csvBytes, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="audience-export.csv"',
        "x-audience-export-matched-count": "3174",
        "x-audience-export-unknown-count": "0"
      }
    });
  }) as typeof fetch;

  const response = await exportPost(jsonRequest({ definition: HOME_GYM_DEFINITION, format: "CSV", fields: ["customerId", "email"] }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="audience-export.csv"');
  assert.equal(response.headers.get("x-audience-export-matched-count"), "3174");

  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes), "customerId,email\n1,a@example.com\n");
});

test("export rejects an unsupported format before calling upstream", async () => {
  configureEnv();
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response(new ArrayBuffer(0));
  }) as typeof fetch;

  const response = await exportPost(jsonRequest({ definition: HOME_GYM_DEFINITION, format: "GENERIC_CSV", fields: ["customerId"] }));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("schema proxy stays closed when the audience flag is disabled", async () => {
  process.env.CUSTOMER_INTELLIGENCE_AUDIENCE_ENABLED = "false";
  const response = await schemaGet(getRequest());
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.code, "audience_workspace_disabled");
});

test("schema proxy forwards the evaluate token (same gate as evaluate) and passes through the body untouched", async () => {
  configureEnv();
  globalThis.fetch = (async (input, init) => {
    assert.equal(input, "http://127.0.0.1:3010/v1/customer-intelligence/audiences/schema");
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("x-internal-customer-intelligence-token"), "evaluate-token");
    return Response.json({ capabilityVersion: "v", fields: [{ fieldId: "commercial.validOrders" }], limits: { maxConditions: 20 } }, { status: 200 });
  }) as typeof fetch;

  const response = await schemaGet(getRequest());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.fields, [{ fieldId: "commercial.validOrders" }]);
  assert.equal(JSON.stringify(body).includes("evaluate-token"), false);
});

function configureEnv(options: { readonly withPiiToken?: boolean } = {}) {
  Object.assign(process.env, {
    CUSTOMER_INTELLIGENCE_AUDIENCE_ENABLED: "true",
    MARKETING_COPILOT_BACKEND_BASE_URL: "http://127.0.0.1:3010/",
    MARKETING_COPILOT_TIMEOUT_MS: "1000",
    CUSTOMER_INTELLIGENCE_AUDIENCE_TOKEN: "evaluate-token",
    CUSTOMER_INTELLIGENCE_AUDIENCE_EXPORT_TOKEN: "export-token",
    CUSTOMER_INTELLIGENCE_AUDIENCE_PII_EXPORT_TOKEN: options.withPiiToken === false ? "" : "pii-token"
  });
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/audiences/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-bypass-token": adminBypassToken() },
    body: JSON.stringify(body)
  });
}

function getRequest() {
  return new Request("http://localhost/api/audiences/schema", {
    method: "GET",
    headers: { "x-admin-bypass-token": adminBypassToken() }
  });
}

function adminBypassToken(): string {
  process.env.ADMIN_BYPASS_TOKEN = process.env.ADMIN_BYPASS_TOKEN?.trim() || "test-admin-bypass-token";
  process.env.SESSION_SECRET = process.env.SESSION_SECRET?.trim() || "test-session-secret";
  return process.env.ADMIN_BYPASS_TOKEN;
}
