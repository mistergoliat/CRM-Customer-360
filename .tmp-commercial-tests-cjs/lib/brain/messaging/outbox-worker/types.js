"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OUTBOX_MESSAGE_TERMINAL_STATUSES = exports.OUTBOX_MESSAGE_STATUSES = void 0;
exports.OUTBOX_MESSAGE_STATUSES = [
    "pending",
    "claimed",
    "processing",
    "retry_scheduled",
    "delivered",
    "failed",
    "dead_letter",
    "cancelled"
];
exports.OUTBOX_MESSAGE_TERMINAL_STATUSES = ["delivered", "dead_letter", "cancelled"];
