"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CUSTOMER_LIFECYCLE_STAGES = exports.CUSTOMER_IDENTITY_RESOLUTION_STATUSES = exports.CUSTOMER_IDENTITY_CONFIDENCE_LEVELS = exports.CUSTOMER_IDENTITY_SOURCES = exports.CUSTOMER_IDENTITY_TYPES = void 0;
exports.CUSTOMER_IDENTITY_TYPES = [
    "email",
    "wa_id",
    "phone",
    "prestashop_customer_id",
    "order_id",
    "invoice_number",
    "rut",
    "appsheet_customer_id",
];
exports.CUSTOMER_IDENTITY_SOURCES = [
    "brain",
    "whatsapp",
    "n8n",
    "prestashop",
    "mariadb",
    "appsheet",
    "hub_operator",
    "import",
    "unknown",
];
exports.CUSTOMER_IDENTITY_CONFIDENCE_LEVELS = ["high", "medium", "low"];
exports.CUSTOMER_IDENTITY_RESOLUTION_STATUSES = [
    "resolved_existing",
    "created_provisional",
    "linked_identity",
    "conflict_needs_review",
    "not_enough_identity",
    "skipped_read_only",
];
exports.CUSTOMER_LIFECYCLE_STAGES = [
    "provisional",
    "lead",
    "customer",
    "repeat_customer",
    "inactive",
    "blocked",
    "unknown",
];
