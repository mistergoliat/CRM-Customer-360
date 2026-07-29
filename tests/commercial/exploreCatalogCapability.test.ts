import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import {
  EXPLORE_CATALOG_INPUT_SCHEMA,
  GET_PRODUCT_DETAILS_INPUT_SCHEMA,
  SEARCH_PRODUCTS_INPUT_SCHEMA,
  resetCapabilityGatewayCatalogPortForTests,
  resolveCapabilityGatewayDefinition
} from "@/lib/brain/commercial/capability-gateway/registry";
import { SEARCH_COMPANY_KNOWLEDGE_INPUT_SCHEMA } from "@/lib/brain/commercial/capability-gateway/companyKnowledgeCapability";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway/types";

/**
 * ACS-R1-05.1-T02.6.1. These tests call each capability's own execute()
 * directly (via resolveCapabilityGatewayDefinition), never
 * executeGovernedCapability - that keeps them DB-free (only the audit insert
 * in executeCapability.ts touches MariaDB; the capability's own execute()
 * never does). Real HTTP double for the Catalog Service, same pattern as
 * tests/commercial/capabilityGateway.test.ts.
 */

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
});

function configureCatalogEnv() {
  process.env.CATALOG_SERVICE_BASE_URL = baseUrl;
  process.env.CATALOG_SERVICE_API_KEY = "test-key";
  resetCapabilityGatewayCatalogPortForTests();
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function exploreResponsePayload(overrides: Record<string, unknown> = {}) {
  return {
    scope: { availability: "available" },
    sort: { by: "price", direction: "desc" },
    totalMatched: 833,
    exhaustiveForScope: true,
    products: [{ productId: "1532", name: "Camara Hiperbarica ST801", price: 8599990, currency: "CLP", stockQuantity: 4, stockScope: "product", availability: "available" }],
    ...overrides
  };
}

const CONTEXT: CapabilityGatewayContext = { correlationId: "corr-explore-capability-test" };

function exploreDefinition() {
  const definition = resolveCapabilityGatewayDefinition("explore_catalog");
  assert.ok(definition, "explore_catalog must be registered");
  return definition!;
}

test.beforeEach(() => {
  handler = (_req, res) => res.writeHead(500).end();
});

// --- Schema shape (spec section 8, tests 1-3) ---

test("ACS-R1-05.1-T02.6.1: explore_catalog schema requires exactly sort and limit", () => {
  assert.deepEqual(EXPLORE_CATALOG_INPUT_SCHEMA.required, ["sort", "limit"]);
  assert.equal(EXPLORE_CATALOG_INPUT_SCHEMA.additionalProperties, false);
});

test("explore_catalog schema uses sort.by/sort.direction, never orderBy/orderDirection anywhere", () => {
  const serialized = JSON.stringify(EXPLORE_CATALOG_INPUT_SCHEMA);
  assert.match(serialized, /"sort"/);
  assert.match(serialized, /"by"/);
  assert.match(serialized, /"direction"/);
  assert.doesNotMatch(serialized, /orderBy|orderDirection/);
  assert.deepEqual(EXPLORE_CATALOG_INPUT_SCHEMA.properties.sort.required, ["by", "direction"]);
  assert.deepEqual(EXPLORE_CATALOG_INPUT_SCHEMA.properties.sort.properties.by.enum, ["price", "stock", "name"]);
  assert.deepEqual(EXPLORE_CATALOG_INPUT_SCHEMA.properties.sort.properties.direction.enum, ["asc", "desc"]);
  assert.equal(EXPLORE_CATALOG_INPUT_SCHEMA.properties.limit.maximum, 10);
});

test("resolveCapabilityGatewayDefinition exposes inputSchema for search_products, get_product_details and explore_catalog", () => {
  assert.deepEqual(resolveCapabilityGatewayDefinition("search_products")?.inputSchema, SEARCH_PRODUCTS_INPUT_SCHEMA);
  assert.deepEqual(resolveCapabilityGatewayDefinition("get_product_details")?.inputSchema, GET_PRODUCT_DETAILS_INPUT_SCHEMA);
  assert.deepEqual(resolveCapabilityGatewayDefinition("explore_catalog")?.inputSchema, EXPLORE_CATALOG_INPUT_SCHEMA);
  assert.deepEqual(resolveCapabilityGatewayDefinition("search_company_knowledge")?.inputSchema, SEARCH_COMPANY_KNOWLEDGE_INPUT_SCHEMA);
  assert.equal(SEARCH_PRODUCTS_INPUT_SCHEMA.required[0], "query");
  assert.equal(GET_PRODUCT_DETAILS_INPUT_SCHEMA.required[0], "productId");
  assert.equal(SEARCH_COMPANY_KNOWLEDGE_INPUT_SCHEMA.required[0], "query");
});

// --- Legacy sort alias (spec section 6 + 8, tests 6-7) ---

test("ACS-R1-05.1-T02.6.1: real incident regression - {orderBy, orderDirection} with no sort key is normalized to nested sort and executes successfully", async () => {
  let capturedBody: Record<string, unknown> = {};
  handler = (req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      capturedBody = JSON.parse(raw);
      sendJson(res, 200, exploreResponsePayload());
    });
  };
  configureCatalogEnv();

  const outcome = await exploreDefinition().execute({ orderBy: "price", orderDirection: "desc", limit: 1 }, CONTEXT);

  assert.equal(outcome.status, "completed");
  assert.deepEqual(capturedBody.sort, { by: "price", direction: "desc" });
  assert.equal("orderBy" in capturedBody, false);
  assert.equal("orderDirection" in capturedBody, false);
  assert.deepEqual(outcome.warnings, ["explore_catalog_legacy_sort_alias_used"]);
});

test("an unrecognized legacy alias value is never converted - stays invalid_arguments, zero HTTP calls", async () => {
  let calls = 0;
  handler = (_req, res) => {
    calls += 1;
    sendJson(res, 200, exploreResponsePayload());
  };
  configureCatalogEnv();

  const outcome = await exploreDefinition().execute({ orderBy: "not_a_field", orderDirection: "desc", limit: 1 }, CONTEXT);

  assert.equal(outcome.status, "invalid_arguments");
  assert.equal(outcome.errorCode, "sort_and_limit_required");
  assert.equal(calls, 0);
});

test("the legacy alias is only considered when sort is entirely absent - a malformed sort is never rescued by orderBy/orderDirection", async () => {
  let calls = 0;
  handler = (_req, res) => {
    calls += 1;
    sendJson(res, 200, exploreResponsePayload());
  };
  configureCatalogEnv();

  const outcome = await exploreDefinition().execute({ sort: "not-an-object", orderBy: "price", orderDirection: "desc", limit: 1 }, CONTEXT);

  assert.equal(outcome.status, "invalid_arguments");
  assert.equal(outcome.errorCode, "sort_and_limit_required");
  assert.equal(calls, 0);
});

test("a well-formed sort takes precedence - orderBy/orderDirection are ignored when both are present", async () => {
  let capturedBody: Record<string, unknown> = {};
  handler = (req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      capturedBody = JSON.parse(raw);
      sendJson(res, 200, exploreResponsePayload());
    });
  };
  configureCatalogEnv();

  const outcome = await exploreDefinition().execute(
    { sort: { by: "name", direction: "asc" }, orderBy: "price", orderDirection: "desc", limit: 1 },
    CONTEXT
  );

  assert.equal(outcome.status, "completed");
  assert.deepEqual(capturedBody.sort, { by: "name", direction: "asc" });
  assert.deepEqual(outcome.warnings ?? [], []);
});

// --- Closed schema in practice (spec section 8, test 8) ---

test("unknown/arbitrary properties never reach the Catalog Service adapter", async () => {
  let capturedBody: Record<string, unknown> = {};
  handler = (req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      capturedBody = JSON.parse(raw);
      sendJson(res, 200, exploreResponsePayload());
    });
  };
  configureCatalogEnv();

  const outcome = await exploreDefinition().execute(
    { sort: { by: "price", direction: "desc" }, limit: 1, injectedField: "should never appear" },
    CONTEXT
  );

  assert.equal(outcome.status, "completed");
  // "availability" is always present (the capability defaults it to
  // "available" when the model omits it) - "injectedField" must not be.
  assert.deepEqual(Object.keys(capturedBody).sort(), ["availability", "limit", "sort"]);
});

// --- limit bound matches the declared schema (maximum: 10) ---

test("limit above the schema's declared maximum (10) is rejected client-side, zero HTTP calls", async () => {
  let calls = 0;
  handler = (_req, res) => {
    calls += 1;
    sendJson(res, 200, exploreResponsePayload());
  };
  configureCatalogEnv();

  const outcome = await exploreDefinition().execute({ sort: { by: "price", direction: "desc" }, limit: 11 }, CONTEXT);

  assert.equal(outcome.status, "invalid_arguments");
  assert.equal(outcome.errorCode, "limit_out_of_range");
  assert.equal(calls, 0);
});
