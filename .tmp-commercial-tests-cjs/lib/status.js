"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toneForStatus = toneForStatus;
exports.labelForModuleStatus = labelForModuleStatus;
function toneForStatus(status) {
    const normalized = String(status ?? "").toLowerCase();
    if (["closed", "done", "resolved", "success", "ok"].includes(normalized))
        return "green";
    if (["urgent", "high", "human_required", "requires_human", "failed", "error"].includes(normalized))
        return "red";
    if (["open", "pending", "waiting_human", "partial", "warning"].includes(normalized))
        return "amber";
    if (["active", "sent", "outbound", "manual"].includes(normalized))
        return "blue";
    return "gray";
}
function labelForModuleStatus(status) {
    const labels = {
        active: "Activo",
        partial: "Parcial",
        preview: "Preview",
        disabled: "Off"
    };
    return labels[status];
}
