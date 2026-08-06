import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

/**
 * CP-R1-T12D. Static source guards, scoped exclusively to the commercial
 * signals/policy/relevance modules - never a blanket ban on `sort`/`filter`
 * elsewhere in the codebase (spec section 20: "No prohibir legítimos sort o
 * filter en otros contextos; limitar la guarda a los módulos de política
 * comercial"). Real, behavioral non-mutation is separately proven by the
 * dedicated immutability tests in customerHistoryCommercialSignals.test.ts /
 * customerHistoryCommercialPolicy.test.ts / customerHistoryRelevance.test.ts
 * - these are an additional, cheap, static defense-in-depth layer.
 */
const GUARDED_FILES = [
  "lib/brain/commercial/customer-profile-context/commercial-signals.ts",
  "lib/brain/commercial/customer-profile-context/commercial-policy.ts",
  "lib/brain/commercial/customer-profile-context/relevance.ts"
];

function readGuardedSources(): Map<string, string> {
  const sources = new Map<string, string>();
  for (const relativePath of GUARDED_FILES) {
    sources.set(relativePath, fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
  }
  return sources;
}

test("T12D commercial-policy modules never import the legacy customer-profile adapter", () => {
  for (const [relativePath, source] of readGuardedSources()) {
    assert.doesNotMatch(source, /@\/lib\/customer-profile(?:\/|["'])|(?:\.\.\/)+customer-profile(?:\/|["'])|lib\/customer-profile(?:\/|["'])/, relativePath);
  }
});

test("T12D commercial-policy modules never reference rfmSegment, monetaryScore, or vipStatus", () => {
  for (const [relativePath, source] of readGuardedSources()) {
    assert.doesNotMatch(source, /\brfmSegment\b/, relativePath);
    assert.doesNotMatch(source, /\bmonetaryScore\b/, relativePath);
    assert.doesNotMatch(source, /\bvipStatus\b/, relativePath);
  }
});

test("T12D commercial-policy modules never define a forbidden signal or guidance identifier (CUSTOMER_IS_VIP, HIGH_VALUE_CUSTOMER, etc.)", () => {
  const forbidden = [
    "CUSTOMER_IS_VIP",
    "HIGH_VALUE_CUSTOMER",
    "LOW_VALUE_CUSTOMER",
    "CUSTOMER_CAN_AFFORD",
    "CUSTOMER_PRICE_SENSITIVE",
    "LOYAL_CUSTOMER",
    "PREMIUM_CUSTOMER",
    "CHURN_RISK",
    "HIGH_LIFETIME_VALUE",
    "PRODUCT_SHOULD_BE_EXCLUDED",
    "PRODUCT_SHOULD_BE_BOOSTED"
  ];
  for (const [relativePath, source] of readGuardedSources()) {
    for (const identifier of forbidden) {
      assert.doesNotMatch(source, new RegExp(`\\b${identifier}\\b`), `${relativePath} must never define ${identifier}`);
    }
  }
});

test("T12D commercial-policy modules never sort, reverse, or reassign a recommendations/recommendationHistoryMatches array in place", () => {
  for (const [relativePath, source] of readGuardedSources()) {
    assert.doesNotMatch(source, /recommendations\.(sort|reverse)\(/, relativePath);
    assert.doesNotMatch(source, /recommendationHistoryMatches\.(sort|reverse)\(/, relativePath);
    assert.doesNotMatch(source, /\.recommendations\s*=/, relativePath);
    assert.doesNotMatch(source, /\.recommendationHistoryMatches\s*=/, relativePath);
  }
});

test("T12D commercial-policy modules never use filter() to exclude a purchased product from a candidates/recommendations list", () => {
  for (const [relativePath, source] of readGuardedSources()) {
    assert.doesNotMatch(source, /recommendations\.filter\(/, relativePath);
    assert.doesNotMatch(source, /candidates\.filter\([^)]*purchased/i, relativePath);
  }
});
