"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CUSTOMER_LIFECYCLE_STAGES = exports.CUSTOMER_IDENTITY_RESOLUTION_STATUSES = exports.CUSTOMER_IDENTITY_CONFIDENCE_LEVELS = exports.CUSTOMER_IDENTITY_SOURCES = exports.CUSTOMER_IDENTITY_TYPES = exports.CUSTOMER_DEFAULT_IDENTITY_CONFIDENCE = exports.CUSTOMER_DEFAULT_IDENTITY_SOURCE = exports.CUSTOMER_DEFAULT_RESOLUTION_STATUS = exports.CUSTOMER_DEFAULT_READ_ONLY_OPTIONS = exports.CUSTOMER_NO_MERGE_REASONS = exports.CUSTOMER_PROVISIONAL_IDENTITY_TYPES = exports.CUSTOMER_STRONG_IDENTITY_TYPES = exports.CUSTOMER_IDENTITY_PRECEDENCE = void 0;
const types_1 = require("./types");
Object.defineProperty(exports, "CUSTOMER_IDENTITY_CONFIDENCE_LEVELS", { enumerable: true, get: function () { return types_1.CUSTOMER_IDENTITY_CONFIDENCE_LEVELS; } });
Object.defineProperty(exports, "CUSTOMER_IDENTITY_RESOLUTION_STATUSES", { enumerable: true, get: function () { return types_1.CUSTOMER_IDENTITY_RESOLUTION_STATUSES; } });
Object.defineProperty(exports, "CUSTOMER_IDENTITY_SOURCES", { enumerable: true, get: function () { return types_1.CUSTOMER_IDENTITY_SOURCES; } });
Object.defineProperty(exports, "CUSTOMER_IDENTITY_TYPES", { enumerable: true, get: function () { return types_1.CUSTOMER_IDENTITY_TYPES; } });
Object.defineProperty(exports, "CUSTOMER_LIFECYCLE_STAGES", { enumerable: true, get: function () { return types_1.CUSTOMER_LIFECYCLE_STAGES; } });
exports.CUSTOMER_IDENTITY_PRECEDENCE = [
    "prestashop_customer_id",
    "email",
    "order_id",
    "invoice_number",
    "phone",
    "wa_id",
];
exports.CUSTOMER_STRONG_IDENTITY_TYPES = [
    "prestashop_customer_id",
    "email",
    "order_id",
    "invoice_number",
];
exports.CUSTOMER_PROVISIONAL_IDENTITY_TYPES = [
    "wa_id",
    "phone",
    "rut",
    "appsheet_customer_id",
];
exports.CUSTOMER_NO_MERGE_REASONS = [
    "emails_distinct_strong",
    "prestashop_customer_id_distinct",
    "phone_or_wa_id_ambiguous",
    "invoice_or_order_assigned_elsewhere",
];
exports.CUSTOMER_DEFAULT_READ_ONLY_OPTIONS = {
    readOnly: true,
    allowProvisional: true,
    debug: false,
};
exports.CUSTOMER_DEFAULT_RESOLUTION_STATUS = types_1.CUSTOMER_IDENTITY_RESOLUTION_STATUSES[4];
exports.CUSTOMER_DEFAULT_IDENTITY_SOURCE = "unknown";
exports.CUSTOMER_DEFAULT_IDENTITY_CONFIDENCE = "medium";
