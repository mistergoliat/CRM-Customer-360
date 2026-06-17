import {
  SALES_AGENT_OUTPUT_MAX_ARRAY_LENGTH,
  SALES_AGENT_OUTPUT_MAX_OBJECT_DEPTH,
  SALES_AGENT_OUTPUT_MAX_STRING_LENGTH,
  SALES_AGENT_OUTPUT_VALIDATION_ISSUE_CODES
} from "./validationTypes";
import type { SalesAgentOutputValidationIssue, SalesAgentOutputValidationIssueCode } from "./validationTypes";

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const NON_SERIALIZABLE_TYPES = new Set(["function", "symbol"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function toIssue(
  code: SalesAgentOutputValidationIssueCode,
  message: string,
  path: string[],
  details?: Record<string, unknown>,
  level: SalesAgentOutputValidationIssue["level"] = code === "forbidden_key" || code === "invalid_root" || code === "non_serializable_value" ? "fatal" : "warning"
): SalesAgentOutputValidationIssue {
  if (!SALES_AGENT_OUTPUT_VALIDATION_ISSUE_CODES.includes(code)) {
    return {
      code: "unknown_issue",
      level,
      message,
      path,
      details
    };
  }

  return {
    code,
    level,
    message,
    path,
    details
  };
}

function stringifyBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function sanitizeString(value: string) {
  return value.length > SALES_AGENT_OUTPUT_MAX_STRING_LENGTH
    ? value.slice(0, SALES_AGENT_OUTPUT_MAX_STRING_LENGTH)
    : value;
}

function sanitizeRecursive(
  value: unknown,
  state: {
    issues: SalesAgentOutputValidationIssue[];
    sanitizedFields: string[];
    seen: WeakSet<object>;
  },
  path: string[],
  depth: number
): unknown {
  if (value === null || typeof value === "boolean") return value;

  if (typeof value === "string") {
    const trimmed = sanitizeString(value);
    if (trimmed !== value) {
      state.issues.push(
        toIssue("excessive_string_length", "String value exceeded the maximum length and was trimmed.", path, {
          maxLength: SALES_AGENT_OUTPUT_MAX_STRING_LENGTH
        }, "warning")
      );
      state.sanitizedFields.push(path.join("."));
    }
    return trimmed;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === "bigint") {
    state.issues.push(
      toIssue("non_serializable_value", "BigInt values are not allowed in SalesAgentOutput and were converted to string.", path, {
        receivedType: "bigint"
      }, "warning")
    );
    state.sanitizedFields.push(path.join("."));
    return value.toString();
  }

  if (NON_SERIALIZABLE_TYPES.has(typeof value)) {
    state.issues.push(
      toIssue("non_serializable_value", "Non-serializable values are not allowed in SalesAgentOutput.", path, {
        receivedType: typeof value
      }, "error")
    );
    return undefined;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      state.issues.push(
        toIssue("non_serializable_value", "Invalid Date values are not allowed in SalesAgentOutput.", path, {
          receivedType: "Date"
        }, "error")
      );
      return undefined;
    }
    state.issues.push(
      toIssue("non_serializable_value", "Date values were normalized to ISO strings.", path, {
        receivedType: "Date"
      }, "warning")
    );
    state.sanitizedFields.push(path.join("."));
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    if (depth >= SALES_AGENT_OUTPUT_MAX_OBJECT_DEPTH) {
      state.issues.push(
        toIssue("excessive_object_depth", "Array nesting exceeded the maximum allowed object depth.", path, {
          maxDepth: SALES_AGENT_OUTPUT_MAX_OBJECT_DEPTH
        }, "error")
      );
      return undefined;
    }

    const limited = value.slice(0, SALES_AGENT_OUTPUT_MAX_ARRAY_LENGTH);
    if (limited.length !== value.length) {
      state.issues.push(
        toIssue("excessive_array_length", "Array value exceeded the maximum length and was trimmed.", path, {
          maxLength: SALES_AGENT_OUTPUT_MAX_ARRAY_LENGTH
        }, "warning")
      );
      state.sanitizedFields.push(path.join("."));
    }

    const output: unknown[] = [];
    for (let index = 0; index < limited.length; index += 1) {
      const item = sanitizeRecursive(limited[index], state, [...path, String(index)], depth + 1);
      if (item !== undefined) output.push(item);
    }
    return output;
  }

  if (!isPlainObject(value)) {
    state.issues.push(
      toIssue("non_serializable_value", "Only plain JSON objects are allowed in SalesAgentOutput.", path, {
        receivedType: Object.prototype.toString.call(value)
      }, "error")
    );
    return undefined;
  }

  if (state.seen.has(value)) {
    state.issues.push(
      toIssue("non_serializable_value", "Circular references are not allowed in SalesAgentOutput.", path, {
        receivedType: "circular_reference"
      }, "fatal")
    );
    return undefined;
  }

  if (depth >= SALES_AGENT_OUTPUT_MAX_OBJECT_DEPTH) {
    state.issues.push(
      toIssue("excessive_object_depth", "Object nesting exceeded the maximum allowed depth.", path, {
        maxDepth: SALES_AGENT_OUTPUT_MAX_OBJECT_DEPTH
      }, "error")
    );
    return undefined;
  }

  state.seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      state.issues.push(
        toIssue("forbidden_key", "Forbidden key encountered in SalesAgentOutput.", [...path, key], {
          key
        }, "fatal")
      );
      continue;
    }

    const sanitizedNested = sanitizeRecursive(nestedValue, state, [...path, key], depth + 1);
    if (sanitizedNested !== undefined) {
      output[key] = sanitizedNested;
    }
  }

  return output;
}

export function sanitizeSalesAgentOutput(value: unknown): SalesAgentOutputSanitizationResult {
  const state = {
    issues: [] as SalesAgentOutputValidationIssue[],
    sanitizedFields: [] as string[],
    seen: new WeakSet<object>()
  };

  if (!isPlainObject(value)) {
    return {
      value: null,
      issues: [
        toIssue("invalid_root", "SalesAgentOutput root must be a plain object.", [], {
          receivedType: Array.isArray(value) ? "array" : value === null ? "null" : typeof value
        }, "fatal")
      ],
      sanitizedFields: [],
      rootType: Array.isArray(value) ? "array" : value === null ? "null" : typeof value,
      outputBytes: 0,
      sanitized: false
    };
  }

  const sanitized = sanitizeRecursive(value, state, [], 0);
  const output = isPlainObject(sanitized) ? sanitized : null;

  return {
    value: output,
    issues: state.issues,
    sanitizedFields: [...new Set(state.sanitizedFields)],
    rootType: "object",
    outputBytes: output ? stringifyBytes(output) : 0,
    sanitized: state.issues.length > 0
  };
}

export type SalesAgentOutputSanitizationResult = {
  value: Record<string, unknown> | null;
  issues: SalesAgentOutputValidationIssue[];
  sanitizedFields: string[];
  rootType: string;
  outputBytes: number;
  sanitized: boolean;
};
