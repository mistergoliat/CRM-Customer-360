import fs from "node:fs";
import path from "node:path";

type Frontmatter = Record<string, string[]>;

const root = process.cwd();
const docsRoot = path.join(root, "docs");

function readText(relPath: string): string {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && full.endsWith(".md")) {
      out.push(path.relative(root, full).replaceAll("\\", "/"));
    }
  }
  return out;
}

function parseFrontmatter(text: string): Frontmatter | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return null;
  const block = text.slice(4, end);
  const data: Frontmatter = {};
  let currentKey: string | null = null;
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const keyMatch = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      data[currentKey] = keyMatch[2] ? [keyMatch[2]] : [];
      continue;
    }
    const itemMatch = line.match(/^\s*-\s+(.*)$/);
    if (itemMatch && currentKey) {
      data[currentKey].push(itemMatch[1]);
    }
  }
  return data;
}

function fail(messages: string[]): never {
  for (const message of messages) {
    console.error(`docs:validate: ${message}`);
  }
  process.exit(1);
}

const files = walk(docsRoot);
const fileText = new Map<string, string>();
const frontmatter = new Map<string, Frontmatter | null>();
for (const rel of files) {
  const text = readText(rel);
  fileText.set(rel, text);
  frontmatter.set(rel, parseFrontmatter(text));
}
for (const rel of ["AGENTS.md", "CLAUDE.md"]) {
  if (fs.existsSync(path.join(root, rel))) {
    fileText.set(rel, readText(rel));
  }
}

const errors: string[] = [];

function text(rel: string): string {
  const value = fileText.get(rel);
  if (!value) {
    errors.push(`missing file: ${rel}`);
    return "";
  }
  return value;
}

function has(rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

function fm(rel: string): Frontmatter {
  return frontmatter.get(rel) ?? {};
}

function sourceItems(rel: string): string[] {
  return fm(rel)["source_of_truth_for"] ?? [];
}

const roadmapDocs = files.filter((rel) => sourceItems(rel).includes("roadmap"));
if (roadmapDocs.length !== 1 || roadmapDocs[0] !== "docs/ROADMAP.md") {
  errors.push(
    `expected exactly one roadmap authority at docs/ROADMAP.md, found: ${roadmapDocs.join(", ") || "none"}`,
  );
}

const activeReleaseDocs = files.filter((rel) => sourceItems(rel).includes("active release"));
if (activeReleaseDocs.length !== 1 || activeReleaseDocs[0] !== "docs/ACTIVE_RELEASE.md") {
  errors.push(
    `expected exactly one active release authority at docs/ACTIVE_RELEASE.md, found: ${activeReleaseDocs.join(", ") || "none"}`,
  );
}

const capabilityMatrixDocs = files.filter((rel) => sourceItems(rel).includes("capability inventory"));
if (capabilityMatrixDocs.length !== 1 || capabilityMatrixDocs[0] !== "docs/CAPABILITY_MATRIX.md") {
  errors.push(
    `expected exactly one capability matrix authority at docs/CAPABILITY_MATRIX.md, found: ${capabilityMatrixDocs.join(", ") || "none"}`,
  );
}

const executionMapDocs = files.filter((rel) => sourceItems(rel).includes("MVP execution map"));
if (executionMapDocs.length !== 1 || executionMapDocs[0] !== "docs/product/MVP_EXECUTION_MAP.md") {
  errors.push(
    `expected exactly one MVP execution map authority at docs/product/MVP_EXECUTION_MAP.md, found: ${executionMapDocs.join(", ") || "none"}`,
  );
}

if (!text("CLAUDE.md").includes("AGENTS.md") || !text("CLAUDE.md").includes("autoridad canonica")) {
  errors.push("CLAUDE.md does not declare AGENTS.md as canonical authority");
}

const startHere = text("docs/00-START-HERE.md");
for (const required of [
  "docs/product/autonomous-commerce-prd.md",
  "docs/ROADMAP.md",
  "docs/ACTIVE_RELEASE.md",
  "docs/product/MVP_EXECUTION_MAP.md",
  "docs/CAPABILITY_MATRIX.md",
]) {
  if (!startHere.includes(required)) {
    errors.push(`docs/00-START-HERE.md is missing required pointer: ${required}`);
  }
}
if (!startHere.includes("P1/P2/P3") || !startHere.includes("historicas")) {
  errors.push("docs/00-START-HERE.md does not mark P1/P2/P3 as historical");
}

const roadmap = text("docs/ROADMAP.md");
if (!roadmap.includes("source_of_truth_for:\n  - roadmap")) {
  errors.push("docs/ROADMAP.md is not the sole roadmap authority");
}
for (const required of [
  "MVP_EXECUTION_MAP.md",
  "ACS-R1-04",
  "T06.1",
  "P1/P2/P3",
]) {
  if (!roadmap.includes(required)) {
    errors.push(`docs/ROADMAP.md is missing required content: ${required}`);
  }
}

const active = text("docs/ACTIVE_RELEASE.md");
for (const required of [
  "ACS-R1-04-T07",
  "ACS-R1-04-T08",
  "0c51419",
  "releases/ACS-R1-04-customer-identity-onboarding.md",
]) {
  if (!active.includes(required)) {
    errors.push(`docs/ACTIVE_RELEASE.md is missing required content: ${required}`);
  }
}

const releaseSpec = text("docs/releases/ACS-R1-04-customer-identity-onboarding.md");
for (const required of [
  "current_task: ACS-R1-04-T07",
  "ACS-R1-04-T06.1",
  "ACS-R1-04-T07",
  "Customer Service HTTP contract",
  "customer-service-capability",
  "0c51419",
]) {
  if (!releaseSpec.includes(required)) {
    errors.push(`release spec missing required content: ${required}`);
  }
}
if (!releaseSpec.includes("ACS-R1-04-T07` debe persistir executions")) {
  errors.push("release spec DoD for T07 is missing or unexpected");
}

const releaseIndex = text("docs/releases/README.md");
for (const required of [
  "ACS-R1-04",
  "SHA de cierre",
  "0c51419",
  "ACS-R1-03",
]) {
  if (!releaseIndex.includes(required)) {
    errors.push(`release index missing required content: ${required}`);
  }
}

const prd = text("docs/product/autonomous-commerce-prd.md");
if (!prd.includes("status: approved") || !prd.includes("Roadmap historico")) {
  errors.push("PRD is not approved or does not label the historical roadmap section");
}

const historicalRoadmap = text("docs/product/autonomous-commerce-roadmap.md");
if (!historicalRoadmap.includes("status: historical") || !historicalRoadmap.includes("MVP execution map")) {
  errors.push("historical autonomous commerce roadmap is not marked as historical");
}

const historicalMvpRoadmap = text("docs/product/mvp-roadmap.md");
if (!historicalMvpRoadmap.includes("Este documento es historico") || !historicalMvpRoadmap.includes("ROADMAP")) {
  errors.push("historical MVP roadmap is not clearly deprecated");
}

const agentMatrix = text("docs/product/agent-capability-matrix.md");
if (!agentMatrix.includes("status: historical") || !agentMatrix.includes("historico")) {
  errors.push("agent capability matrix is not marked as historical");
}

const capabilityDoc = text("docs/capabilities/customer-service-capability.md");
for (const required of [
  "T06.1",
  "gateway: registered",
  "customer-service-http-contract",
  "runtime: connected",
]) {
  if (!capabilityDoc.includes(required)) {
    errors.push(`customer service capability doc missing required content: ${required}`);
  }
}

const integrationDoc = text("docs/integrations/customer-service-http-contract.md");
for (const required of [
  "Idempotency-Key",
  "POST /v1/customers/resolve",
  "POST /v1/customers",
  "POST /v1/customers/{customerId}/external-identities",
  "CUSTOMER_SERVICE_BASE_URL",
]) {
  if (!integrationDoc.includes(required)) {
    errors.push(`customer service HTTP contract missing required content: ${required}`);
  }
}

const executionMap = text("docs/product/MVP_EXECUTION_MAP.md");
for (const required of [
  "Customer & Identity",
  "Commercial Runtime",
  "Operator CRM",
  "Quotes & Transactions",
  "Analytics",
  "Marketing",
  "Voice",
  "Platform & Integrations",
  "integration gates",
]) {
  if (!executionMap.toLowerCase().includes(required.toLowerCase())) {
    errors.push(`MVP execution map missing required content: ${required}`);
  }
}

const requiredCapabilities = [
  "identity resolution",
  "customer onboarding",
  "customer master",
  "address book",
  "contact preferences",
  "conversation linkage",
  "opportunity management",
  "commercial planning",
  "commercial actions",
  "follow-up",
  "handoff",
  "operator conversation workspace",
  "operator customer context",
  "operator opportunity view",
  "catalog search",
  "quote creation",
  "quote persistence",
  "checkout support",
  "order visibility",
  "analytics events",
  "commercial metrics",
  "agent performance metrics",
  "campaign model",
  "audience segmentation",
  "contact policy",
  "campaign execution",
  "voice call request",
  "voice outcomes",
  "transcription linkage",
];
for (const capability of requiredCapabilities) {
  if (!executionMap.toLowerCase().includes(capability)) {
    errors.push(`MVP execution map missing capability row: ${capability}`);
  }
}
if (!executionMap.includes("outside current MVP / future_release_not_scheduled")) {
  errors.push("MVP execution map does not mark Marketing as explicitly deferred");
}

const sourceTruthRoadmapCount = files.filter((rel) => sourceItems(rel).includes("roadmap")).length;
if (sourceTruthRoadmapCount !== 1) {
  errors.push(`expected one roadmap authority, found ${sourceTruthRoadmapCount}`);
}

for (const rel of [
  "docs/architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md",
  "docs/architecture/adr/ADR-008-customer-360-boundary.md",
  "docs/data/customer-onboarding-identity-contract.md",
  "docs/data/customer-creation-linking-authority-contract.md",
  "docs/data/customer-360-contract.md",
  "docs/data/customer-lifecycle-event-contract.md",
  "docs/capabilities/customer-service-capability.md",
  "docs/integrations/customer-service-http-contract.md",
  "docs/releases/ACS-R1-03-customer-360.md",
  "docs/releases/ACS-R1-04-customer-identity-onboarding.md",
  "docs/audits/acs-r1-01-capability-gateway-evidence.md",
]) {
  if (!has(rel)) {
    errors.push(`missing required referenced file: ${rel}`);
  }
}

if (errors.length > 0) {
  fail(errors);
}

console.log(`docs:validate ok (${files.length} markdown files checked)`);
