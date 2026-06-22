"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRAIN_CASE_UPDATE_STATUSES = exports.validateWhatsAppTransportInput = exports.sanitizeWhatsAppProviderError = exports.normalizeWhatsAppRecipient = exports.extractSafeWhatsAppProviderError = exports.classifyWhatsAppResponse = exports.classifyWhatsAppClientException = exports.buildWhatsAppTextRequest = exports.buildWhatsAppRequestId = exports.buildSafeWhatsAppRequestSummary = exports.WhatsAppMessageTransport = exports.FakeWhatsAppHttpClient = exports.BRAIN_CANONICAL_OUTBOUND_PERSIST_STATUSES = exports.BRAIN_OUTBOX_WORKER_MODES = exports.BRAIN_OUTBOX_WORKER_STATUSES = exports.BRAIN_OUTBOX_COMMAND_TYPES = exports.BRAIN_META_SEND_OUTCOME_STATUSES = exports.BRAIN_META_SEND_ERROR_CODES = exports.BRAIN_META_SEND_ADAPTER_STATUSES = exports.BRAIN_OUTBOX_STATUSES = exports.BRAIN_EXECUTION_STATUSES = exports.BRAIN_EXECUTION_ACTION_TYPES = exports.BRAIN_EXECUTE_SOURCES = void 0;
exports.BRAIN_EXECUTE_SOURCES = ["brain", "n8n", "operator"];
exports.BRAIN_EXECUTION_ACTION_TYPES = [
    "send_whatsapp_message",
    "update_case",
    "handoff",
    "close_case",
    "no_action"
];
exports.BRAIN_EXECUTION_STATUSES = ["planned", "blocked", "noop"];
exports.BRAIN_OUTBOX_STATUSES = ["planned", "pending", "locked", "sending", "sent", "failed", "cancelled", "blocked"];
exports.BRAIN_META_SEND_ADAPTER_STATUSES = ["disabled", "configured", "missing_credentials"];
exports.BRAIN_META_SEND_ERROR_CODES = [
    "disabled",
    "missing_credentials",
    "invalid_payload",
    "blocked_by_policy",
    "meta_http_error",
    "meta_network_error"
];
exports.BRAIN_META_SEND_OUTCOME_STATUSES = [
    "disabled",
    "missing_credentials",
    "invalid_payload",
    "blocked_by_policy",
    "sent",
    "failed"
];
exports.BRAIN_OUTBOX_COMMAND_TYPES = ["whatsapp_text"];
exports.BRAIN_OUTBOX_WORKER_STATUSES = ["disabled", "planned", "locked", "sending", "sent", "noop", "blocked", "failed"];
exports.BRAIN_OUTBOX_WORKER_MODES = ["disabled", "dry_run", "lock_only", "send_locked", "noop", "blocked", "failed"];
exports.BRAIN_CANONICAL_OUTBOUND_PERSIST_STATUSES = [
    "skipped_by_flag",
    "skipped",
    "persisted",
    "existing",
    "warning"
];
var whatsapp_transport_1 = require("./whatsapp-transport");
Object.defineProperty(exports, "FakeWhatsAppHttpClient", { enumerable: true, get: function () { return whatsapp_transport_1.FakeWhatsAppHttpClient; } });
Object.defineProperty(exports, "WhatsAppMessageTransport", { enumerable: true, get: function () { return whatsapp_transport_1.WhatsAppMessageTransport; } });
Object.defineProperty(exports, "buildSafeWhatsAppRequestSummary", { enumerable: true, get: function () { return whatsapp_transport_1.buildSafeWhatsAppRequestSummary; } });
Object.defineProperty(exports, "buildWhatsAppRequestId", { enumerable: true, get: function () { return whatsapp_transport_1.buildWhatsAppRequestId; } });
Object.defineProperty(exports, "buildWhatsAppTextRequest", { enumerable: true, get: function () { return whatsapp_transport_1.buildWhatsAppTextRequest; } });
Object.defineProperty(exports, "classifyWhatsAppClientException", { enumerable: true, get: function () { return whatsapp_transport_1.classifyWhatsAppClientException; } });
Object.defineProperty(exports, "classifyWhatsAppResponse", { enumerable: true, get: function () { return whatsapp_transport_1.classifyWhatsAppResponse; } });
Object.defineProperty(exports, "extractSafeWhatsAppProviderError", { enumerable: true, get: function () { return whatsapp_transport_1.extractSafeWhatsAppProviderError; } });
Object.defineProperty(exports, "normalizeWhatsAppRecipient", { enumerable: true, get: function () { return whatsapp_transport_1.normalizeWhatsAppRecipient; } });
Object.defineProperty(exports, "sanitizeWhatsAppProviderError", { enumerable: true, get: function () { return whatsapp_transport_1.sanitizeWhatsAppProviderError; } });
Object.defineProperty(exports, "validateWhatsAppTransportInput", { enumerable: true, get: function () { return whatsapp_transport_1.validateWhatsAppTransportInput; } });
exports.BRAIN_CASE_UPDATE_STATUSES = [
    "skipped_by_flag",
    "skipped_no_case_id",
    "skipped_no_canonical_message",
    "updated",
    "warning"
];
