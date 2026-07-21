import assert from "node:assert/strict";
import test from "node:test";
import {
  checkDocumentStatus,
  hasUtf8Bom,
  looksLikeMisplacedFrontmatter,
  stripUtf8Bom,
  type Frontmatter,
} from "../../scripts/docs-validate-rules";

const noResolve = () => false;
const yesResolve = () => true;

test("hasUtf8Bom detects a leading BOM", () => {
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("---\ntitle: x\n---\n")]);
  const withoutBom = Buffer.from("---\ntitle: x\n---\n");
  assert.equal(hasUtf8Bom(withBom), true);
  assert.equal(hasUtf8Bom(withoutBom), false);
  assert.equal(stripUtf8Bom(withBom).toString("utf8"), "---\ntitle: x\n---\n");
});

test("looksLikeMisplacedFrontmatter flags a doc_id block that isn't at byte 0", () => {
  const misplaced = "# Title\n\n---\ndoc_id: x\nstatus: historical\n---\n\nbody";
  assert.equal(looksLikeMisplacedFrontmatter(misplaced, null), true);
});

test("looksLikeMisplacedFrontmatter ignores files with no frontmatter at all", () => {
  const plainProse = "# Title\n\nJust a normal doc, no doc_id anywhere.";
  assert.equal(looksLikeMisplacedFrontmatter(plainProse, null), false);
});

test("looksLikeMisplacedFrontmatter ignores files whose frontmatter parsed fine", () => {
  const parsed: Frontmatter = { doc_id: ["x"] };
  assert.equal(looksLikeMisplacedFrontmatter("---\ndoc_id: x\n---\n", parsed), false);
});

test("superseded without superseded_by is an error", () => {
  const fm: Frontmatter = { status: ["superseded"] };
  const result = checkDocumentStatus("docs/x.md", fm, noResolve);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /declares no superseded_by/);
});

test("superseded_by pointing at a nonexistent path is an error", () => {
  const fm: Frontmatter = { status: ["superseded"], superseded_by: ["docs/nope.md"] };
  const result = checkDocumentStatus("docs/x.md", fm, noResolve);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /which does not exist/);
});

test("superseded with a resolvable superseded_by is clean", () => {
  const fm: Frontmatter = { status: ["superseded"], superseded_by: ["docs/real.md"] };
  const result = checkDocumentStatus("docs/x.md", fm, yesResolve);
  assert.deepEqual(result, { errors: [], warnings: [] });
});

test("deprecated requires superseded_by or deprecation_reason", () => {
  const fm: Frontmatter = { status: ["deprecated"] };
  const result = checkDocumentStatus("docs/x.md", fm, noResolve);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /neither superseded_by nor deprecation_reason/);

  const withReason: Frontmatter = { status: ["deprecated"], deprecation_reason: ["being folded into y"] };
  assert.deepEqual(checkDocumentStatus("docs/x.md", withReason, noResolve), { errors: [], warnings: [] });
});

test("historical requires no replacement", () => {
  const fm: Frontmatter = { status: ["historical"] };
  assert.deepEqual(checkDocumentStatus("docs/x.md", fm, noResolve), { errors: [], warnings: [] });
});

test("dev-only requires no replacement", () => {
  const fm: Frontmatter = { status: ["dev-only"] };
  assert.deepEqual(checkDocumentStatus("docs/x.md", fm, noResolve), { errors: [], warnings: [] });
});

test("canonical without required metadata is an error", () => {
  const fm: Frontmatter = { status: ["canonical"] };
  const result = checkDocumentStatus("docs/x.md", fm, noResolve);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /missing required metadata/);
});

test("canonical with title/doc_id/owner/source_of_truth_for is clean", () => {
  const fm: Frontmatter = {
    status: ["canonical"],
    title: ["X"],
    doc_id: ["x"],
    owner: ["product"],
    source_of_truth_for: ["vision"],
  };
  assert.deepEqual(checkDocumentStatus("docs/x.md", fm, noResolve), { errors: [], warnings: [] });
});

test("a legacy status value is a warning, not an error", () => {
  const fm: Frontmatter = { status: ["approved"] };
  const result = checkDocumentStatus("docs/x.md", fm, noResolve);
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /legacy status 'approved'/);
});

test("no status field at all is silently skipped", () => {
  const fm: Frontmatter = { title: ["X"] };
  assert.deepEqual(checkDocumentStatus("docs/x.md", fm, noResolve), { errors: [], warnings: [] });
});
