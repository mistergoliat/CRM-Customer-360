/**
 * docs:validate - DOCUMENT STRUCTURAL VALIDATION ONLY.
 *
 * This script inspects markdown files under docs/ (plus AGENTS.md/CLAUDE.md)
 * for structural governance invariants: frontmatter shape, single-authority
 * documents, relative link resolution, table completeness and
 * historical/superseded bookkeeping.
 *
 * It does NOT run code, does NOT execute tests, and does NOT verify that any
 * described behavior actually exists at runtime. A document can pass this
 * script and still describe an unimplemented feature. Runtime correctness is
 * verified by `npm run build`, `npm run typecheck` and the test suite, not
 * by this script.
 */

import fs from "node:fs";
import path from "node:path";
import {
  checkDocumentStatus,
  hasUtf8Bom,
  looksLikeMisplacedFrontmatter,
  stripUtf8Bom,
  type Frontmatter,
} from "./docs-validate-rules";

const root = process.cwd();
const docsRoot = path.join(root, "docs");

function readText(relPath: string): { text: string; hadBom: boolean } {
  const buf = fs.readFileSync(path.join(root, relPath));
  const hadBom = hasUtf8Bom(buf);
  const text = stripUtf8Bom(buf).toString("utf8").replace(/\r\n/g, "\n");
  return { text, hadBom };
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
      data[currentKey] = keyMatch[2] ? [keyMatch[2].replace(/^"(.*)"$/, "$1")] : [];
      continue;
    }
    const itemMatch = line.match(/^\s*-\s+(.*)$/);
    if (itemMatch && currentKey) {
      data[currentKey].push(itemMatch[1].replace(/^"(.*)"$/, "$1"));
    }
  }
  return data;
}

/** Strips fenced code blocks so link/table scans never match code content. */
function stripCodeFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, " "));
}

/** Parses the first markdown table found after a heading matcher. */
function parseTableAfterHeading(
  text: string,
  headingPattern: RegExp,
): { headers: string[]; rows: string[][] } | null {
  const headingMatch = headingPattern.exec(text);
  if (!headingMatch) return null;
  const after = text.slice(headingMatch.index + headingMatch[0].length);
  const lines = after.split(/\r?\n/);
  const tableLines: string[] = [];
  let started = false;
  for (const line of lines) {
    if (line.trim().startsWith("|")) {
      started = true;
      tableLines.push(line.trim());
    } else if (started) {
      break;
    }
  }
  if (tableLines.length < 2) return null;
  const splitRow = (line: string) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  const headers = splitRow(tableLines[0]);
  const rows = tableLines.slice(2).map(splitRow);
  return { headers, rows };
}

function cellIndex(headers: string[], name: string): number {
  return headers.findIndex((h) => h.toLowerCase().includes(name.toLowerCase()));
}

function fail(messages: string[]): never {
  for (const message of messages) {
    console.error(`docs:validate: ${message}`);
  }
  console.error(
    `docs:validate: ${messages.length} structural issue(s) found. This is document structural validation only - it does not verify runtime behavior.`,
  );
  process.exit(1);
}

const files = walk(docsRoot);
const fileText = new Map<string, string>();
const frontmatter = new Map<string, Frontmatter | null>();
const bomFiles: string[] = [];
const misplacedFrontmatterFiles: string[] = [];
for (const rel of files) {
  const { text: fileContent, hadBom } = readText(rel);
  if (hadBom) bomFiles.push(rel);
  fileText.set(rel, fileContent);
  const parsed = parseFrontmatter(fileContent);
  frontmatter.set(rel, parsed);
  if (looksLikeMisplacedFrontmatter(fileContent, parsed)) misplacedFrontmatterFiles.push(rel);
}
for (const rel of ["AGENTS.md", "CLAUDE.md"]) {
  if (fs.existsSync(path.join(root, rel))) {
    const { text: fileContent, hadBom } = readText(rel);
    if (hadBom) bomFiles.push(rel);
    fileText.set(rel, fileContent);
  }
}

const errors: string[] = [];
const warnings: string[] = [];

for (const rel of bomFiles) {
  errors.push(`${rel} starts with a UTF-8 BOM, which breaks frontmatter parsing (text.startsWith("---\\n") fails) - remove it`);
}
for (const rel of misplacedFrontmatterFiles) {
  errors.push(
    `${rel} has a 'doc_id:' frontmatter key but the frontmatter block does not start at byte 0 - check for a heading or other content before the opening ---`,
  );
}

function text(rel: string): string {
  const value = fileText.get(rel);
  if (value === undefined) {
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

function statusOf(rel: string): string {
  return (fm(rel)["status"] ?? [])[0] ?? "";
}

// ---------------------------------------------------------------------------
// 1-2. Exactly one active roadmap authority, and it is docs/ROADMAP.md.
// ---------------------------------------------------------------------------
const roadmapDocs = files.filter((rel) => sourceItems(rel).includes("roadmap"));
if (roadmapDocs.length !== 1 || roadmapDocs[0] !== "docs/ROADMAP.md") {
  errors.push(
    `expected exactly one roadmap authority at docs/ROADMAP.md, found: ${roadmapDocs.join(", ") || "none"}`,
  );
}

// ---------------------------------------------------------------------------
// 3. No P1/P2/P3 document is active as a roadmap.
// ---------------------------------------------------------------------------
const legacyRoadmapDocs = [
  "docs/product/mvp-roadmap.md",
  "docs/product/autonomous-commerce-roadmap.md",
  "docs/product/agent-capability-matrix.md",
];
for (const rel of legacyRoadmapDocs) {
  if (!has(rel)) continue;
  const status = statusOf(rel);
  if (status !== "historical" && status !== "superseded") {
    errors.push(`${rel} is a legacy P1/P2/P3 document but is not marked status: historical|superseded`);
  }
  if (sourceItems(rel).some((item) => item.toLowerCase() === "roadmap")) {
    errors.push(`${rel} still declares itself as an active roadmap authority`);
  }
}

// ---------------------------------------------------------------------------
// 14. Legacy P1/P2/P3 documents that were superseded by the ACS governance
// model must declare a valid superseded_by. This does NOT apply to
// docs/audits/* or other pre-existing immutable historical evidence, which
// is deliberately never superseded (AGENTS.md: "no modificar auditorias
// historicas") - only to documents this consolidation replaced.
// ---------------------------------------------------------------------------
for (const rel of legacyRoadmapDocs) {
  if (!has(rel)) continue;
  const status = statusOf(rel);
  if (status !== "historical" && status !== "superseded") continue;
  const supersededBy = (fm(rel)["superseded_by"] ?? [])[0];
  if (!supersededBy) {
    errors.push(`${rel} is status: ${status} but declares no superseded_by`);
    continue;
  }
  const resolved =
    supersededBy.startsWith("docs/") || supersededBy.startsWith("AGENTS.md")
      ? path.join(root, supersededBy)
      : path.resolve(path.dirname(path.join(root, rel)), supersededBy);
  if (!fs.existsSync(resolved)) {
    errors.push(`${rel} declares superseded_by: ${supersededBy}, which does not exist`);
  }
}

// ---------------------------------------------------------------------------
// 4-5. ACTIVE_RELEASE references an existing release, and its current_task
// exists in that release's task table.
// ---------------------------------------------------------------------------
const activeReleaseFm = fm("docs/ACTIVE_RELEASE.md");
const activeReleaseId = (activeReleaseFm["release"] ?? [])[0];
const currentTaskId = (activeReleaseFm["current_task"] ?? [])[0];
const releaseIndexTable = parseTableAfterHeading(
  stripCodeFences(text("docs/releases/README.md")),
  /^# Releases/m,
);
if (!activeReleaseId) {
  errors.push("docs/ACTIVE_RELEASE.md frontmatter is missing 'release'");
} else if (releaseIndexTable) {
  const releaseCol = cellIndex(releaseIndexTable.headers, "release");
  const known = releaseIndexTable.rows.map((r) => r[releaseCol]?.replace(/`/g, ""));
  if (!known.includes(activeReleaseId)) {
    errors.push(`docs/ACTIVE_RELEASE.md references release ${activeReleaseId}, not found in docs/releases/README.md`);
  }
}

const releaseSpecPath = "docs/releases/ACS-R1-04-customer-identity-onboarding.md";
if (!currentTaskId) {
  errors.push("docs/ACTIVE_RELEASE.md frontmatter is missing 'current_task'");
} else if (has(releaseSpecPath)) {
  const taskTable = parseTableAfterHeading(stripCodeFences(text(releaseSpecPath)), /^## Tareas/m);
  if (!taskTable) {
    errors.push(`${releaseSpecPath} has no parseable task table under '## Tareas'`);
  } else {
    const idCol = cellIndex(taskTable.headers, "id");
    const knownTasks = taskTable.rows.map((r) => r[idCol]?.replace(/`/g, ""));
    if (!knownTasks.includes(currentTaskId)) {
      errors.push(`current_task ${currentTaskId} not found in ${releaseSpecPath} task table`);
    }
  }
  const specCurrentTask = (fm(releaseSpecPath)["current_task"] ?? [])[0];
  if (specCurrentTask && specCurrentTask !== currentTaskId) {
    errors.push(
      `current_task mismatch: ACTIVE_RELEASE.md says ${currentTaskId}, ${releaseSpecPath} says ${specCurrentTask}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 6. CLAUDE.md delegates authority to AGENTS.md.
// ---------------------------------------------------------------------------
if (!text("CLAUDE.md").includes("AGENTS.md") || !text("CLAUDE.md").toLowerCase().includes("autoridad canonica")) {
  errors.push("CLAUDE.md does not declare AGENTS.md as canonical authority");
}

// ---------------------------------------------------------------------------
// 7. MVP_EXECUTION_MAP.md exists.
// ---------------------------------------------------------------------------
if (!has("docs/product/MVP_EXECUTION_MAP.md")) {
  errors.push("docs/product/MVP_EXECUTION_MAP.md is missing");
}

// ---------------------------------------------------------------------------
// 8/12/13. Every relative markdown link in every doc (plus AGENTS.md/CLAUDE.md)
// resolves to a real file. This is what catches wrong ../ vs ./ links, and
// covers ADR/contract references generically instead of a hardcoded list.
// ---------------------------------------------------------------------------
const linkPattern = /\[[^\]]*\]\(([^)\s]+)\)/g;
for (const [rel, raw] of fileText.entries()) {
  const clean = stripCodeFences(raw);
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(clean)) !== null) {
    const target = match[1];
    if (/^([a-z]+:)?\/\//i.test(target) || target.startsWith("mailto:") || target.startsWith("#")) {
      continue;
    }
    const withoutAnchor = target.split("#")[0];
    if (!withoutAnchor) continue;
    const resolved = path.resolve(path.dirname(path.join(root, rel)), withoutAnchor);
    if (!fs.existsSync(resolved)) {
      errors.push(`${rel} has a broken relative link: ${target}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 9. Every workstream in MVP_EXECUTION_MAP has responsibility and limits.
// ---------------------------------------------------------------------------
const requiredWorkstreams = [
  "Customer & Identity",
  "Commercial Runtime",
  "Operator CRM",
  "Quotes & Transactions",
  "Analytics",
  "Marketing",
  "Voice",
  "Platform & Integrations",
];
const executionMapRaw = text("docs/product/MVP_EXECUTION_MAP.md");
const executionMapClean = stripCodeFences(executionMapRaw);
const workstreamTable = parseTableAfterHeading(executionMapClean, /^## 6\.1 Workstreams/m);
if (!workstreamTable) {
  errors.push("MVP_EXECUTION_MAP.md has no parseable workstream table under '## 6.1 Workstreams'");
} else {
  const nameCol = 0;
  const respCol = cellIndex(workstreamTable.headers, "Responsabilidad");
  const limitCol = cellIndex(workstreamTable.headers, "Limites");
  const releaseCol = cellIndex(workstreamTable.headers, "Release");
  const byName = new Map(workstreamTable.rows.map((r) => [r[nameCol], r]));
  for (const name of requiredWorkstreams) {
    const row = byName.get(name);
    if (!row) {
      errors.push(`MVP_EXECUTION_MAP.md workstream table is missing required workstream: ${name}`);
      continue;
    }
    if (respCol === -1 || !row[respCol]) {
      errors.push(`MVP_EXECUTION_MAP.md workstream '${name}' has no Responsabilidad`);
    }
    if (limitCol === -1 || !row[limitCol]) {
      errors.push(`MVP_EXECUTION_MAP.md workstream '${name}' has no Limites`);
    }
  }
  // 15. Marketing must be explicitly deferred, never an active parallel line.
  const marketingRow = byName.get("Marketing");
  if (marketingRow && releaseCol !== -1) {
    const releaseValue = marketingRow[releaseCol]?.toLowerCase() ?? "";
    if (
      !releaseValue.includes("outside current mvp") &&
      !releaseValue.includes("deferred") &&
      !releaseValue.includes("future_release_not_scheduled")
    ) {
      errors.push("MVP_EXECUTION_MAP.md Marketing workstream is not explicitly deferred/outside_current_mvp");
    }
  }
}

// ---------------------------------------------------------------------------
// 11. Every capability in the Capability Map has an owner, a state, and a
// release id or an explicit deferred/future condition.
// ---------------------------------------------------------------------------
const capabilityMapTable = parseTableAfterHeading(executionMapClean, /^## 6\.2 Capability Map/m);
if (!capabilityMapTable) {
  errors.push("MVP_EXECUTION_MAP.md has no parseable capability map under '## 6.2 Capability Map'");
} else {
  const ownerCol = cellIndex(capabilityMapTable.headers, "Workstream propietario");
  const stateCol = cellIndex(capabilityMapTable.headers, "Estado actual");
  const releaseCol = cellIndex(capabilityMapTable.headers, "Release ACS");
  const deferredMarkers = ["future", "deferred", "outside current mvp", "not_scheduled"];
  for (const row of capabilityMapTable.rows) {
    const capability = row[0];
    if (!capability) continue;
    if (ownerCol === -1 || !row[ownerCol]) {
      errors.push(`MVP_EXECUTION_MAP.md capability '${capability}' has no owning workstream`);
    }
    if (stateCol === -1 || !row[stateCol]) {
      errors.push(`MVP_EXECUTION_MAP.md capability '${capability}' has no estado`);
    }
    const releaseValue = releaseCol !== -1 ? (row[releaseCol] ?? "").toLowerCase() : "";
    const hasRelease = /acs-r/i.test(releaseValue);
    const hasDeferredCondition = deferredMarkers.some((marker) => releaseValue.includes(marker));
    if (!hasRelease && !hasDeferredCondition) {
      errors.push(
        `MVP_EXECUTION_MAP.md capability '${capability}' has no release ACS and no explicit deferred condition`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 10. Every canonical resource in the Ownership Matrix has exactly one
// writer, and no resource name repeats with a different owner.
// ---------------------------------------------------------------------------
const ownershipTable = parseTableAfterHeading(executionMapClean, /^## 6\.3 Ownership Matrix/m);
if (!ownershipTable) {
  errors.push("MVP_EXECUTION_MAP.md has no parseable ownership matrix under '## 6.3 Ownership Matrix'");
} else {
  const resourceCol = 0;
  const ownerCol = cellIndex(ownershipTable.headers, "Owner");
  const writerCol = cellIndex(ownershipTable.headers, "Quien puede escribir");
  const seenOwners = new Map<string, string>();
  for (const row of ownershipTable.rows) {
    const resource = row[resourceCol];
    if (!resource) continue;
    if (writerCol === -1 || !row[writerCol]) {
      errors.push(`MVP_EXECUTION_MAP.md resource '${resource}' has no declared writer`);
    }
    const owner = ownerCol !== -1 ? row[ownerCol] : "";
    if (seenOwners.has(resource) && seenOwners.get(resource) !== owner) {
      errors.push(`MVP_EXECUTION_MAP.md resource '${resource}' has conflicting owners across rows`);
    }
    seenOwners.set(resource, owner ?? "");
  }
}

// ---------------------------------------------------------------------------
// 16. Every release id mentioned in ROADMAP.md exists as a row in
// docs/releases/README.md.
// ---------------------------------------------------------------------------
const roadmapTable = parseTableAfterHeading(stripCodeFences(text("docs/ROADMAP.md")), /^## Releases/m);
if (roadmapTable && releaseIndexTable) {
  const roadmapReleaseCol = 0;
  const indexReleaseCol = cellIndex(releaseIndexTable.headers, "release");
  const knownIndexIds = new Set(releaseIndexTable.rows.map((r) => r[indexReleaseCol]?.replace(/`/g, "")));
  for (const row of roadmapTable.rows) {
    const id = row[roadmapReleaseCol]?.replace(/`/g, "");
    if (id && !knownIndexIds.has(id)) {
      errors.push(`docs/ROADMAP.md references release ${id}, not found in docs/releases/README.md`);
    }
  }
}

// ---------------------------------------------------------------------------
// 17. Generic document status vocabulary (docs/00-START-HERE.md "Estados
// documentales"): superseded/deprecated need a resolvable pointer, canonical
// needs minimal metadata, any other status value is a legacy-vocabulary
// warning (not an error) until docs/documentation-consolidation migrates it.
// Applies to every file with frontmatter, not a hardcoded list - see
// scripts/docs-validate-rules.ts for the pure rule and its tests.
// ---------------------------------------------------------------------------
function resolveDocPath(fromRel: string, target: string): string {
  return target.startsWith("docs/") || target.startsWith("AGENTS.md") || target.startsWith("CLAUDE.md")
    ? path.join(root, target)
    : path.resolve(path.dirname(path.join(root, fromRel)), target);
}
for (const rel of files) {
  const fmData = frontmatter.get(rel);
  if (!fmData) continue;
  const result = checkDocumentStatus(rel, fmData, (target) => fs.existsSync(resolveDocPath(rel, target)));
  errors.push(...result.errors);
  warnings.push(...result.warnings);
}

if (errors.length > 0) {
  fail(errors);
}

if (warnings.length > 0) {
  console.warn(`docs:validate: ${warnings.length} legacy status warning(s) (informational, not migrated by this task):`);
  for (const warning of warnings) {
    console.warn(`docs:validate:   ${warning}`);
  }
}

console.log(
  `docs:validate ok (${files.length} markdown files checked, ${warnings.length} legacy status warning(s), document structural validation only - no runtime verification performed)`,
);
