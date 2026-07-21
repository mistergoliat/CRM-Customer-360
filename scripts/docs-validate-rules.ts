/**
 * Pure, side-effect-free rules used by scripts/docs-validate.ts. Extracted
 * so they can be unit tested without walking the filesystem or exiting the
 * process - see tests/docs/docsValidateRules.test.ts.
 */

export type Frontmatter = Record<string, string[]>;

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function hasUtf8Bom(buf: Buffer): boolean {
  return buf.length >= 3 && buf.subarray(0, 3).equals(UTF8_BOM);
}

export function stripUtf8Bom(buf: Buffer): Buffer {
  return hasUtf8Bom(buf) ? buf.subarray(3) : buf;
}

/**
 * True when the text contains a frontmatter-looking block (has a `doc_id:`
 * key, which only ever appears in frontmatter, never in body prose) but the
 * block does not start at byte 0 - e.g. a heading was left before it. This
 * is the exact bug class that shipped once: a duplicate H1 pushed the real
 * `---` block past offset 0, so parseFrontmatter() silently returned null.
 */
export function looksLikeMisplacedFrontmatter(text: string, parsedFrontmatter: Frontmatter | null): boolean {
  return parsedFrontmatter === null && text.includes("doc_id:");
}

// Document governance states (docs/00-START-HERE.md "Estados documentales").
// Anything else is a legacy value (ADR `approved`, release-lifecycle values
// like `accepted`/`parallel_in_progress`, etc.) - warn, never fail. This
// validator does not migrate legacy status values; docs/documentation-
// consolidation does that.
export const KNOWN_DOC_STATES = new Set([
  "canonical",
  "active",
  "supporting",
  "release-specific",
  "historical",
  "superseded",
  "deprecated",
  "dev-only",
]);

export interface StatusCheckResult {
  errors: string[];
  warnings: string[];
}

/**
 * Checks one document's status/metadata against the vocabulary rules.
 * `resolves` answers whether a superseded_by target exists, so tests can
 * fake it without touching the filesystem.
 */
export function checkDocumentStatus(
  rel: string,
  fm: Frontmatter,
  resolves: (target: string) => boolean,
): StatusCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const status = (fm["status"] ?? [])[0];
  if (!status) return { errors, warnings };

  if (!KNOWN_DOC_STATES.has(status)) {
    warnings.push(`${rel} uses legacy status '${status}' (not yet in the canonical vocabulary - see docs/00-START-HERE.md)`);
    return { errors, warnings };
  }

  // historical / dev-only: no replacement required, nothing else to check.

  if (status === "superseded" || status === "deprecated") {
    const supersededBy = (fm["superseded_by"] ?? [])[0];
    const deprecationReason = (fm["deprecation_reason"] ?? [])[0];
    if (status === "superseded" && !supersededBy) {
      errors.push(`${rel} is status: superseded but declares no superseded_by`);
    } else if (status === "deprecated" && !supersededBy && !deprecationReason) {
      errors.push(`${rel} is status: deprecated but declares neither superseded_by nor deprecation_reason`);
    }
    if (supersededBy && !resolves(supersededBy)) {
      errors.push(`${rel} declares superseded_by: ${supersededBy}, which does not exist`);
    }
  }

  if (status === "canonical") {
    const title = (fm["title"] ?? [])[0];
    const docId = (fm["doc_id"] ?? [])[0];
    const owner = (fm["owner"] ?? [])[0];
    const hasSourceOfTruth = (fm["source_of_truth_for"] ?? []).length > 0;
    if (!title || !docId || !owner || !hasSourceOfTruth) {
      errors.push(`${rel} is status: canonical but is missing required metadata (title/doc_id/owner/source_of_truth_for)`);
    }
  }

  return { errors, warnings };
}
