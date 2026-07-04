import type { ConversationRequest } from "../conversation-request";
import type { AppliedRequestOperation } from "./persistRequestOperations";

/** WhatsApp hard limit is 4096; leave headroom for encoding differences. */
const MAX_RESPONSE_CHARACTERS = 3900;

export type RequestResult = {
  requestId: string;
  intentType: string;
  status: string;
  /** Verified, human-readable outcome of this turn for the request; null when nothing happened yet. */
  summary: string | null;
  resolved: boolean;
};

export type MissingFact = {
  requestId: string;
  factKey: string;
  question: string | null;
};

export type DeferredAction = {
  requestId: string;
  actionType: string;
  reason: string;
};

export type EscalationSummary = {
  requestId: string;
  category: string;
  reason: string;
};

export type GroundedResponseInput = {
  customerMessage: string;
  requestResults: RequestResult[];
  missingFacts: MissingFact[];
  deferredActions: DeferredAction[];
  escalations: EscalationSummary[];
  mandatoryStatements: string[];
  forbiddenClaims: string[];
};

export type GroundedResponseProvider = {
  name: string;
  generate(input: GroundedResponseInput): Promise<{ text: string }>;
};

export type GroundedResponseResult = {
  text: string;
  usedFallback: boolean;
  providerName: string | null;
  warnings: string[];
};

const INTENT_LABELS: Record<string, string> = {
  product_quote: "tu cotización",
  maintenance_quote: "la cotización de mantención",
  maintenance_information: "tu consulta de mantención",
  product_information: "tu consulta de producto",
  order_status: "el estado de tu pedido",
  warranty: "tu consulta de garantía",
  complaint: "tu reclamo",
  human_assistance: "tu solicitud de atención personalizada",
  general_question: "tu consulta"
};

function labelFor(intentType: string): string {
  return INTENT_LABELS[intentType] ?? "tu solicitud";
}

/**
 * Pure assembly of the redaction input from the turn's verified results. Only
 * facts that actually happened enter here: an operation that failed or never
 * ran cannot produce a summary the generator could phrase as success.
 */
export function buildGroundedResponseInput(input: {
  customerMessage: string;
  activeRequests: readonly ConversationRequest[];
  appliedOperations: readonly AppliedRequestOperation[];
  missingFacts?: MissingFact[];
  deferredActions?: DeferredAction[];
  escalations?: EscalationSummary[];
  mandatoryStatements?: string[];
  forbiddenClaims?: string[];
}): GroundedResponseInput {
  const requestsById = new Map(input.activeRequests.map((request) => [request.requestId, request]));
  const seen = new Set<string>();
  const requestResults: RequestResult[] = [];

  for (const operation of input.appliedOperations) {
    if (!operation.requestId || seen.has(operation.requestId)) continue;
    if (operation.status === "failed" || operation.status === "skipped") continue;
    seen.add(operation.requestId);
    const request = requestsById.get(operation.requestId) ?? operation.request;
    if (!request) continue;
    requestResults.push({
      requestId: request.requestId,
      intentType: request.intentType,
      status: request.status,
      summary:
        operation.operation === "create"
          ? `Registré ${labelFor(request.intentType)} y ya estoy trabajando en ella.`
          : operation.operation === "reopen"
            ? `Retomé ${labelFor(request.intentType)}.`
            : operation.operation === "cancel"
              ? `Cancelé ${labelFor(request.intentType)} como pediste.`
              : `Sigo avanzando con ${labelFor(request.intentType)}.`,
      resolved: request.status === "resolved"
    });
  }

  return {
    customerMessage: input.customerMessage,
    requestResults,
    missingFacts: input.missingFacts ?? [],
    deferredActions: input.deferredActions ?? [],
    escalations: input.escalations ?? [],
    mandatoryStatements: input.mandatoryStatements ?? [],
    forbiddenClaims: input.forbiddenClaims ?? []
  };
}

/**
 * Deterministic composer: one natural message covering every request of the
 * turn - resolved ones, pending questions, deferrals and escalations - built
 * exclusively from verified inputs. This is also the fail-safe when a model
 * provider misbehaves; it never calls anything.
 */
export function composeDeterministicResponse(input: GroundedResponseInput): string {
  const lines: string[] = [];

  for (const result of input.requestResults) {
    if (result.summary) lines.push(result.summary);
  }

  const questionsByRequest = new Map<string, string[]>();
  for (const fact of input.missingFacts) {
    const bucket = questionsByRequest.get(fact.requestId) ?? [];
    bucket.push(fact.question ?? `necesito que me indiques ${fact.factKey.replace(/_/g, " ")}`);
    questionsByRequest.set(fact.requestId, bucket);
  }
  for (const [requestId, questions] of questionsByRequest) {
    const request = input.requestResults.find((result) => result.requestId === requestId);
    const label = request ? labelFor(request.intentType) : "tu solicitud";
    lines.push(`Para avanzar con ${label}: ${questions.join(" y ")}.`);
  }

  for (const deferred of input.deferredActions) {
    const request = input.requestResults.find((result) => result.requestId === deferred.requestId);
    lines.push(`Quedé pendiente de ${request ? labelFor(request.intentType) : "una gestión"}; te aviso apenas tenga novedades.`);
  }

  for (const escalation of input.escalations) {
    const request = input.requestResults.find((result) => result.requestId === escalation.requestId);
    lines.push(`Derivé ${request ? labelFor(request.intentType) : "tu solicitud"} a nuestro equipo para que te contacte.`);
  }

  lines.push(...input.mandatoryStatements);

  if (lines.length === 0) {
    return "Recibí tu mensaje y lo estoy revisando. Te respondo en breve.";
  }

  return lines.join("\n\n").slice(0, MAX_RESPONSE_CHARACTERS);
}

function violatesConstraints(text: string, input: GroundedResponseInput): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "empty_response";
  if (trimmed.length > MAX_RESPONSE_CHARACTERS) return "response_too_long";
  const lowered = trimmed.toLowerCase();
  for (const claim of input.forbiddenClaims) {
    if (claim.trim() && lowered.includes(claim.trim().toLowerCase())) return `forbidden_claim:${claim}`;
  }
  for (const statement of input.mandatoryStatements) {
    if (statement.trim() && !lowered.includes(statement.trim().toLowerCase())) return `missing_mandatory_statement:${statement}`;
  }
  return null;
}

/**
 * The generator only writes. It never executes, proposes tools, changes
 * state, confirms addresses or claims success without a verified input. A
 * provider failure or a constraint violation falls back to the deterministic
 * template - never to a second model attempt.
 */
export async function generateGroundedResponse(
  input: GroundedResponseInput,
  provider?: GroundedResponseProvider | null
): Promise<GroundedResponseResult> {
  if (!provider) {
    return { text: composeDeterministicResponse(input), usedFallback: false, providerName: null, warnings: [] };
  }

  try {
    const output = await provider.generate(input);
    const violation = violatesConstraints(output.text, input);
    if (violation) {
      return {
        text: composeDeterministicResponse(input),
        usedFallback: true,
        providerName: provider.name,
        warnings: [`grounded_response_rejected:${violation}`]
      };
    }
    return { text: output.text.trim(), usedFallback: false, providerName: provider.name, warnings: [] };
  } catch (error) {
    return {
      text: composeDeterministicResponse(input),
      usedFallback: true,
      providerName: provider.name,
      warnings: [`grounded_response_provider_failed:${error instanceof Error ? error.message : String(error)}`]
    };
  }
}
