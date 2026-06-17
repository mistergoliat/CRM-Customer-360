export type CommercialEvaluationJsonValue =
  | string
  | number
  | boolean
  | null
  | CommercialEvaluationJsonValue[]
  | { [key: string]: CommercialEvaluationJsonValue };

export type CommercialEvaluationJsonRecord = Record<string, CommercialEvaluationJsonValue>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toIsoString(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))];
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

export function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return sum(values) / values.length;
}

export function percentile(values: readonly number[], rank: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const clampedRank = Math.min(1, Math.max(0, rank));
  const index = Math.max(0, Math.ceil(clampedRank * sorted.length) - 1);
  return sorted[index] ?? sorted[sorted.length - 1] ?? null;
}

export function createCounter<const T extends string>(keys: readonly T[]): Record<T, number> {
  return keys.reduce((accumulator, key) => {
    accumulator[key] = 0;
    return accumulator;
  }, {} as Record<T, number>);
}

export function incrementCounter(counter: Record<string, number>, key: string, amount = 1) {
  counter[key] = (counter[key] ?? 0) + amount;
}

export function buildTopEntries(counter: Record<string, number>, labelKey: string, limit = 5) {
  return Object.entries(counter)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([label, count]) => ({
      [labelKey]: label,
      count
    }));
}

export function safeJsonStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function isDangerousKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    normalized === "__proto__" ||
    normalized === "prototype" ||
    normalized === "constructor" ||
    normalized.includes("authorization") ||
    normalized.includes("api_key") ||
    normalized.includes("apikey") ||
    normalized.includes("api-key") ||
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("cookie")
  );
}

export function sanitizeEvaluationValue(
  value: unknown,
  options: {
    maxStringLength: number;
    maxDepth: number;
    maxBytes: number;
  },
  state?: {
    seen: WeakSet<object>;
    depth: number;
    sanitized: boolean;
    sanitizedFields: string[];
  }
): { value: CommercialEvaluationJsonValue | null; sanitized: boolean; sanitizedFields: string[]; bytes: number } {
  const currentState =
    state ??
    ({
      seen: new WeakSet<object>(),
      depth: 0,
      sanitized: false,
      sanitizedFields: []
    } satisfies {
      seen: WeakSet<object>;
      depth: number;
      sanitized: boolean;
      sanitizedFields: string[];
    });

  const sanitizeString = (input: string) => {
    if (input.length <= options.maxStringLength) return input;
    currentState.sanitized = true;
    currentState.sanitizedFields.push("string_truncated");
    return input.slice(0, options.maxStringLength);
  };

  const visit = (candidate: unknown, depth: number): CommercialEvaluationJsonValue | undefined => {
    if (candidate === null) return null;
    if (typeof candidate === "string") return sanitizeString(candidate);
    if (typeof candidate === "number") return Number.isFinite(candidate) ? candidate : String(candidate);
    if (typeof candidate === "boolean") return candidate;
    if (typeof candidate === "bigint") {
      currentState.sanitized = true;
      currentState.sanitizedFields.push("bigint");
      return candidate.toString();
    }
    if (typeof candidate === "undefined" || typeof candidate === "function" || typeof candidate === "symbol") {
      currentState.sanitized = true;
      currentState.sanitizedFields.push(typeof candidate);
      return undefined;
    }
    if (candidate instanceof Date) {
      currentState.sanitized = true;
      currentState.sanitizedFields.push("date");
      return Number.isNaN(candidate.getTime()) ? null : candidate.toISOString();
    }
    if (candidate instanceof Map) {
      currentState.sanitized = true;
      currentState.sanitizedFields.push("map");
      return Array.from(candidate.entries()).map(([key, entryValue]) => [visit(key, depth + 1) ?? null, visit(entryValue, depth + 1) ?? null]);
    }
    if (candidate instanceof Set) {
      currentState.sanitized = true;
      currentState.sanitizedFields.push("set");
      return Array.from(candidate.values()).map((entryValue) => visit(entryValue, depth + 1) ?? null);
    }
    if (Array.isArray(candidate)) {
      if (depth >= options.maxDepth) {
        currentState.sanitized = true;
        currentState.sanitizedFields.push("max_depth");
        return [];
      }
      const output: CommercialEvaluationJsonValue[] = [];
      for (const item of candidate) {
        const nested = visit(item, depth + 1);
        if (nested !== undefined) {
          output.push(nested);
        }
      }
      return output;
    }
    if (typeof candidate === "object") {
      if (currentState.seen.has(candidate as object)) {
        currentState.sanitized = true;
        currentState.sanitizedFields.push("circular_reference");
        return undefined;
      }
      if (depth >= options.maxDepth) {
        currentState.sanitized = true;
        currentState.sanitizedFields.push("max_depth");
        return {};
      }

      currentState.seen.add(candidate as object);
      const record = candidate as Record<string, unknown>;
      const output: CommercialEvaluationJsonRecord = {};
      for (const [key, nestedValue] of Object.entries(record)) {
        if (isDangerousKey(key)) {
          currentState.sanitized = true;
          currentState.sanitizedFields.push(key);
          continue;
        }
        const nested = visit(nestedValue, depth + 1);
        if (nested !== undefined) {
          output[key] = nested;
        }
      }
      return output;
    }

    currentState.sanitized = true;
    currentState.sanitizedFields.push("unknown_value");
    return undefined;
  };

  const valueResult = visit(value, currentState.depth);
  const outputValue = valueResult ?? null;
  const outputString = safeJsonStringify(outputValue);
  const outputBytes = outputString?.length ?? 0;

  if (outputBytes > options.maxBytes) {
    return {
      value: {
        truncated: true,
        sanitizedBytes: outputBytes
      },
      sanitized: true,
      sanitizedFields: uniqueStrings([...currentState.sanitizedFields, "max_bytes"]),
      bytes: outputBytes
    };
  }

  return {
    value: outputValue,
    sanitized: currentState.sanitized,
    sanitizedFields: uniqueStrings(currentState.sanitizedFields),
    bytes: outputBytes
  };
}
