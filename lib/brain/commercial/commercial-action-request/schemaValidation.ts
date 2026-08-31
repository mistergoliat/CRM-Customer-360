// SALES-AGENT-R3-A03, Phase 4. A minimal interpreter for exactly the JSON
// Schema subset CapabilityGatewayDefinition.inputSchema already uses across
// this repo (type/properties/required/additionalProperties/minItems/
// minimum/maximum/enum/items - see capability-gateway/types.ts's own doc
// comment). Not a general-purpose validator, not a new dependency (no ajv/
// json-schema in package.json - this repo hand-validates everywhere else
// too, e.g. registry.ts's asQueryText/asProductId/asBatchItems) - reuses the
// four capabilities' own exported *_INPUT_SCHEMA constants directly, never a
// second, duplicated per-action validator.

type JsonSchema = Record<string, unknown>;

function validateValue(value: unknown, schema: JsonSchema, path: string): string | null {
  const type = schema.type;

  if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return `${path}: expected object`;
    const record = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? (schema.required as unknown[]).filter((key): key is string => typeof key === "string") : [];
    for (const key of required) {
      if (record[key] === undefined || record[key] === null) return `${path}.${key}: required`;
    }
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) return `${path}.${key}: unexpected property`;
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      // A required property with a null/undefined value already failed above
      // (and is never re-checked here). An OPTIONAL property left `null`
      // (as many real LLM tool-call payloads represent "not supplied") is
      // treated the same as absent, never a type violation - matching this
      // repo's own capability-level validators (e.g. selectProductsCapability.ts's
      // asLineItems: `typeof record.combinationId === "string" ... : null`).
      if (record[key] === undefined || record[key] === null) continue;
      const error = validateValue(record[key], propertySchema, `${path}.${key}`);
      if (error) return error;
    }
    return null;
  }

  if (type === "array") {
    if (!Array.isArray(value)) return `${path}: expected array`;
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return `${path}: expected at least ${schema.minItems} item(s)`;
    const itemSchema = schema.items as JsonSchema | undefined;
    if (itemSchema) {
      for (let index = 0; index < value.length; index += 1) {
        const error = validateValue(value[index], itemSchema, `${path}[${index}]`);
        if (error) return error;
      }
    }
    return null;
  }

  if (type === "string") {
    if (typeof value !== "string") return `${path}: expected string`;
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${path}: not in enum`;
    return null;
  }

  if (type === "integer" || type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `${path}: expected ${type}`;
    if (type === "integer" && !Number.isInteger(value)) return `${path}: expected integer`;
    if (typeof schema.minimum === "number" && value < schema.minimum) return `${path}: below minimum`;
    if (typeof schema.maximum === "number" && value > schema.maximum) return `${path}: above maximum`;
    return null;
  }

  // Unrecognized/unused schema keyword for this repo's actual schemas -
  // never blocks (this interpreter only needs the subset already in use).
  return null;
}

export function validateAgainstCapabilityInputSchema(input: unknown, schema: JsonSchema): { valid: true } | { valid: false; reason: string } {
  const error = validateValue(input, schema, "input");
  return error ? { valid: false, reason: error } : { valid: true };
}
