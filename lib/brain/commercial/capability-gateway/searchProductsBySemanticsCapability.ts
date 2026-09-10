/**
 * SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B4. READ_TOOL integration of Catalog's
 * existing search_products_by_semantics capability (real contract: POST
 * /v1/products/semantic-discovery/query, GET /v1/products/semantics/registry,
 * GET /v1/products/training-semantics/registry - confirmed against
 * mistergoliat/MS-pesaschile-catalog-service). DeepSeek remains responsible
 * for interpreting the customer's request and constructing canonical
 * requirements; this file only validates the CRM-side boundary, transports
 * the query and projects the result. No planner, no ToolRequest abstraction,
 * no automatic tool chaining lives here.
 */
import type {
  CatalogPort,
  CatalogProductSemanticsRegistry,
  CatalogSemanticDiscoveryAxis,
  CatalogSemanticDiscoveryExpectedSnapshots,
  CatalogSemanticDiscoveryRequirement,
  CatalogTrainingSemanticsRegistry
} from "@/lib/catalog";
import { CATALOG_SEMANTIC_DISCOVERY_AXES, CATALOG_SEMANTIC_DISCOVERY_MATCHES, CATALOG_SEMANTIC_DISCOVERY_MODES, CATALOG_SEMANTIC_DISCOVERY_SCHEMA_VERSION } from "@/lib/catalog";
import type { CapabilityExecutionOutcome, CapabilityGatewayContext, CapabilityGatewayDefinition } from "./types";

const CAPABILITY_GATEWAY_VERSION = "capability-gateway.v1" as const;
const MAX_REQUIREMENTS = 10;
const MAX_CODES_PER_REQUIREMENT = 24;

export const SEARCH_PRODUCTS_BY_SEMANTICS_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["requirements"],
  properties: {
    requirements: {
      type: "array",
      minItems: 1,
      maxItems: MAX_REQUIREMENTS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["axis", "codes", "mode", "match"],
        properties: {
          axis: { type: "string", enum: [...CATALOG_SEMANTIC_DISCOVERY_AXES] },
          codes: { type: "array", minItems: 1, maxItems: MAX_CODES_PER_REQUIREMENT, items: { type: "string", minLength: 1 } },
          mode: { type: "string", enum: [...CATALOG_SEMANTIC_DISCOVERY_MODES] },
          match: { type: "string", enum: [...CATALOG_SEMANTIC_DISCOVERY_MATCHES] }
        }
      }
    },
    limit: { type: "integer", minimum: 1, maximum: 100 },
    schemaVersion: { type: "integer", enum: [CATALOG_SEMANTIC_DISCOVERY_SCHEMA_VERSION] },
    expectedSnapshots: {
      type: "object",
      additionalProperties: false,
      properties: {
        productSemanticSnapshotId: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
        trainingSemanticSnapshotId: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }
      }
    }
  }
} as const;

const USE_WHEN =
  "Use when the customer expresses a functional, training, exercise, body-region, discipline, use-context, or similar semantic requirement without sufficiently identifying a concrete catalog product.";
const DO_NOT_USE_WHEN =
  "Do not use only to retrieve current price, stock, variants, or link for an already identified product - use get_product_details for that. Do not replace nominal product resolution (search_products) when the customer already names a concrete product.";

type RawRequirement = { axis?: unknown; codes?: unknown; mode?: unknown; match?: unknown };

type StructuralValidationResult = {
  ok: true;
  requirements: CatalogSemanticDiscoveryRequirement[];
  limit?: number;
  schemaVersion?: typeof CATALOG_SEMANTIC_DISCOVERY_SCHEMA_VERSION;
  expectedSnapshots?: CatalogSemanticDiscoveryExpectedSnapshots;
} | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const AXIS_SET: ReadonlySet<string> = new Set(CATALOG_SEMANTIC_DISCOVERY_AXES);
const REQUEST_KEYS = ["requirements", "limit", "schemaVersion", "expectedSnapshots"] as const;
const REQUIREMENT_KEYS = ["axis", "codes", "mode", "match"] as const;
const EXPECTED_SNAPSHOT_KEYS = ["productSemanticSnapshotId", "trainingSemanticSnapshotId"] as const;

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isSnapshotId(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

/**
 * CRM-side DTO/validation boundary (task section 2/8): structural shape
 * only, never canonical-code validity - that is checked separately against
 * the cached registry (validateCodesAgainstRegistry below), never here.
 */
function validateStructure(input: unknown): StructuralValidationResult {
  if (!isRecord(input)) return { ok: false };
  if (!hasOnlyKeys(input, REQUEST_KEYS)) return { ok: false };
  if (!Array.isArray(input.requirements) || input.requirements.length === 0 || input.requirements.length > MAX_REQUIREMENTS) return { ok: false };

  const requirements: CatalogSemanticDiscoveryRequirement[] = [];
  for (const rawEntry of input.requirements) {
    if (!isRecord(rawEntry)) return { ok: false };
    if (!hasOnlyKeys(rawEntry, REQUIREMENT_KEYS)) return { ok: false };
    const raw = rawEntry as RawRequirement;
    if (typeof raw.axis !== "string" || !AXIS_SET.has(raw.axis)) return { ok: false };
    if (!Array.isArray(raw.codes) || raw.codes.length === 0 || raw.codes.length > MAX_CODES_PER_REQUIREMENT) return { ok: false };
    const codes: string[] = [];
    for (const code of raw.codes) {
      if (typeof code !== "string" || code.trim().length === 0) return { ok: false };
      codes.push(code);
    }
    if (new Set(codes).size !== codes.length) return { ok: false };
    if (raw.mode !== "required" && raw.mode !== "preferred") return { ok: false };
    if (raw.match !== "any" && raw.match !== "all") return { ok: false };
    requirements.push({ axis: raw.axis as CatalogSemanticDiscoveryAxis, codes, mode: raw.mode, match: raw.match });
  }

  let limit: number | undefined;
  if (input.limit !== undefined) {
    if (typeof input.limit !== "number" || !Number.isFinite(input.limit) || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) return { ok: false };
    limit = input.limit;
  }

  let schemaVersion: typeof CATALOG_SEMANTIC_DISCOVERY_SCHEMA_VERSION | undefined;
  if (input.schemaVersion !== undefined) {
    if (input.schemaVersion !== CATALOG_SEMANTIC_DISCOVERY_SCHEMA_VERSION) return { ok: false };
    schemaVersion = CATALOG_SEMANTIC_DISCOVERY_SCHEMA_VERSION;
  }

  let expectedSnapshots: CatalogSemanticDiscoveryExpectedSnapshots | undefined;
  if (input.expectedSnapshots !== undefined) {
    if (!isRecord(input.expectedSnapshots) || !hasOnlyKeys(input.expectedSnapshots, EXPECTED_SNAPSHOT_KEYS)) return { ok: false };
    const productSemanticSnapshotId = input.expectedSnapshots.productSemanticSnapshotId;
    const trainingSemanticSnapshotId = input.expectedSnapshots.trainingSemanticSnapshotId;
    if (productSemanticSnapshotId !== undefined && !isSnapshotId(productSemanticSnapshotId)) return { ok: false };
    if (trainingSemanticSnapshotId !== undefined && !isSnapshotId(trainingSemanticSnapshotId)) return { ok: false };
    expectedSnapshots = {
      ...(productSemanticSnapshotId !== undefined ? { productSemanticSnapshotId } : {}),
      ...(trainingSemanticSnapshotId !== undefined ? { trainingSemanticSnapshotId } : {})
    };
  }

  return { ok: true, requirements, limit, ...(schemaVersion !== undefined ? { schemaVersion } : {}), ...(expectedSnapshots !== undefined ? { expectedSnapshots } : {}) };
}

type RegistryIndex = ReadonlyMap<CatalogSemanticDiscoveryAxis, ReadonlySet<string>>;
/**
 * SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B4.1. Retains the raw registries
 * (never just the derived code-set index) so this ONE per-process cache
 * serves both canonical-code validation (validateCodesAgainstRegistry, via
 * `index`) and the planner-facing vocabulary projection (getSemanticVocabularyForPrompt,
 * via `product`/`training`) - a single fetch, never a second independent one.
 */
type CachedRegistry = { index: RegistryIndex; product: CatalogProductSemanticsRegistry; training: CatalogTrainingSemanticsRegistry };

let cachedRegistry: CachedRegistry | null = null;

/** Test-only: force the next execute()/getSemanticVocabularyForPrompt call to re-fetch the registry. */
export function resetSearchProductsBySemanticsRegistryForTests() {
  cachedRegistry = null;
}

function buildRegistryIndex(product: CatalogProductSemanticsRegistry, training: CatalogTrainingSemanticsRegistry): RegistryIndex {
  const index = new Map<CatalogSemanticDiscoveryAxis, Set<string>>();
  for (const axisEntry of product.axes) {
    index.set(axisEntry.axis, new Set(axisEntry.values.map((value) => value.code)));
  }
  index.set("EXERCISE_CAPABILITY", new Set(training.exerciseCapabilities.map((definition) => definition.code)));
  index.set("TRAINING_FUNCTION", new Set(training.trainingFunctions.map((definition) => definition.code)));
  index.set("BODY_REGION", new Set(training.bodyRegions));
  index.set("MUSCLE_GROUP", new Set(training.muscleGroups));
  index.set("TRAINING_PATTERN", new Set(training.trainingPatterns));
  return index;
}

async function loadRegistry(port: CatalogPort, context: { correlationId: string }): Promise<{ ok: true; registry: CachedRegistry } | { ok: false }> {
  const getProductRegistry = port.getProductSemanticsRegistry;
  const getTrainingRegistry = port.getTrainingSemanticsRegistry;
  if (!getProductRegistry || !getTrainingRegistry) return { ok: false };

  const [productResult, trainingResult] = await Promise.all([
    getProductRegistry({ correlationId: context.correlationId }),
    getTrainingRegistry({ correlationId: context.correlationId })
  ]);
  if (!productResult.ok || !trainingResult.ok) return { ok: false };

  const index = buildRegistryIndex(productResult.value, trainingResult.value);
  if (!CATALOG_SEMANTIC_DISCOVERY_AXES.every((axis) => index.has(axis))) return { ok: false };
  return { ok: true, registry: { index, product: productResult.value, training: trainingResult.value } };
}

async function ensureRegistry(port: CatalogPort, context: { correlationId: string }): Promise<{ ok: true; registry: CachedRegistry } | { ok: false }> {
  if (cachedRegistry) return { ok: true, registry: cachedRegistry };
  const loaded = await loadRegistry(port, context);
  if (!loaded.ok) return loaded;
  cachedRegistry = loaded.registry;
  return loaded;
}

export type SemanticVocabularyCode = { code: string; label?: string; description?: string };
export type SemanticVocabularyAxisEntry = { axis: CatalogSemanticDiscoveryAxis; codes: SemanticVocabularyCode[] };
export type SemanticVocabulary = { axes: SemanticVocabularyAxisEntry[] };

/**
 * SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B4.1 (task section 3). Pure,
 * bounded, planner-facing projection - axis/code/label/description only.
 * Never classifier rules, hashes, snapshot ids, checksums, internal
 * provenance, or the raw registry payload. Training axes carry codes only
 * (label/description omitted, never fabricated) - the upstream training
 * registry itself has none for these axes (see CatalogTrainingSemanticsRegistry).
 * No filtering beyond what the registries already return - a code the
 * server-side validator (validateCodesAgainstRegistry) still accepts is never
 * hidden from the model here, and vice versa: the two surfaces stay in sync
 * because they are built from the exact same cached fetch.
 */
export function projectSemanticVocabulary(product: CatalogProductSemanticsRegistry, training: CatalogTrainingSemanticsRegistry): SemanticVocabulary {
  const axes: SemanticVocabularyAxisEntry[] = product.axes.map((entry) => ({
    axis: entry.axis,
    codes: entry.values.map((value) => ({ code: value.code, label: value.labelEs, description: value.definition }))
  }));
  axes.push({ axis: "EXERCISE_CAPABILITY", codes: training.exerciseCapabilities.map((definition) => ({ code: definition.code })) });
  axes.push({ axis: "TRAINING_FUNCTION", codes: training.trainingFunctions.map((definition) => ({ code: definition.code })) });
  axes.push({ axis: "BODY_REGION", codes: training.bodyRegions.map((code) => ({ code })) });
  axes.push({ axis: "MUSCLE_GROUP", codes: training.muscleGroups.map((code) => ({ code })) });
  axes.push({ axis: "TRAINING_PATTERN", codes: training.trainingPatterns.map((code) => ({ code })) });
  return { axes };
}

/**
 * SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B4.1. The one impure entry point:
 * reuses/ensures the same per-process registry cache `execute()` already
 * relies on (never a second, independent fetch) and projects it. Never
 * throws - a missing port, an unconfigured capability, or any transport/parse
 * failure degrades to `null` (no vocabulary this turn; the model still has
 * the existing invalid_code repair loop as a safety net - server-side
 * validation is unaffected either way).
 */
export async function getSemanticVocabularyForPrompt(port: CatalogPort | null, correlationId: string): Promise<SemanticVocabulary | null> {
  if (!port) return null;
  try {
    const ensured = await ensureRegistry(port, { correlationId });
    if (!ensured.ok) return null;
    return projectSemanticVocabulary(ensured.registry.product, ensured.registry.training);
  } catch {
    return null;
  }
}

export type InvalidSemanticCodeRequirement = { axis: CatalogSemanticDiscoveryAxis; codes: string[] };

/**
 * Task section 8: invalid/stale canonical codes fail closed, never silently
 * repaired/relaxed/remapped. Returns one entry per requirement that carries
 * at least one unrecognized code, listing only the bad codes for that
 * requirement (never the whole requirement re-echoed).
 */
function validateCodesAgainstRegistry(requirements: CatalogSemanticDiscoveryRequirement[], index: RegistryIndex): InvalidSemanticCodeRequirement[] {
  const invalid: InvalidSemanticCodeRequirement[] = [];
  for (const requirement of requirements) {
    const allowed = index.get(requirement.axis);
    const badCodes = requirement.codes.filter((code) => !allowed || !allowed.has(code));
    if (badCodes.length > 0) invalid.push({ axis: requirement.axis, codes: badCodes });
  }
  return invalid;
}

function blocked(errorCode: string, data: Record<string, unknown> | null = null): CapabilityExecutionOutcome {
  return { status: "invalid_arguments", data, errorCode, retryable: false, evidence: [] };
}

function registryUnavailable(): CapabilityExecutionOutcome {
  return { status: "temporarily_blocked", data: null, errorCode: "registry_mismatch", retryable: true, evidence: [] };
}

/**
 * Deliberately not imported from registry.ts's own mapCatalogErrorToOutcome:
 * registry.ts imports this file to build the Gateway registry entry, so a
 * reverse import here would form a circular module dependency (surfaced as
 * "Cannot access 'CAPABILITY_GATEWAY_VERSION' before initialization" at
 * runtime). Same generic CatalogPortError -> Gateway outcome mapping, kept as
 * its own small copy - see registry.ts for the canonical version other
 * catalog capabilities in that same file share.
 */
function mapCatalogErrorToOutcome(error: { code: string; message: string; retryable: boolean }): CapabilityExecutionOutcome {
  const evidence = [{ source: "catalog_service_http", summary: error.message, capturedAt: new Date().toISOString() }];
  switch (error.code) {
    case "invalid_input":
      return { status: "invalid_arguments", data: null, errorCode: error.code, retryable: false, evidence };
    case "unauthorized":
      return { status: "denied", data: null, errorCode: error.code, retryable: false, evidence };
    case "rate_limited":
    case "unavailable":
    case "timeout":
      return { status: "temporarily_blocked", data: null, errorCode: error.code, retryable: true, evidence };
    case "not_found":
      return { status: "completed", data: null, errorCode: "not_found", retryable: false, evidence };
    default:
      return { status: "failed", data: null, errorCode: error.code, retryable: false, evidence };
  }
}

export function searchProductsBySemanticsCapability(
  getPort: () => CatalogPort | null
): CapabilityGatewayDefinition<Record<string, unknown>> {
  return {
    capability: "search_products_by_semantics",
    version: CAPABILITY_GATEWAY_VERSION,
    description:
      "Finds products using canonical Product and Training Semantic requirements (family, discipline, use context, exercise capability, training function, body region, muscle group, training pattern) via the catalog microservice's semantic discovery. Returns semantic eligibility only, never current price/stock/variants/link.",
    governance: { sideEffect: "read_only", authority: "autonomous", riskClass: "low" },
    inputSchema: SEARCH_PRODUCTS_BY_SEMANTICS_INPUT_SCHEMA,
    evidenceProduced: ["PRODUCT_IDENTITY", "SEMANTIC_ELIGIBILITY"],
    useWhen: USE_WHEN,
    doNotUseWhen: DO_NOT_USE_WHEN,
    maxRetries: 1,
    async checkAvailability() {
      if (getPort() === null) return { status: "unavailable", reason: "catalog_service_not_configured" };
      return { status: "available", reason: null };
    },
    async execute(input, context: CapabilityGatewayContext) {
      const port = getPort();
      if (port === null) {
        return { status: "temporarily_blocked", data: null, errorCode: "catalog_service_not_configured", retryable: true, evidence: [] };
      }

      const structural = validateStructure(input);
      if (!structural.ok) return blocked("invalid_argument");

      const registry = await ensureRegistry(port, context);
      if (!registry.ok) return registryUnavailable();

      const invalidRequirements = validateCodesAgainstRegistry(structural.requirements, registry.registry.index);
      if (invalidRequirements.length > 0) return blocked("invalid_code", { invalidRequirements });

      const query = port.querySemanticDiscovery;
      if (!query) return registryUnavailable();
      const result = await query(
        {
          requirements: structural.requirements,
          ...(structural.limit !== undefined ? { limit: structural.limit } : {}),
          ...(structural.schemaVersion !== undefined ? { schemaVersion: structural.schemaVersion } : {}),
          ...(structural.expectedSnapshots !== undefined ? { expectedSnapshots: structural.expectedSnapshots } : {})
        },
        { correlationId: context.correlationId }
      );
      if (!result.ok) return mapCatalogErrorToOutcome(result.error);

      const outcome = result.value.results.length > 0 ? "matched" : "no_match";
      return {
        status: "completed",
        data: {
          outcome,
          results: result.value.results,
          totalMatches: result.value.totalMatches,
          truncated: result.value.truncated
        },
        errorCode: null,
        retryable: false,
        evidence: [
          {
            source: "catalog_service_http",
            summary: `search_products_by_semantics ${outcome} (${result.value.results.length}/${result.value.totalMatches} result(s), truncated=${result.value.truncated}).`,
            capturedAt: new Date().toISOString()
          }
        ]
      };
    }
  };
}
