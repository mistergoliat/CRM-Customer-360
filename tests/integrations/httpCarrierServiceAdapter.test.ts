import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { createHttpCarrierServiceAdapter, CARRIER_DEFAULT_HEIGHT, CARRIER_DEFAULT_WIDTH, CARRIER_DEFAULT_LENGTH } from "@/lib/integrations/carrier-service/httpCarrierServiceAdapter";
import type { CarrierService } from "@/lib/domains/carrier-service";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let server: http.Server;
let baseUrl: string;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let lastRequestUrl: string | null = null;

before(async () => {
  server = http.createServer((req, res) => {
    lastRequestUrl = req.url ?? null;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function makeAdapter(timeoutMs = 500): CarrierService {
  return createHttpCarrierServiceAdapter({ baseUrl, timeoutMs });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

test.beforeEach(() => {
  lastRequestUrl = null;
  handler = (_req, res) => res.writeHead(500).end();
});

// ---- E: exact HTTP request shape ----

test("E: quoteAll issues GET /api/pc-carrier/carrier/v1/all with the exact encoded query (destino/alto/ancho/largo/kilos/total_boleta)", async () => {
  let method: string | undefined;
  handler = (req, res) => {
    method = req.method;
    sendJson(res, 202, { options: [] });
  };

  await makeAdapter().quoteAll({ destination: "Ñuñoa", totalWeightKg: 10.5, totalBoleta: 150000 });

  assert.equal(method, "GET");
  assert.ok(lastRequestUrl);
  const url = new URL(lastRequestUrl as string, "http://localhost");
  assert.equal(url.pathname, "/api/pc-carrier/carrier/v1/all");
  assert.equal(url.searchParams.get("destino"), "Ñuñoa");
  assert.equal(url.searchParams.get("alto"), "1");
  assert.equal(url.searchParams.get("ancho"), "1");
  assert.equal(url.searchParams.get("largo"), "1");
  assert.equal(url.searchParams.get("kilos"), "10.5");
  assert.equal(url.searchParams.get("total_boleta"), "150000");
});

test("C: dimensions are always alto=1/ancho=1/largo=1 - CarrierQuoteInput has no field to override them", () => {
  assert.equal(CARRIER_DEFAULT_HEIGHT, 1);
  assert.equal(CARRIER_DEFAULT_WIDTH, 1);
  assert.equal(CARRIER_DEFAULT_LENGTH, 1);
});

test("destino with spaces and special characters is properly URL-encoded, never raw-concatenated", async () => {
  handler = (_req, res) => sendJson(res, 202, { options: [] });
  await makeAdapter().quoteAll({ destination: "isla de pascua", totalWeightKg: 20, totalBoleta: 10000 });
  assert.ok(lastRequestUrl);
  assert.ok(!(lastRequestUrl as string).includes(" "), "raw space must never appear unescaped in the request line");
  const url = new URL(lastRequestUrl as string, "http://localhost");
  assert.equal(url.searchParams.get("destino"), "isla de pascua");
});

// ---- success shapes (captured live against the real service) ----

test("maps a real single-option success response (Blue Express, Isla de Pascua)", async () => {
  handler = (_req, res) => sendJson(res, 202, { options: [{ carrier_name: "Blue Express", service_type: "EXPRESS", total_cost: 20994, estimated_delivery: "17-08-2026" }] });
  const result = await makeAdapter().quoteAll({ destination: "isla de pascua", totalWeightKg: 20, totalBoleta: 10000 });
  assert.deepEqual(result, {
    ok: true,
    options: [{ carrierName: "Blue Express", serviceType: "EXPRESS", totalCost: 20994, estimatedDelivery: "17-08-2026" }]
  });
});

test("maps a real multi-option success response including a non-date estimatedDelivery string (Pesas Chile despacho directo)", async () => {
  handler = (_req, res) =>
    sendJson(res, 202, {
      options: [
        { carrier_name: "Pesas Chile", service_type: "Despacho Directo", total_cost: 1, estimated_delivery: "1 a 2 días hábiles" },
        { carrier_name: "Blue Express", service_type: "EXPRESS", total_cost: 5351, estimated_delivery: "12-08-2026" }
      ]
    });
  const result = await makeAdapter().quoteAll({ destination: "Ñuñoa", totalWeightKg: 10, totalBoleta: 150000 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.options.length, 2);
  assert.equal(result.options[0].totalCost, 1);
  assert.equal(result.options[0].estimatedDelivery, "1 a 2 días hábiles");
});

test("L: no shipping options is a successful, empty-array response - never an error", async () => {
  handler = (_req, res) => sendJson(res, 202, { options: [] });
  const result = await makeAdapter().quoteAll({ destination: "ZZZNOWHERE", totalWeightKg: 10, totalBoleta: 150000 });
  assert.deepEqual(result, { ok: true, options: [] });
});

// ---- failure mapping (real captured shapes) ----

test("400 with a real captured error body maps to carrier_invalid_response, never coverage", async () => {
  handler = (_req, res) => sendJson(res, 400, { error: "destination is required" });
  const result = await makeAdapter().quoteAll({ destination: "", totalWeightKg: 10, totalBoleta: 1000 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "carrier_invalid_response");
  assert.equal(result.detail, "destination is required");
});

test("500 maps to carrier_service_unavailable, retryable technical failure", async () => {
  handler = (_req, res) => sendJson(res, 500, { error: "internal" });
  const result = await makeAdapter().quoteAll({ destination: "Ñuñoa", totalWeightKg: 10, totalBoleta: 1000 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "carrier_service_unavailable");
});

test("J: timeout maps to carrier_service_timeout, never throws", async () => {
  handler = () => {
    /* never responds - forces the client timeout */
  };
  const result = await makeAdapter(50).quoteAll({ destination: "Ñuñoa", totalWeightKg: 10, totalBoleta: 1000 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "carrier_service_timeout");
});

test("K: malformed JSON body fails closed as carrier_invalid_response", async () => {
  handler = (_req, res) => {
    res.writeHead(202, { "content-type": "application/json" });
    res.end("not json");
  };
  const result = await makeAdapter().quoteAll({ destination: "Ñuñoa", totalWeightKg: 10, totalBoleta: 1000 });
  assert.deepEqual(result, { ok: false, reason: "carrier_invalid_response", detail: "Carrier MS returned a non-JSON body." });
});

test("K: a response missing the options field fails closed, never treated as zero options", async () => {
  handler = (_req, res) => sendJson(res, 202, { unexpected: true });
  const result = await makeAdapter().quoteAll({ destination: "Ñuñoa", totalWeightKg: 10, totalBoleta: 1000 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "carrier_invalid_response");
});

test("K: one malformed option in the array fails the WHOLE response closed, never a partial list", async () => {
  handler = (_req, res) =>
    sendJson(res, 202, {
      options: [
        { carrier_name: "Blue Express", service_type: "EXPRESS", total_cost: 5351, estimated_delivery: "12-08-2026" },
        { carrier_name: "Starken" /* missing total_cost */ }
      ]
    });
  const result = await makeAdapter().quoteAll({ destination: "Ñuñoa", totalWeightKg: 10, totalBoleta: 1000 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "carrier_invalid_response");
});

test("network failure (connection refused) maps to carrier_service_unavailable", async () => {
  const adapter = createHttpCarrierServiceAdapter({ baseUrl: "http://127.0.0.1:1", timeoutMs: 500 });
  const result = await adapter.quoteAll({ destination: "Ñuñoa", totalWeightKg: 10, totalBoleta: 1000 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "carrier_service_unavailable");
});
