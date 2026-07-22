import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { after, before } from "node:test";
import { createHttpAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/httpAgentLoopProvider";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let handler: Handler = (_req, res) => res.writeHead(500).end();
let baseUrl = "";

before(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(JSON.parse(data || "{}")));
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function successResponse(content = JSON.stringify({ type: "respond", message: "hola" })) {
  return {
    id: "resp-1",
    model: "deepseek-v4-flash",
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 }
  };
}

const baseMessages = [
  { role: "system" as const, content: "sys" },
  { role: "user" as const, content: "user" }
];

test("[HP11] the effective model reaches the payload", async () => {
  let capturedBody: Record<string, unknown> = {};
  handler = async (req, res) => {
    capturedBody = await readBody(req);
    sendJson(res, 200, successResponse());
  };
  const provider = createHttpAgentLoopProvider({ endpoint: baseUrl, apiKey: "k", model: "custom-model-x" });
  await provider.invoke({ messages: baseMessages }, { timeoutMs: 5000 });
  assert.equal(capturedBody.model, "custom-model-x");
});

test("[HP12] the effective temperature reaches the payload", async () => {
  let capturedBody: Record<string, unknown> = {};
  handler = async (req, res) => {
    capturedBody = await readBody(req);
    sendJson(res, 200, successResponse());
  };
  const provider = createHttpAgentLoopProvider({ endpoint: baseUrl, apiKey: "k", temperature: 0.73 });
  await provider.invoke({ messages: baseMessages }, { timeoutMs: 5000 });
  assert.equal(capturedBody.temperature, 0.73);
});

test("[HP13] maxOutputTokens reaches the payload as max_tokens (the real OpenAI-compatible field name, not max_output_tokens)", async () => {
  let capturedBody: Record<string, unknown> = {};
  handler = async (req, res) => {
    capturedBody = await readBody(req);
    sendJson(res, 200, successResponse());
  };
  const provider = createHttpAgentLoopProvider({ endpoint: baseUrl, apiKey: "k", maxOutputTokens: 777 });
  await provider.invoke({ messages: baseMessages }, { timeoutMs: 5000 });
  assert.equal(capturedBody.max_tokens, 777);
  assert.equal(capturedBody.max_output_tokens, undefined);
});

test("[HP14] the effective timeout controls abort - a hung response fails instead of hanging forever", async () => {
  handler = () => {
    // Never responds.
  };
  const provider = createHttpAgentLoopProvider({ endpoint: baseUrl, apiKey: "k", maxModelRetries: 0 });
  const start = Date.now();
  await assert.rejects(() => provider.invoke({ messages: baseMessages }, { timeoutMs: 200 }));
  assert.ok(Date.now() - start < 3000, "must abort promptly, not hang");
});

test("[HP15] a transient failure (503) retries up to maxModelRetries, then succeeds", async () => {
  let callCount = 0;
  handler = (_req, res) => {
    callCount += 1;
    if (callCount <= 2) {
      sendJson(res, 503, { error: "unavailable" });
      return;
    }
    sendJson(res, 200, successResponse());
  };
  const provider = createHttpAgentLoopProvider({ endpoint: baseUrl, apiKey: "k", maxModelRetries: 2 });
  const result = await provider.invoke({ messages: baseMessages }, { timeoutMs: 10000 });
  assert.equal(callCount, 3);
  assert.deepEqual(result.rawOutput, { type: "respond", message: "hola" });
});

test("[HP15b] a transient failure that never recovers fails once maxModelRetries is exhausted, never one attempt beyond it", async () => {
  let callCount = 0;
  handler = (_req, res) => {
    callCount += 1;
    sendJson(res, 503, { error: "unavailable" });
  };
  const provider = createHttpAgentLoopProvider({ endpoint: baseUrl, apiKey: "k", maxModelRetries: 1 });
  await assert.rejects(() => provider.invoke({ messages: baseMessages }, { timeoutMs: 10000 }));
  assert.equal(callCount, 2, "1 initial attempt + 1 retry, never a 3rd");
});

test("[HP15c] 429 is retried the same as a transient 5xx", async () => {
  let callCount = 0;
  handler = (_req, res) => {
    callCount += 1;
    if (callCount === 1) {
      sendJson(res, 429, { error: "rate_limited" });
      return;
    }
    sendJson(res, 200, successResponse());
  };
  const provider = createHttpAgentLoopProvider({ endpoint: baseUrl, apiKey: "k", maxModelRetries: 1 });
  const result = await provider.invoke({ messages: baseMessages }, { timeoutMs: 10000 });
  assert.equal(callCount, 2);
  assert.deepEqual(result.rawOutput, { type: "respond", message: "hola" });
});

test("[HP16] a non-retryable error (401) fails immediately without retrying", async () => {
  let callCount = 0;
  handler = (_req, res) => {
    callCount += 1;
    sendJson(res, 401, { error: "unauthorized" });
  };
  const provider = createHttpAgentLoopProvider({ endpoint: baseUrl, apiKey: "k", maxModelRetries: 3 });
  await assert.rejects(() => provider.invoke({ messages: baseMessages }, { timeoutMs: 10000 }));
  assert.equal(callCount, 1, "401 must never be retried");
});

test("[HP16b] a non-retryable error (400) fails immediately without retrying", async () => {
  let callCount = 0;
  handler = (_req, res) => {
    callCount += 1;
    sendJson(res, 400, { error: "bad_request" });
  };
  const provider = createHttpAgentLoopProvider({ endpoint: baseUrl, apiKey: "k", maxModelRetries: 3 });
  await assert.rejects(() => provider.invoke({ messages: baseMessages }, { timeoutMs: 10000 }));
  assert.equal(callCount, 1, "400 must never be retried");
});

test("[HP17] retries never exceed the total time budget, even with retries still available", async () => {
  let callCount = 0;
  handler = (_req, res) => {
    callCount += 1;
    sendJson(res, 503, { error: "unavailable" });
  };
  const provider = createHttpAgentLoopProvider({ endpoint: baseUrl, apiKey: "k", maxModelRetries: 5 });
  const start = Date.now();
  await assert.rejects(() => provider.invoke({ messages: baseMessages }, { timeoutMs: 600 }));
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 3000, `expected to fail well within the budget, took ${elapsed}ms`);
  assert.ok(callCount < 6, "the time budget must cut retries short before all 5 are exhausted");
});
