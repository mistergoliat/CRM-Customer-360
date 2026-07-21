/**
 * Extracts and parses the first JSON object from a raw LLM text response.
 * Shared by every OpenAI-compatible HTTP provider (sales-agent runtime,
 * agent-loop) so there is exactly one implementation of "the model may wrap
 * JSON in a markdown fence or trailing prose."
 */
export function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]?.trim() ?? "" : trimmed;
}

export function extractFirstJsonObject(value: string): string {
  const stripped = stripJsonFence(value);
  const start = stripped.indexOf("{");
  if (start < 0) return stripped;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < stripped.length; index += 1) {
    const char = stripped[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return stripped.slice(start, index + 1);
    }
  }

  return stripped;
}

export function parseModelJson(content: string): unknown {
  try {
    return JSON.parse(extractFirstJsonObject(content));
  } catch {
    throw new Error("Provider returned invalid response JSON.");
  }
}
