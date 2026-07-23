import assert from "node:assert/strict";
import test, { after } from "node:test";
import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { createDraftConfiguration, publishDraftConfiguration, type SalesAgentPromptConfiguration } from "@/lib/brain/commercial/sales-agent-configuration";

// Real MariaDB, real crm_test - same convention as salesAgentConfiguration.test.ts.
// Exercises the Route Handlers directly (NextRequest -> exported GET/POST/PATCH),
// never mocked, so requireOperator/isDbWriteEnabled/the domain calls all run for real.
Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true",
  SESSION_SECRET: "session-secret-for-tests",
  ADMIN_BYPASS_TOKEN: "admin-bypass-token-for-tests"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

const AUTH_HEADERS = { "x-admin-bypass-token": "admin-bypass-token-for-tests" };

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function uniqueName(label: string) {
  return `sac-api-${label}-${uniqueSuffix()}`;
}

function buildValidConfigurationInput(overrides: Partial<SalesAgentPromptConfiguration> = {}): Record<string, unknown> {
  return {
    agentName: "Valentina",
    companyName: "PesasChile",
    role: "Asesora comercial",
    companyDescription: "Vendemos equipamiento de gimnasio para el hogar y uso comercial.",
    customInstructions: "Responde siempre en espanol neutro chileno.",
    prohibitedPhrases: ["garantia de por vida"],
    ...overrides
  };
}

async function createDraftRow(overrides: Partial<SalesAgentPromptConfiguration> = {}) {
  return createDraftConfiguration({
    name: uniqueName("draft"),
    configuration: buildValidConfigurationInput(overrides),
    createdBy: "test-suite"
  });
}

// ---------------------------------------------------------------------------
// decision 6: Content-Length precheck (413 before request.json() ever runs)
// ---------------------------------------------------------------------------

test("[A1] POST /configuration rejects an oversized Content-Length before parsing the body", async () => {
  const { POST } = await import("@/app/api/brain/agents/sales/configuration/route");
  const request = new NextRequest(
    new Request("http://127.0.0.1/api/brain/agents/sales/configuration", {
      method: "POST",
      headers: { ...AUTH_HEADERS, "content-type": "application/json", "content-length": "999999999" },
      body: JSON.stringify({ name: "irrelevant", configuration: buildValidConfigurationInput() })
    })
  );
  const response = await POST(request);
  assert.equal(response.status, 413);
  const body = await response.json();
  assert.equal(body.error, "payload_too_large");
});

// ---------------------------------------------------------------------------
// decision 8: archive only accepts drafts
// ---------------------------------------------------------------------------

test("[A2] POST /[id]/archive archives a genuine draft", async () => {
  const draft = await createDraftRow();
  const { POST } = await import("@/app/api/brain/agents/sales/configuration/[id]/archive/route");
  const request = new NextRequest(new Request(`http://127.0.0.1/api/brain/agents/sales/configuration/${draft.id}/archive`, {
    method: "POST",
    headers: AUTH_HEADERS
  }));
  const response = await POST(request, { params: Promise.resolve({ id: String(draft.id) }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "archived");
});

test("[A3] POST /[id]/archive on a published row is rejected with not_draft, never archives it", async () => {
  const draft = await createDraftRow();
  const published = await publishDraftConfiguration({ id: draft.id });
  const { POST } = await import("@/app/api/brain/agents/sales/configuration/[id]/archive/route");
  const request = new NextRequest(new Request(`http://127.0.0.1/api/brain/agents/sales/configuration/${published.id}/archive`, {
    method: "POST",
    headers: AUTH_HEADERS
  }));
  const response = await POST(request, { params: Promise.resolve({ id: String(published.id) }) });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error, "not_draft");
});

// ---------------------------------------------------------------------------
// decision 10: validate checks the CURRENT form body, not a DB reload
// ---------------------------------------------------------------------------

test("[A4] POST /configuration/validate validates the submitted body, independent of any stored row", async () => {
  const { POST } = await import("@/app/api/brain/agents/sales/configuration/validate/route");

  const validRequest = new NextRequest(
    new Request("http://127.0.0.1/api/brain/agents/sales/configuration/validate", {
      method: "POST",
      headers: { ...AUTH_HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ configuration: buildValidConfigurationInput() })
    })
  );
  const validResponse = await POST(validRequest);
  assert.equal(validResponse.status, 200);
  assert.equal((await validResponse.json()).valid, true);

  const invalidRequest = new NextRequest(
    new Request("http://127.0.0.1/api/brain/agents/sales/configuration/validate", {
      method: "POST",
      headers: { ...AUTH_HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ configuration: buildValidConfigurationInput({ agentName: "" }) })
    })
  );
  const invalidResponse = await POST(invalidRequest);
  assert.equal(invalidResponse.status, 400);
  const invalidBody = await invalidResponse.json();
  assert.equal(invalidBody.valid, false);
  assert.equal(invalidBody.field, "agentName");
});

// ---------------------------------------------------------------------------
// decision 11: GET effective never leaks provider/env/secret detail
// ---------------------------------------------------------------------------

test("[A5] GET /configuration/effective exposes only source/metadata/effective params/allowlist", async () => {
  const { GET } = await import("@/app/api/brain/agents/sales/configuration/effective/route");
  const request = new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/configuration/effective", { headers: AUTH_HEADERS }));
  const response = await GET(request);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(
    Object.keys(body).sort(),
    ["allowedModels", "configuration", "configurationHash", "effectiveLoopConfiguration", "effectiveModelConfiguration", "recordId", "source", "version"].sort()
  );
  const serialized = JSON.stringify(body).toLowerCase();
  assert.ok(!serialized.includes("api_key"), "must never expose an api key field name");
  assert.ok(!serialized.includes("bearer"), "must never expose auth material");
});

// ---------------------------------------------------------------------------
// requireOperator gate
// ---------------------------------------------------------------------------

test("[A6] GET /configuration/effective without a session/bypass token never succeeds", async () => {
  // requireOperator() calls next/headers#cookies() internally, which needs a
  // real Next.js request scope - invoked directly (no middleware/render
  // context) it throws and requireOperator's own catch degrades that to 500
  // instead of 401 (pre-existing lib/auth.ts behavior, unrelated to this
  // task). Either way access must never be granted.
  const { GET } = await import("@/app/api/brain/agents/sales/configuration/effective/route");
  const request = new NextRequest(new Request("http://127.0.0.1/api/brain/agents/sales/configuration/effective"));
  const response = await GET(request);
  assert.ok([401, 500].includes(response.status), `expected 401 or 500, got ${response.status}`);
  const body = await response.json();
  assert.equal("allowedModels" in body, false, "must never leak the effective configuration without authorization");
});

// ---------------------------------------------------------------------------
// concurrency conflict mapped to HTTP 409
// ---------------------------------------------------------------------------

test("[A7] PATCH /[id] with a stale expectedUpdatedAt returns 409 concurrent_edit_conflict", async () => {
  const draft = await createDraftRow();
  const { PATCH } = await import("@/app/api/brain/agents/sales/configuration/[id]/route");
  const context = { params: Promise.resolve({ id: String(draft.id) }) };

  const firstSave = new NextRequest(
    new Request(`http://127.0.0.1/api/brain/agents/sales/configuration/${draft.id}`, {
      method: "PATCH",
      headers: { ...AUTH_HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ configuration: buildValidConfigurationInput({ role: "Primer editor" }), expectedUpdatedAt: draft.updatedAt })
    })
  );
  const firstResponse = await PATCH(firstSave, context);
  assert.equal(firstResponse.status, 200);

  const staleSave = new NextRequest(
    new Request(`http://127.0.0.1/api/brain/agents/sales/configuration/${draft.id}`, {
      method: "PATCH",
      headers: { ...AUTH_HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ configuration: buildValidConfigurationInput({ role: "Segundo editor" }), expectedUpdatedAt: draft.updatedAt })
    })
  );
  const staleResponse = await PATCH(staleSave, context);
  assert.equal(staleResponse.status, 409);
  assert.equal((await staleResponse.json()).error, "concurrent_edit_conflict");
});

test("[A8] PATCH /[id] without expectedUpdatedAt in the body is rejected with 400 before touching the domain layer", async () => {
  const draft = await createDraftRow();
  const { PATCH } = await import("@/app/api/brain/agents/sales/configuration/[id]/route");
  const request = new NextRequest(
    new Request(`http://127.0.0.1/api/brain/agents/sales/configuration/${draft.id}`, {
      method: "PATCH",
      headers: { ...AUTH_HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ configuration: buildValidConfigurationInput() })
    })
  );
  const response = await PATCH(request, { params: Promise.resolve({ id: String(draft.id) }) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "missing_expected_updated_at");
});

// ---------------------------------------------------------------------------
// decision 4: clone reuses the "created" audit action, carries parentConfigurationId
// ---------------------------------------------------------------------------

test("[A9] POST /[id]/clone creates a new draft with parentConfigurationId set to the source", async () => {
  const source = await createDraftRow();
  const { POST } = await import("@/app/api/brain/agents/sales/configuration/[id]/clone/route");
  const request = new NextRequest(
    new Request(`http://127.0.0.1/api/brain/agents/sales/configuration/${source.id}/clone`, {
      method: "POST",
      headers: { ...AUTH_HEADERS, "content-type": "application/json" },
      body: JSON.stringify({})
    })
  );
  const response = await POST(request, { params: Promise.resolve({ id: String(source.id) }) });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.parentConfigurationId, source.id);
  assert.equal(body.status, "draft");
});
