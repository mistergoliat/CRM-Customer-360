"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActionQueueStatusBadge = ActionQueueStatusBadge;
const react_1 = __importDefault(require("react"));
const StatusChip_1 = require("@/components/ui/StatusChip");
function toneForLabel(label) {
    const text = label.toLowerCase();
    if (text.includes("error") || text.includes("blocked") || text.includes("cancel"))
        return "red";
    if (text.includes("invalid") || text.includes("expired"))
        return "red";
    if (text.includes("preview") || text.includes("review") || text.includes("scheduled") || text.includes("unavailable"))
        return "amber";
    if (text.includes("eligible") || text.includes("available") || text.includes("proposed") || text.includes("persisted"))
        return "green";
    if (text.includes("disabled"))
        return "gray";
    if (text.includes("mixed") || text.includes("origin"))
        return "blue";
    return "gray";
}
function ActionQueueStatusBadge({ label }) {
    void react_1.default;
    return <StatusChip_1.StatusChip label={label} tone={toneForLabel(label)}/>;
}
