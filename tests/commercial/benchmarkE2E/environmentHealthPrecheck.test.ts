import assert from "node:assert/strict";
import test from "node:test";
import { aggregateEnvironmentHealth } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/environmentHealthPrecheck";
import type { BenchmarkE2EDependencyCheck } from "@/lib/brain/commercial/agent-loop/benchmark/r3CommercialE2E/types";

// SALES-AGENT-R3-P7.4. Pure unit tests for the aggregation rule only (the
// real per-dependency checks are IO - checkEnvironmentHealth - and are
// exercised by the DB-backed integration suite, ENVIRONMENT_BLOCKED without
// MariaDB, same as the rest of this repo's DB-backed suites).

function dep(overrides: Partial<BenchmarkE2EDependencyCheck>): BenchmarkE2EDependencyCheck {
  return { name: "mariadb", status: "READY", detail: "", ...overrides };
}

test("all READY (or NOT_REQUIRED) -> overall READY", () => {
  const health = aggregateEnvironmentHealth([dep({ status: "READY" }), dep({ name: "quoteService", status: "NOT_REQUIRED" })], "t");
  assert.equal(health.status, "READY");
});

test("a NOT_REQUIRED dependency being BLOCKED never drags down the overall status", () => {
  const health = aggregateEnvironmentHealth([dep({ status: "READY" }), dep({ name: "carrierService", status: "NOT_REQUIRED", detail: "always stubbed" })], "t");
  assert.equal(health.status, "READY");
});

test("a required BLOCKED dependency makes the overall status BLOCKED", () => {
  const health = aggregateEnvironmentHealth([dep({ status: "BLOCKED" })], "t");
  assert.equal(health.status, "BLOCKED");
});

test("a required DEGRADED dependency (with no BLOCKED) makes the overall status DEGRADED", () => {
  const health = aggregateEnvironmentHealth([dep({ status: "READY" }), dep({ name: "quoteService", status: "DEGRADED" })], "t");
  assert.equal(health.status, "DEGRADED");
});

test("BLOCKED outranks DEGRADED when both are present", () => {
  const health = aggregateEnvironmentHealth([dep({ status: "DEGRADED" }), dep({ name: "quoteService", status: "BLOCKED" })], "t");
  assert.equal(health.status, "BLOCKED");
});

test("dependencies list is preserved verbatim for the manifest", () => {
  const dependencies = [dep({ status: "READY" })];
  const health = aggregateEnvironmentHealth(dependencies, "checked-at");
  assert.equal(health.checkedAt, "checked-at");
  assert.deepEqual(health.dependencies, dependencies);
});
