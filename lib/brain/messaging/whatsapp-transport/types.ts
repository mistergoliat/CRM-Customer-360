import type {
  MessageTransportErrorCode,
  MessageTransportResultStatus
} from "../outbox-worker/types";
import type { MessageTransport } from "../outbox-worker/transport";

export type WhatsAppTransportSendInput = Parameters<MessageTransport["send"]>[0];

export type WhatsAppTransportConfig = {
  enabled: boolean;
  sandbox: boolean;

  graphBaseUrl: string;
  graphApiVersion: string;
  phoneNumberId: string;

  accessToken: string;

  timeoutMs: number;

  allowedRecipients: string[];

  requireExactWhitelistMatch: boolean;

  maxTextLength: number;
};

export interface WhatsAppHttpResponse {
  statusCode: number;

  headers: Record<string, string>;

  body: unknown;

  completedAt: string;
}

export interface WhatsAppHttpClient {
  postJson(input: {
    url: string;
    headers: Record<string, string>;
    body: unknown;
    timeoutMs: number;
    requestId: string;
  }): Promise<WhatsAppHttpResponse>;
}

export type WhatsAppProviderRequest = {
  requestId: string;

  url: string;

  method: "POST";

  headers: {
    Authorization: string;
    "Content-Type": "application/json";
    "X-Idempotency-Key": string;
  };

  body: {
    messaging_product: "whatsapp";
    recipient_type: "individual";
    to: string;
    type: "text";
    text: {
      preview_url: false;
      body: string;
    };
  };

  timeoutMs: number;

  audit: {
    recipientMasked: string;
    commandId: string;
    idempotencyKey: string;
    sandbox: true;
  };
};

export type WhatsAppTransportTrace = {
  requestId: string;
  commandId: string;
  recipientMasked: string;
  attemptedAt: string;
  completedAt: string;
  httpStatus: number | null;
  resultStatus: MessageTransportResultStatus;
  errorCode: MessageTransportErrorCode;
  providerMessageId: string | null;
  sandbox: true;
  simulated: boolean;
};

export type WhatsAppTransportValidationResult = {
  ok: boolean;

  requestId: string | null;
  normalizedRecipient: string | null;
  recipientMasked: string | null;

  errorCode: MessageTransportErrorCode | null;
  errorMessageSafe: string | null;

  warnings: string[];
};

export type WhatsAppTransportResponseClassificationContext = {
  requestId: string;
  commandId: string;
  idempotencyKey: string;
  attemptedAt: string;
  recipientMasked: string;
  sandbox: true;
  simulated: boolean;
};

export type WhatsAppTransportClientExceptionKind = "timeout" | "network" | "unknown";

export type WhatsAppTransportClientException = Error & {
  kind?: WhatsAppTransportClientExceptionKind;
  code?: string;
  statusCode?: number;
  providerMessageId?: string | null;
};

export type WhatsAppTransportSafeRequestSummary = {
  requestId: string;
  commandId: string;
  idempotencyKey: string;
  url: string;
  method: "POST";
  recipientMasked: string;
  sandbox: true;
  timeoutMs: number;
  bodyLength: number;
};

export type WhatsAppTransportErrorDetails = {
  providerCode: string | null;
  providerSubcode: string | null;
  safeMessage: string | null;
  traceIdMasked: string | null;
};

export type {
  MessageTransportErrorCode,
  MessageTransportResult,
  MessageTransportResultStatus
} from "../outbox-worker/types";
