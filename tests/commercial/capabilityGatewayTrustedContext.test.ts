import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { getPool } from "@/lib/db";
import { executeGovernedCapability } from "@/lib/brain/commercial/capability-gateway/executeCapability";
import { resetCapabilityGatewayCatalogPortForTests } from "@/lib/brain/commercial/capability-gateway/registry";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway/types";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session";

// SALES-AGENT-R3-P7.1 (Trusted Execution Context). Proves that threading
// workId/workVersion/objectiveId/objectiveType onto CapabilityGatewayContext
// does not change Gateway behavior on either the read-only or mutating path
// (P7.1-G/H/J), and does not add a second outbound call (P7.1-K). This is
// the real executeGovernedCapability entry point - same choke point every
// caller (ATL, R2's legacy executor) already goes through - not a mock.
//
// Requires local MariaDB (crm_capability_executions audit writes) and no
// live Catalog Service dependency (a local fake HTTP server stands in, same
// pattern as tests/commercial/capabilityGateway.test.ts).

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

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();

before(async () => {
  server = http.createServer((req, res) => handler(req, res));
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

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function configureCatalogEnv() {
  process.env.CATALOG_SERVICE_BASE_URL = baseUrl;
  process.env.CATALOG_SERVICE_API_KEY = "test-key";
  resetCapabilityGatewayCatalogPortForTests();
}

function searchProductsResponsePayload() {
  return {
    query: { original: "jaula", normalized: "jaula" },
    resolution: { status: "resolved", confidence: 0.9, sourceProduct: { productId: "1" } },
    candidates: [
      {
        product: { productId: "1", name: "Jaula de entrenamiento", price: { amount: 199990, currency: "CLP" }, stock: { status: "in_stock", available: true, quantity: 3 } },
        match: { rank: 1, score: 0.9, reasons: ["EXACT_NAME_MATCH"] }
      }
    ],
    statistics: { retrieved: 1, eligible: 1, returned: 1 },
    warnings: [],
    correlationId: "c"
  };
}

const TRUSTED_CONTEXT_FIELDS = {
  workId: "cw-trusted-1",
  workVersion: 3,
  objectiveId: "objective-trusted-1",
  objectiveType: "QUOTE"
} as const;

/** search_products' own projection stamps a fresh "retrievedAt" wall-clock timestamp per call - strip it (recursively; it appears at both the top-level and nested productIntent.provenance) before comparing two otherwise-identical invocations. */
function stripRetrievedAt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripRetrievedAt);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "retrievedAt");
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, stripRetrievedAt(entryValue)]));
  }
  return value;
}

function anonymousSession(): NativeCustomerSessionExecutionContext {
  return {
    conversationId: "conv-p7.1",
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: "56900002222", normalizedPhone: "56900002222", messageId: "wamid.p71", receivedAt: "2026-09-17T12:00:00.000Z" },
    identity: { status: "anonymous", customerId: null, source: "none", localResolutionOutcome: "anonymous", externalResolutionOutcome: null },
    masterCustomerIdentity: { status: "identity_unresolved", reason: "identity_source_unsupported" },
    runtimeIdentity: {
      status: "ANONYMOUS",
      identityLevel: "LEVEL_0_ANONYMOUS",
      masterCustomerId: null,
      prestashopCustomerId: null,
      verificationRequired: false,
      requiredEvidence: [],
      readyToLink: false,
      conflictCode: null,
      policyCode: "NO_CHANNEL_EVIDENCE",
      evidenceRefs: []
    },
    onboarding: null,
    contextAccess: "none",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: null },
    freshExternalResolutionEvidence: null
  };
}

// ---------------------------------------------------------------------------
// P7.1-G: read path (search_products) unchanged by presence/absence of
// trusted work/objective context.
// ---------------------------------------------------------------------------

test("P7.1-G: search_products returns the identical outcome with and without trusted work/objective context, and makes exactly one HTTP call either way", async () => {
  let requestCount = 0;
  handler = (_req, res) => {
    requestCount += 1;
    sendJson(res, 200, searchProductsResponsePayload());
  };
  configureCatalogEnv();

  const baseContext: Omit<CapabilityGatewayContext, "correlationId"> = { conversationId: 1, opportunityId: 1 };

  const withoutTrusted = await executeGovernedCapability("search_products", { query: "jaula" }, { ...baseContext, correlationId: `cap-p71-read-plain-${Date.now()}` });
  assert.equal(requestCount, 1, "expected exactly one HTTP call for the plain-context invocation");

  const withTrusted = await executeGovernedCapability(
    "search_products",
    { query: "jaula" },
    { ...baseContext, ...TRUSTED_CONTEXT_FIELDS, correlationId: `cap-p71-read-trusted-${Date.now()}` }
  );
  assert.equal(requestCount, 2, "expected exactly one additional HTTP call for the trusted-context invocation - no second call from carrying trusted context");

  assert.equal(withTrusted.status, withoutTrusted.status);
  assert.equal(withTrusted.availability, withoutTrusted.availability);
  assert.equal(withTrusted.errorCode, withoutTrusted.errorCode);
  assert.equal(withTrusted.retryable, withoutTrusted.retryable);
  assert.deepEqual(stripRetrievedAt(withTrusted.data), stripRetrievedAt(withoutTrusted.data));
  assert.equal(withTrusted.evidence.length, withoutTrusted.evidence.length);
  assert.equal(withTrusted.status, "completed");
});

// ---------------------------------------------------------------------------
// P7.1-H/J: mutation path (create_quote) unchanged by presence/absence of
// trusted work/objective context - the identity gate still decides purely
// from trustedCustomerSession, never from workId/objectiveId.
// ---------------------------------------------------------------------------

test("P7.1-H/J: create_quote below LEVEL_2 is denied identically with and without trusted work/objective context", async () => {
  const baseContext: Omit<CapabilityGatewayContext, "correlationId"> = { conversationId: 1, opportunityId: 1, trustedCustomerSession: anonymousSession() };

  const withoutTrusted = await executeGovernedCapability("create_quote", {}, { ...baseContext, correlationId: `cap-p71-mut-plain-${Date.now()}` });
  const withTrusted = await executeGovernedCapability("create_quote", {}, { ...baseContext, ...TRUSTED_CONTEXT_FIELDS, correlationId: `cap-p71-mut-trusted-${Date.now()}` });

  assert.equal(withoutTrusted.status, "denied");
  assert.equal(withoutTrusted.errorCode, "master_identity_required");
  assert.equal(withTrusted.status, withoutTrusted.status);
  assert.equal(withTrusted.errorCode, withoutTrusted.errorCode);
  assert.equal(withTrusted.availability, withoutTrusted.availability);
  assert.equal(withTrusted.retryable, withoutTrusted.retryable);
  // Never the capability's own execute()-layer codes - proof the identity
  // gate short-circuited identically in both cases, before checkAvailability/
  // execute ever saw the trusted context fields.
  assert.notEqual(withTrusted.errorCode, "quote_service_not_configured");
});
