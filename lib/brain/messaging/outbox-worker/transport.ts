import { buildFakeProviderMessageId, sanitizeOutboxWorkerErrorMessage } from "./constants";
import type { MessageTransportErrorCode, MessageTransportResult, MessageTransportResultStatus } from "./types";

export interface MessageTransport {
  send(input: {
    commandId: string;
    idempotencyKey: string;

    channel: "whatsapp";
    commandType: "whatsapp_text";

    recipient: string;
    messageText: string;

    sandbox: boolean;
    attemptedAt: string;
  }): Promise<MessageTransportResult>;
}

export type FakeTransportScenario =
  | "accepted"
  | "temporary_failure"
  | "permanent_failure"
  | "rate_limited"
  | "timeout"
  | "duplicate_accepted"
  | "invalid_recipient"
  | "invalid_payload"
  | "authentication_error"
  | "permission_error"
  | "policy_rejected"
  | "provider_duplicate";

export type FakeTransportCall = {
  commandId: string;
  idempotencyKey: string;
  channel: "whatsapp";
  commandType: "whatsapp_text";
  recipientMasked: string | null;
  messageLength: number;
  sandbox: boolean;
  attemptedAt: string;
  scenario: FakeTransportScenario;
};

export type FakeMessageTransportConfig = {
  scenarioByIdempotencyKey?: Record<string, FakeTransportScenario>;
  defaultScenario?: FakeTransportScenario;
};

function maskDigits(value: string) {
  const digits = value.replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length <= 6) {
    if (digits.length <= 2) return "*".repeat(digits.length);
    return `${digits.slice(0, 1)}${"*".repeat(Math.max(0, digits.length - 2))}${digits.slice(-1)}`;
  }
  return `${digits.slice(0, 3)}${"*".repeat(Math.max(0, digits.length - 6))}${digits.slice(-3)}`;
}

function resultStatusForScenario(scenario: FakeTransportScenario): MessageTransportResultStatus {
  switch (scenario) {
    case "accepted":
      return "accepted";
    case "duplicate_accepted":
      return "duplicate_accepted";
    case "temporary_failure":
      return "temporary_failure";
    case "permanent_failure":
    case "invalid_recipient":
    case "invalid_payload":
    case "authentication_error":
    case "permission_error":
    case "policy_rejected":
    case "provider_duplicate":
      return "permanent_failure";
    case "rate_limited":
      return "rate_limited";
    case "timeout":
      return "timeout";
  }
}

function errorCodeForScenario(scenario: FakeTransportScenario): MessageTransportErrorCode {
  switch (scenario) {
    case "accepted":
      return "none";
    case "duplicate_accepted":
      return "provider_duplicate";
    case "temporary_failure":
      return "network_error";
    case "permanent_failure":
      return "provider_unavailable";
    case "invalid_recipient":
      return "invalid_recipient";
    case "invalid_payload":
      return "invalid_payload";
    case "authentication_error":
      return "authentication_error";
    case "permission_error":
      return "permission_error";
    case "policy_rejected":
      return "policy_rejected";
    case "provider_duplicate":
      return "provider_duplicate";
    case "rate_limited":
      return "rate_limited";
    case "timeout":
      return "timeout";
  }
}

function retryAfterSecondsForScenario(scenario: FakeTransportScenario): number | null {
  switch (scenario) {
    case "accepted":
    case "duplicate_accepted":
    case "invalid_recipient":
    case "invalid_payload":
    case "authentication_error":
    case "permission_error":
    case "policy_rejected":
    case "provider_duplicate":
    case "permanent_failure":
      return null;
    case "temporary_failure":
      return 30;
    case "rate_limited":
      return 120;
    case "timeout":
      return 60;
  }
}

function errorMessageForScenario(scenario: FakeTransportScenario): string | null {
  switch (scenario) {
    case "accepted":
      return null;
    case "duplicate_accepted":
      return "Duplicate delivery acknowledged.";
    case "temporary_failure":
      return "Temporary transport failure.";
    case "permanent_failure":
      return "Permanent transport failure.";
    case "invalid_recipient":
      return "Invalid recipient.";
    case "invalid_payload":
      return "Invalid payload.";
    case "authentication_error":
      return "Authentication error.";
    case "permission_error":
      return "Permission error.";
    case "policy_rejected":
      return "Policy rejected.";
    case "provider_duplicate":
      return "Provider duplicate.";
    case "rate_limited":
      return "Transport rate limit reached.";
    case "timeout":
      return "Transport timed out.";
  }
}

export class FakeMessageTransport implements MessageTransport {
  private readonly scenarioByIdempotencyKey: Record<string, FakeTransportScenario>;
  private readonly defaultScenario: FakeTransportScenario;
  private readonly calls: FakeTransportCall[] = [];

  constructor(config: FakeMessageTransportConfig = {}) {
    this.scenarioByIdempotencyKey = { ...(config.scenarioByIdempotencyKey ?? {}) };
    this.defaultScenario = config.defaultScenario ?? "accepted";
  }

  snapshotCalls() {
    return this.calls.map((call) => ({ ...call }));
  }

  async send(input: {
    commandId: string;
    idempotencyKey: string;

    channel: "whatsapp";
    commandType: "whatsapp_text";

    recipient: string;
    messageText: string;

    sandbox: boolean;
    attemptedAt: string;
  }): Promise<MessageTransportResult> {
    const scenario = this.scenarioByIdempotencyKey[input.idempotencyKey] ?? this.defaultScenario;
    this.calls.push({
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey,
      channel: input.channel,
      commandType: input.commandType,
      recipientMasked: maskDigits(input.recipient),
      messageLength: input.messageText.length,
      sandbox: input.sandbox,
      attemptedAt: input.attemptedAt,
      scenario
    });

    const status = resultStatusForScenario(scenario);
    const providerMessageId = status === "accepted" || status === "duplicate_accepted" ? buildFakeProviderMessageId({ commandId: input.commandId }) : null;
    const providerRequestId = `fake-request:${input.commandId}`;
    const retryAfterSeconds = retryAfterSecondsForScenario(scenario);
    const errorCode = errorCodeForScenario(scenario);
    const errorMessageSafe = sanitizeOutboxWorkerErrorMessage(errorMessageForScenario(scenario));

    return {
      status,
      providerMessageId,
      providerRequestId,
      errorCode,
      errorMessageSafe,
      retryAfterSeconds,
      acceptedAt: status === "accepted" || status === "duplicate_accepted" ? input.attemptedAt : null,
      completedAt: input.attemptedAt,
      metadata: {
        provider: "fake",
        sandbox: input.sandbox,
        simulated: true
      }
    };
  }
}
