export const AUDIENCE_DEFINITION_V1_VERSION = "customer-intelligence-audience-definition-v1" as const;

// Confirmed against MS-pesaschile-customer-profile @ e21f7935 (2026-09-10), src/http/routes/index.ts
// - the BFF's own pre-check only; Customer Profile's zod schema (audienceEvaluateBody) remains the
// real ceiling (min 0, max CUSTOMER_INTELLIGENCE_AUDIENCE_MAX_PREVIEW_LIMIT = min(1000, 100) = 100).
export const DEFAULT_AUDIENCE_PREVIEW_LIMIT = 50;
export const MAX_AUDIENCE_PREVIEW_LIMIT = 100;

export type AudienceScalarOperator = "EQ" | "NEQ" | "IN" | "NOT_IN" | "GT" | "GTE" | "LT" | "LTE" | "BETWEEN" | "IS_NULL" | "IS_NOT_NULL";

export type AudienceFieldScalarType = "integer" | "decimal" | "string" | "datetime";

// ---- Capability schema (fetched live from GET /v1/customer-intelligence/audiences/schema -------
// per the A03.1 contract re-audit, this replaces a hardcoded field registry entirely: Customer
// Profile is the sole owner of which fields/operators/limits exist. The CRM never hand-maintains a
// second copy of this data. Shapes below mirror src/application/customer-intelligence-audience/
// schema.ts exactly.)

export type AudienceSchemaField = {
  readonly fieldId: string;
  readonly displayDescription: string;
  readonly scalarType: AudienceFieldScalarType;
  readonly component: string;
  readonly nullable: boolean;
  readonly allowedOperators: readonly AudienceScalarOperator[];
  readonly unit?: string;
};

export type AudienceCapabilitySchema = {
  readonly capabilityVersion: string;
  readonly schemaVersion: string;
  readonly definitionVersion: typeof AUDIENCE_DEFINITION_V1_VERSION;
  readonly fields: readonly AudienceSchemaField[];
  readonly specialConditions: {
    readonly hasAffinity: {
      readonly allowedAxes: readonly string[];
    };
  };
  readonly limits: {
    readonly maxFilterDepth: number;
    readonly maxConditions: number;
    readonly maxInValues: number;
    readonly defaultPreviewLimit: number;
    readonly maxPreviewLimit: number;
  };
};

export function getAudienceSchemaField(schema: AudienceCapabilitySchema, fieldId: string | null): AudienceSchemaField | null {
  if (!fieldId) return null;
  return schema.fields.find((field) => field.fieldId === fieldId) ?? null;
}

export type AudienceScalarValue = string | number | readonly (string | number)[];

export type AudienceDefinitionNode =
  | { readonly kind: "AND"; readonly children: readonly AudienceDefinitionNode[] }
  | { readonly kind: "OR"; readonly children: readonly AudienceDefinitionNode[] }
  | { readonly kind: "NOT"; readonly child: AudienceDefinitionNode }
  | { readonly kind: "SCALAR"; readonly field: string; readonly operator: AudienceScalarOperator; readonly value?: AudienceScalarValue }
  | { readonly kind: "HAS_AFFINITY"; readonly axis: string; readonly code: string; readonly minScore?: string };

export type AudienceDefinitionV1 = {
  readonly definitionVersion: typeof AUDIENCE_DEFINITION_V1_VERSION;
  readonly root: AudienceDefinitionNode;
};

export const AUDIENCE_EXPORT_FORMATS = ["CSV", "XLSX"] as const;
export type AudienceExportFormat = (typeof AUDIENCE_EXPORT_FORMATS)[number];

export const AUDIENCE_EXPORT_FIELDS = ["customerId", "email", "firstname", "lastname"] as const;
export type AudienceExportField = (typeof AUDIENCE_EXPORT_FIELDS)[number];

export const AUDIENCE_PII_EXPORT_FIELDS: readonly AudienceExportField[] = ["email", "firstname", "lastname"];

export const DEFAULT_AUDIENCE_EXPORT_FIELDS: readonly AudienceExportField[] = ["customerId", "email", "firstname", "lastname"];

export function audienceExportRequiresPii(fields: readonly AudienceExportField[]): boolean {
  return fields.some((field) => (AUDIENCE_PII_EXPORT_FIELDS as readonly string[]).includes(field));
}

// ---- Builder state (UI-side working model) -------------------------------------------------

export type AudienceBuilderGroupKind = "AND" | "OR";

export type AudienceBuilderScalarCondition = {
  readonly id: string;
  readonly type: "SCALAR";
  readonly field: string | null;
  readonly operator: AudienceScalarOperator | null;
  readonly value: string;
  readonly valueTo: string;
};

export type AudienceBuilderAffinityCondition = {
  readonly id: string;
  readonly type: "HAS_AFFINITY";
  readonly axis: string | null;
  readonly code: string;
  readonly minScore: string;
};

export type AudienceBuilderCondition = AudienceBuilderScalarCondition | AudienceBuilderAffinityCondition;

export type AudienceBuilderGroup = {
  readonly id: string;
  readonly type: "GROUP";
  readonly kind: AudienceBuilderGroupKind;
  readonly negate: boolean;
  readonly children: readonly AudienceBuilderNode[];
};

export type AudienceBuilderNode = AudienceBuilderGroup | AudienceBuilderCondition;

export type AudienceBuilderState = {
  readonly root: AudienceBuilderGroup;
};

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Date.now().toString(36)}`;
}

export function createEmptyScalarCondition(): AudienceBuilderScalarCondition {
  return { id: nextId("cond"), type: "SCALAR", field: null, operator: null, value: "", valueTo: "" };
}

export function createEmptyAffinityCondition(): AudienceBuilderAffinityCondition {
  return { id: nextId("cond"), type: "HAS_AFFINITY", axis: null, code: "", minScore: "" };
}

export function createEmptyGroup(kind: AudienceBuilderGroupKind = "AND", children: readonly AudienceBuilderNode[] = []): AudienceBuilderGroup {
  return { id: nextId("group"), type: "GROUP", kind, negate: false, children };
}

export function createEmptyAudienceBuilderState(): AudienceBuilderState {
  return { root: createEmptyGroup("AND", [createEmptyScalarCondition()]) };
}

export function isBuilderGroupEmpty(state: AudienceBuilderState): boolean {
  return countConditions(state.root) === 0;
}

function countConditions(node: AudienceBuilderNode): number {
  if (node.type !== "GROUP") return 1;
  return node.children.reduce((sum, child) => sum + countConditions(child), 0);
}

// ---- Builder tree edits (immutable, by node id) ----------------------------------------------

export function updateBuilderNode(root: AudienceBuilderGroup, id: string, updater: (node: AudienceBuilderNode) => AudienceBuilderNode): AudienceBuilderGroup {
  return mapBuilderTree(root, id, updater) as AudienceBuilderGroup;
}

function mapBuilderTree(node: AudienceBuilderNode, id: string, updater: (node: AudienceBuilderNode) => AudienceBuilderNode): AudienceBuilderNode {
  if (node.id === id) return updater(node);
  if (node.type !== "GROUP") return node;
  return { ...node, children: node.children.map((child) => mapBuilderTree(child, id, updater)) };
}

export function addBuilderChild(root: AudienceBuilderGroup, groupId: string, child: AudienceBuilderNode): AudienceBuilderGroup {
  return updateBuilderNode(root, groupId, (node) => (node.type === "GROUP" ? { ...node, children: [...node.children, child] } : node));
}

export function removeBuilderNode(root: AudienceBuilderGroup, id: string): AudienceBuilderGroup {
  return removeFromTree(root, id) ?? root;
}

function removeFromTree(node: AudienceBuilderGroup, id: string): AudienceBuilderGroup {
  return { ...node, children: node.children.filter((child) => child.id !== id).map((child) => (child.type === "GROUP" ? removeFromTree(child, id) : child)) };
}

// ---- Local validation (UX only - Customer Profile remains final authority) ------------------
// Limits (depth/conditions/inValues) come from the fetched AudienceCapabilitySchema, never a
// second hardcoded copy.

export type AudienceBuilderValidationError = { readonly nodeId: string; readonly message: string };

export type AudienceCompileResult = { readonly ok: true; readonly definition: AudienceDefinitionV1 } | { readonly ok: false; readonly errors: readonly AudienceBuilderValidationError[] };

export function compileAudienceDefinition(state: AudienceBuilderState, schema: AudienceCapabilitySchema): AudienceCompileResult {
  const errors: AudienceBuilderValidationError[] = [];
  const totalConditions = countConditions(state.root);
  if (totalConditions === 0) {
    errors.push({ nodeId: state.root.id, message: "Agrega al menos una condicion." });
  }
  if (totalConditions > schema.limits.maxConditions) {
    errors.push({ nodeId: state.root.id, message: `Maximo ${schema.limits.maxConditions} condiciones por definicion.` });
  }

  // Customer Profile counts the root itself as depth 1 (validation.ts: walk(input.root, '$.root', 1)).
  const node = errors.length === 0 ? compileNode(state.root, 1, schema, errors) : null;
  if (errors.length > 0 || node === null) return { ok: false, errors };
  return { ok: true, definition: { definitionVersion: AUDIENCE_DEFINITION_V1_VERSION, root: node } };
}

function compileNode(node: AudienceBuilderNode, depth: number, schema: AudienceCapabilitySchema, errors: AudienceBuilderValidationError[]): AudienceDefinitionNode | null {
  if (depth > schema.limits.maxFilterDepth) {
    errors.push({ nodeId: node.id, message: `Profundidad maxima de agrupacion: ${schema.limits.maxFilterDepth}.` });
    return null;
  }
  if (node.type === "SCALAR") return compileScalar(node, schema, errors);
  if (node.type === "HAS_AFFINITY") return compileAffinity(node, schema, errors);
  return compileGroup(node, depth, schema, errors);
}

function compileGroup(group: AudienceBuilderGroup, depth: number, schema: AudienceCapabilitySchema, errors: AudienceBuilderValidationError[]): AudienceDefinitionNode | null {
  if (group.children.length === 0) {
    errors.push({ nodeId: group.id, message: "El grupo no puede estar vacio." });
    return null;
  }
  const compiledChildren = group.children.map((child) => compileNode(child, depth + 1, schema, errors)).filter((child): child is AudienceDefinitionNode => child !== null);
  if (compiledChildren.length !== group.children.length) return null;

  const inner: AudienceDefinitionNode = compiledChildren.length === 1 ? compiledChildren[0] : { kind: group.kind, children: compiledChildren };
  return group.negate ? { kind: "NOT", child: inner } : inner;
}

function parseScalarValue(raw: string, scalarType: AudienceFieldScalarType): { ok: true; value: string | number } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, message: "Ingresa un valor." };
  if (scalarType === "integer") {
    const numeric = Number(trimmed);
    if (!Number.isSafeInteger(numeric)) return { ok: false, message: "El valor debe ser un numero entero." };
    return { ok: true, value: numeric };
  }
  if (scalarType === "decimal") {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return { ok: false, message: "El valor debe ser numerico." };
    return { ok: true, value: numeric };
  }
  if (scalarType === "datetime") {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(trimmed)) {
      return { ok: false, message: "La fecha debe ser un timestamp ISO-8601 UTC (ej: 2026-01-01T00:00:00Z)." };
    }
    return { ok: true, value: trimmed };
  }
  return { ok: true, value: trimmed };
}

function compileScalar(condition: AudienceBuilderScalarCondition, schema: AudienceCapabilitySchema, errors: AudienceBuilderValidationError[]): AudienceDefinitionNode | null {
  const field = getAudienceSchemaField(schema, condition.field);
  if (!field) {
    errors.push({ nodeId: condition.id, message: "Selecciona un campo valido." });
    return null;
  }
  if (!condition.operator || !field.allowedOperators.includes(condition.operator)) {
    errors.push({ nodeId: condition.id, message: "Selecciona un operador compatible con el campo." });
    return null;
  }

  if (condition.operator === "IS_NULL" || condition.operator === "IS_NOT_NULL") {
    return { kind: "SCALAR", field: field.fieldId, operator: condition.operator };
  }

  if (condition.operator === "IN" || condition.operator === "NOT_IN") {
    const rawValues = condition.value
      .split(",")
      .map((raw) => raw.trim())
      .filter((raw) => raw.length > 0);
    if (rawValues.length === 0) {
      errors.push({ nodeId: condition.id, message: `Ingresa al menos un valor para ${condition.operator}.` });
      return null;
    }
    if (rawValues.length > schema.limits.maxInValues) {
      errors.push({ nodeId: condition.id, message: `Maximo ${schema.limits.maxInValues} valores en ${condition.operator}.` });
      return null;
    }
    const parsedValues: (string | number)[] = [];
    for (const raw of rawValues) {
      const parsed = parseScalarValue(raw, field.scalarType);
      if (!parsed.ok) {
        errors.push({ nodeId: condition.id, message: parsed.message });
        return null;
      }
      parsedValues.push(parsed.value);
    }
    return { kind: "SCALAR", field: field.fieldId, operator: condition.operator, value: parsedValues };
  }

  if (condition.operator === "BETWEEN") {
    const lower = parseScalarValue(condition.value, field.scalarType);
    if (!lower.ok) {
      errors.push({ nodeId: condition.id, message: lower.message });
      return null;
    }
    const upper = parseScalarValue(condition.valueTo, field.scalarType);
    if (!upper.ok) {
      errors.push({ nodeId: condition.id, message: upper.message });
      return null;
    }
    if (lower.value > upper.value) {
      errors.push({ nodeId: condition.id, message: "El minimo de BETWEEN no puede ser mayor que el maximo." });
      return null;
    }
    return { kind: "SCALAR", field: field.fieldId, operator: "BETWEEN", value: [lower.value, upper.value] };
  }

  const parsed = parseScalarValue(condition.value, field.scalarType);
  if (!parsed.ok) {
    errors.push({ nodeId: condition.id, message: parsed.message });
    return null;
  }
  return { kind: "SCALAR", field: field.fieldId, operator: condition.operator, value: parsed.value };
}

const MAX_AFFINITY_CODE_LENGTH = 191;

function compileAffinity(condition: AudienceBuilderAffinityCondition, schema: AudienceCapabilitySchema, errors: AudienceBuilderValidationError[]): AudienceDefinitionNode | null {
  if (!condition.axis || !schema.specialConditions.hasAffinity.allowedAxes.includes(condition.axis)) {
    errors.push({ nodeId: condition.id, message: "Selecciona un eje de afinidad valido." });
    return null;
  }
  // Customer Profile treats the code as an opaque string (no enumerable registry, no case/format
  // constraint beyond a bounded, non-empty length) - never force a shape it does not require.
  const code = condition.code.trim();
  if (code.length === 0 || code.length > MAX_AFFINITY_CODE_LENGTH) {
    errors.push({ nodeId: condition.id, message: `El codigo de afinidad debe tener entre 1 y ${MAX_AFFINITY_CODE_LENGTH} caracteres.` });
    return null;
  }
  const minScoreRaw = condition.minScore.trim();
  const minScoreNumeric = Number(minScoreRaw);
  if (!Number.isFinite(minScoreNumeric) || minScoreNumeric < 0 || minScoreNumeric > 1) {
    errors.push({ nodeId: condition.id, message: "minScore debe ser un numero entre 0 y 1." });
    return null;
  }
  return { kind: "HAS_AFFINITY", axis: condition.axis, code, minScore: minScoreRaw };
}

// ---- Definition shape guard (server-side, no semantic reinterpretation) ---------------------
// Structural sanity only - Customer Profile's own validation (MAX_FILTER_DEPTH etc.) is the real
// authority, so this uses a generous static bound rather than requiring a schema fetch per request.

const SHAPE_GUARD_MAX_DEPTH = 10;

export function isPlausibleAudienceDefinition(value: unknown): value is AudienceDefinitionV1 {
  if (!isRecord(value)) return false;
  if (value.definitionVersion !== AUDIENCE_DEFINITION_V1_VERSION) return false;
  return isPlausibleAudienceNode(value.root, 0);
}

function isPlausibleAudienceNode(value: unknown, depth: number): boolean {
  if (depth > SHAPE_GUARD_MAX_DEPTH) return false;
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "AND":
    case "OR":
      return Array.isArray(value.children) && value.children.length > 0 && value.children.every((child) => isPlausibleAudienceNode(child, depth + 1));
    case "NOT":
      return isPlausibleAudienceNode(value.child, depth + 1);
    case "SCALAR":
      return typeof value.field === "string" && value.field.length > 0 && typeof value.operator === "string";
    case "HAS_AFFINITY":
      return typeof value.axis === "string" && typeof value.code === "string";
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---- Deterministic checksum (display/staleness only - not cryptographic) --------------------

export function canonicalizeForChecksum(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeForChecksum);
  if (isRecord(value)) {
    const sortedKeys = Object.keys(value).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) result[key] = canonicalizeForChecksum(value[key]);
    return result;
  }
  return value;
}

export function hashAudienceDefinition(definition: AudienceDefinitionV1): string {
  const json = JSON.stringify(canonicalizeForChecksum(definition));
  let hash = 5381;
  for (let index = 0; index < json.length; index += 1) {
    hash = ((hash << 5) + hash + json.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ---- Evaluate response reading -----------------------------------------------------------------
// Matches EvaluateAudienceCapabilityResponse / AudienceEvaluationResultV1 in
// MS-pesaschile-customer-profile src/domain/customer-intelligence-audience/contracts.ts exactly:
// the wire body is { capabilityVersion, evaluation: {status:'completed'|'blocked', ...}, preview }.

export type AudienceValidationErrorV1 = { readonly code: string; readonly path: string; readonly message: string };

export type AudiencePreviewRow = Readonly<Record<string, unknown>> & { readonly customerId?: unknown };

export type AudienceEvaluationSummary = {
  readonly population: number;
  readonly matched: number;
  readonly notMatched: number;
  readonly unknown: number;
  readonly preview: readonly AudiencePreviewRow[];
  readonly definitionChecksum: string | null;
  readonly referenceTime: string | null;
  readonly snapshotId: string | null;
};

export type AudienceEvaluationOutcome =
  | { readonly kind: "completed"; readonly summary: AudienceEvaluationSummary }
  | { readonly kind: "blocked"; readonly reason: string; readonly validationErrors: readonly AudienceValidationErrorV1[] }
  | { readonly kind: "unparseable" };

export function readAudienceEvaluateResponse(body: unknown): AudienceEvaluationOutcome {
  if (!isRecord(body) || !isRecord(body.evaluation)) return { kind: "unparseable" };
  const evaluation = body.evaluation;

  if (evaluation.status === "blocked") {
    return {
      kind: "blocked",
      reason: typeof evaluation.reason === "string" ? evaluation.reason : "UNKNOWN",
      validationErrors: Array.isArray(evaluation.validationErrors) ? evaluation.validationErrors.filter(isValidationError) : []
    };
  }
  if (evaluation.status !== "completed") return { kind: "unparseable" };

  const population = evaluation.populationUniverseCount;
  const matched = evaluation.matchedCount;
  const notMatched = evaluation.falseCount;
  const unknown = evaluation.unknownCount;
  if (typeof population !== "number" || typeof matched !== "number" || typeof notMatched !== "number" || typeof unknown !== "number") {
    return { kind: "unparseable" };
  }

  const previewRows = isRecord(body.preview) && Array.isArray(body.preview.rows) ? body.preview.rows.filter(isRecord) : [];

  return {
    kind: "completed",
    summary: {
      population,
      matched,
      notMatched,
      unknown,
      preview: previewRows,
      definitionChecksum: typeof evaluation.definitionChecksum === "string" ? evaluation.definitionChecksum : null,
      referenceTime: typeof evaluation.referenceTime === "string" ? evaluation.referenceTime : null,
      snapshotId: extractFeatureSnapshotId(evaluation.context)
    }
  };
}

function extractFeatureSnapshotId(context: unknown): string | null {
  if (!isRecord(context)) return null;
  const lineage = context.lineage;
  if (!isRecord(lineage)) return null;
  const feature = lineage.feature;
  if (!isRecord(feature) || typeof feature.snapshotId !== "string") return null;
  return feature.snapshotId;
}

function isValidationError(value: unknown): value is AudienceValidationErrorV1 {
  return isRecord(value) && typeof value.code === "string" && typeof value.path === "string" && typeof value.message === "string";
}

// Flattens the confirmed preview row shape (customerId, commercial{}, rfm{}, cluster{}, clv{},
// affinities[]) into one flat record per row so the existing generic, dynamic-column
// AudiencePreviewTable can render it without knowing about the nested contract.
export function flattenAudiencePreviewRow(row: AudiencePreviewRow): Readonly<Record<string, unknown>> {
  const commercial = isRecord(row.commercial) ? row.commercial : {};
  const rfm = isRecord(row.rfm) ? row.rfm : null;
  const cluster = isRecord(row.cluster) ? row.cluster : null;
  const clv = isRecord(row.clv) ? row.clv : null;
  const affinities = Array.isArray(row.affinities) ? row.affinities.filter(isRecord) : [];
  const topAffinity = affinities[0];

  return {
    customerId: row.customerId ?? null,
    validOrders: commercial.validOrders ?? null,
    totalSpentTaxIncl: commercial.totalSpentTaxIncl ?? null,
    daysSinceLastOrder: commercial.daysSinceLastOrder ?? null,
    rfmSegmentCode: rfm ? rfm.segmentCode ?? null : null,
    clusterId: cluster ? cluster.clusterId ?? null : null,
    clvExpectedRevenueTaxIncl: clv ? clv.expectedRevenueTaxIncl ?? null : null,
    topAffinity: topAffinity ? `${String(topAffinity.axis)}:${String(topAffinity.code)}` : null
  };
}
