import { buildWhatsAppTextRequest, buildSafeWhatsAppRequestSummary } from "./buildWhatsAppTextRequest";
import { classifyWhatsAppClientException, classifyWhatsAppResponse } from "./classifyWhatsAppResponse";
import { WHATSAPP_TRANSPORT_PROVIDER_NAME } from "./constants";
import { sanitizeWhatsAppProviderError } from "./sanitizeWhatsAppProviderError";
import { validateWhatsAppTransportInput } from "./validateWhatsAppTransportInput";
import type { MessageTransport } from "../outbox-worker/transport";
import type {
  MessageTransportResult,
  WhatsAppHttpClient,
  WhatsAppTransportConfig,
  WhatsAppTransportSendInput,
  WhatsAppTransportTrace
} from "./types";

function buildFailedResult(input: {
  attemptedAt: string;
  errorCode: MessageTransportResult["errorCode"];
  errorMessageSafe: string | null;
  providerMessageId?: string | null;
  providerRequestId?: string | null;
  status?: MessageTransportResult["status"];
}): MessageTransportResult {
  return {
    status: input.status ?? "permanent_failure",
    providerMessageId: input.providerMessageId ?? null,
    providerRequestId: input.providerRequestId ?? null,
    errorCode: input.errorCode,
    errorMessageSafe: input.errorMessageSafe,
    retryAfterSeconds: null,
    acceptedAt: null,
    completedAt: input.attemptedAt,
    metadata: {
      provider: WHATSAPP_TRANSPORT_PROVIDER_NAME,
      sandbox: true,
      simulated: true
    }
  };
}

export class WhatsAppMessageTransport implements MessageTransport {
  constructor(
    private readonly input: {
      config: WhatsAppTransportConfig;
      client: WhatsAppHttpClient;
    }
  ) {}

  buildTrace(result: MessageTransportResult, input: WhatsAppTransportSendInput, completedAt: string): WhatsAppTransportTrace {
    const validation = validateWhatsAppTransportInput(input, this.input.config);
    return {
      requestId: validation.requestId ?? "whatsapp-request:invalid",
      commandId: input.commandId,
      recipientMasked: validation.recipientMasked ?? "",
      attemptedAt: input.attemptedAt,
      completedAt,
      httpStatus: null,
      resultStatus: result.status,
      errorCode: result.errorCode,
      providerMessageId: result.providerMessageId,
      sandbox: true,
      simulated: true
    };
  }

  async send(sendInput: WhatsAppTransportSendInput): Promise<MessageTransportResult> {
    const validation = validateWhatsAppTransportInput(sendInput, this.input.config);
    if (!validation.ok) {
      return buildFailedResult({
        attemptedAt: sendInput.attemptedAt,
        errorCode: validation.errorCode ?? "unknown",
        errorMessageSafe: sanitizeWhatsAppProviderError(validation.errorMessageSafe ?? "Invalid WhatsApp transport input."),
        providerRequestId: validation.requestId,
        status: "permanent_failure"
      });
    }

    const request = buildWhatsAppTextRequest(sendInput, this.input.config);
    try {
      const response = await this.input.client.postJson({
        url: request.url,
        headers: request.headers,
        body: request.body,
        timeoutMs: request.timeoutMs,
        requestId: request.requestId
      });

      const result = classifyWhatsAppResponse(response, {
        requestId: request.requestId,
        commandId: sendInput.commandId,
        idempotencyKey: sendInput.idempotencyKey,
        attemptedAt: sendInput.attemptedAt,
        recipientMasked: request.audit.recipientMasked,
        sandbox: true,
        simulated: true
      });

      return result;
    } catch (error) {
      const result = classifyWhatsAppClientException(error, {
        requestId: request.requestId,
        commandId: sendInput.commandId,
        idempotencyKey: sendInput.idempotencyKey,
        attemptedAt: sendInput.attemptedAt,
        recipientMasked: request.audit.recipientMasked,
        sandbox: true,
        simulated: true
      });
      return result;
    }
  }

  buildRequestSummary(sendInput: WhatsAppTransportSendInput) {
    const request = buildWhatsAppTextRequest(sendInput, this.input.config);
    return buildSafeWhatsAppRequestSummary(request);
  }
}
