import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before, beforeEach } from "node:test";
import { getPool, queryRows } from "@/lib/db";
import { executeGovernedCapability } from "@/lib/brain/commercial/capability-gateway/executeCapability";
import { resetCustomerServicePortForTests, resetOnboardingServiceForTests } from "@/lib/brain/commercial/capability-gateway";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session";

// ACS-R1-04-T07. The Gateway persists request_summary_json/response_summary_json
// verbatim from raw input/output by default (executeCapability.ts) - that is
// exactly what would leak phone/email/wa_id for resolve_customer's raw input.
// These tests audit that the three identity capabilities now persist only
// allowlisted, PII-free summaries (release spec section 7), while every
// other capability (search_products, etc.) keeps the unchanged raw behavior.

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
  DATABASE_URL: ""
});

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: unknown) => void;
let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
      }
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

beforeEach(() => {
  handler = (_req, res) => res.writeHead(500).end();
  process.env.CUSTOMER_SERVICE_BASE_URL = baseUrl;
  process.env.CUSTOMER_SERVICE_API_KEY = "test-key";
  resetCustomerServicePortForTests();
  resetOnboardingServiceForTests();
});

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function loadExecutionRow(correlationId: string) {
  const rows = await queryRows<Record<string, unknown>>(
    "SELECT * FROM crm_capability_executions WHERE correlation_id = ? ORDER BY id DESC LIMIT 1",
    [correlationId]
  );
  return rows[0] ?? null;
}

function session(overrides: Partial<NativeCustomerSessionExecutionContext> = {}): NativeCustomerSessionExecutionContext {
  return {
    conversationId: "conv-1",
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: "56911112222", normalizedPhone: "56911112222", messageId: "wamid.1", receivedAt: "2026-07-13T12:00:00.000Z" },
    identity: { status: "identification_required", customerId: null, source: "none", localResolutionOutcome: "identification_required", externalResolutionOutcome: "no_match" },
    onboarding: {
      id: 1,
      conversationId: "conv-1",
      opportunityId: null,
      status: "collecting",
      purpose: "quote",
      collected: { firstName: "Ana Secreta", email: "ana.secreta@example.com" },
      pendingFields: [],
      customerId: null,
      failedVerificationAttempts: 0,
      version: 1,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      completedAt: null
    },
    contextAccess: "none",
    currentTurnConsent: {
      createCustomer: { scope: "create_customer", messageId: "wamid.1", capturedAt: "2026-07-13T12:00:00.000Z", source: "current_inbound" },
      linkExternalIdentity: { scope: "link_external_identity", messageId: "wamid.1", capturedAt: "2026-07-13T12:00:00.000Z", source: "current_inbound" }
    },
    freshExternalResolutionEvidence: { source: "customer_service", requestId: "req-1", checkedAt: "2026-07-13T12:00:00.000Z", result: { status: "no_match" } },
    ...overrides
  };
}

function context(trustedCustomerSession: NativeCustomerSessionExecutionContext | null, correlationId: string): CapabilityGatewayContext {
  return { correlationId, trustedCustomerSession };
}

const FORBIDDEN_PATTERNS: RegExp[] = [
  /ana\.secreta@example\.com/i,
  /56911112222/,
  /Ana Secreta/,
  /wamid\.1/,
  /req-1/
];

function assertNoForbiddenContent(serialized: string) {
  for (const pattern of FORBIDDEN_PATTERNS) {
    assert.doesNotMatch(serialized, pattern);
  }
}

test("resolve_customer's persisted request summary is allowlisted - never the raw phoneNumber/email/externalId", async () => {
  handler = (_req, res) => sendJson(res, 404, { error: { code: "not_found" } });
  const correlationId = `identity-summary-resolve-${Date.now()}`;
  await executeGovernedCapability(
    "resolve_customer",
    { externalId: "56911112222", phoneNumber: "56911112222", email: "ana.secreta@example.com" },
    { correlationId }
  );
  const row = await loadExecutionRow(correlationId);
  assert.ok(row);
  const requestSummary = JSON.parse(String(row!.request_summary_json));
  assert.deepEqual(Object.keys(requestSummary).sort(), ["channel", "consentPresent", "emailAvailable", "hasExternalIdentity", "hasResolvedCustomer", "phoneAvailable", "purpose"].sort());
  assertNoForbiddenContent(JSON.stringify(requestSummary));
  assert.equal(requestSummary.phoneAvailable, true);
  assert.equal(requestSummary.emailAvailable, true);
});

test("resolve_customer's persisted response summary separates gatewayStatus from businessOutcome and never carries a raw customerId", async () => {
  handler = (_req, res) => sendJson(res, 200, { status: "resolved", customerMasterId: "700" });
  const correlationId = `identity-summary-resolve-response-${Date.now()}`;
  await executeGovernedCapability("resolve_customer", { externalId: "56911112222", phoneNumber: null, email: null }, { correlationId });
  const row = await loadExecutionRow(correlationId);
  const responseSummary = JSON.parse(String(row!.response_summary_json));
  assert.deepEqual(Object.keys(responseSummary).sort(), ["businessOutcome", "gatewayStatus", "hasExternalIdentity", "hasResolvedCustomer", "retryable", "stableErrorCode"].sort());
  assert.equal(responseSummary.businessOutcome, "resolved");
  assert.equal(responseSummary.gatewayStatus, "completed");
  assertNoForbiddenContent(JSON.stringify(responseSummary));
  assert.doesNotMatch(JSON.stringify(responseSummary), /700/);
});

test("create_customer's persisted request summary reflects the trusted session only - never onboarding.collected values", async () => {
  handler = (_req, res) => sendJson(res, 201, { status: "created", customerMasterId: "700" });
  const correlationId = `identity-summary-create-${Date.now()}`;
  await executeGovernedCapability("create_customer", {}, context(session(), correlationId));
  const row = await loadExecutionRow(correlationId);
  const requestSummary = JSON.parse(String(row!.request_summary_json));
  assert.deepEqual(Object.keys(requestSummary).sort(), ["channel", "consentPresent", "emailAvailable", "hasExternalIdentity", "hasResolvedCustomer", "phoneAvailable", "purpose"].sort());
  assert.equal(requestSummary.purpose, "quote");
  assert.equal(requestSummary.consentPresent, true);
  assertNoForbiddenContent(JSON.stringify(requestSummary));
});

test("create_customer's persisted response summary reports business outcome conflict distinctly from Gateway status completed", async () => {
  handler = (_req, res) => sendJson(res, 409, { error: { code: "conflict for ana.secreta@example.com", conflictCode: "conflict for ana.secreta@example.com" } });
  const correlationId = `identity-summary-create-conflict-${Date.now()}`;
  await executeGovernedCapability("create_customer", {}, context(session(), correlationId));
  const row = await loadExecutionRow(correlationId);
  const responseSummary = JSON.parse(String(row!.response_summary_json));
  assert.equal(responseSummary.gatewayStatus, "completed");
  assert.equal(responseSummary.businessOutcome, "conflict");
  assertNoForbiddenContent(JSON.stringify(responseSummary));
});

test("link_external_identity's persisted request/response summaries are also allowlisted and PII-free", async () => {
  handler = (_req, res) => sendJson(res, 200, { status: "completed", customerMasterId: "700", externalIdentityId: "ext-1" });
  const correlationId = `identity-summary-link-${Date.now()}`;
  const linkedSession = session({ identity: { status: "identified", customerId: "700", source: "normalized_phone", localResolutionOutcome: "identified", externalResolutionOutcome: null } });
  await executeGovernedCapability("link_external_identity", {}, context(linkedSession, correlationId));
  const row = await loadExecutionRow(correlationId);
  const requestSummary = JSON.parse(String(row!.request_summary_json));
  const responseSummary = JSON.parse(String(row!.response_summary_json));
  assert.deepEqual(Object.keys(requestSummary).sort(), ["channel", "consentPresent", "emailAvailable", "hasExternalIdentity", "hasResolvedCustomer", "phoneAvailable", "purpose"].sort());
  assert.deepEqual(Object.keys(responseSummary).sort(), ["businessOutcome", "gatewayStatus", "hasExternalIdentity", "hasResolvedCustomer", "retryable", "stableErrorCode"].sort());
  assertNoForbiddenContent(JSON.stringify(requestSummary) + JSON.stringify(responseSummary));
  assert.doesNotMatch(JSON.stringify(responseSummary), /ext-1|700/);
});
