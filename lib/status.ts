import type { ModuleStatus } from "./modules";

export type ChipTone = "red" | "green" | "amber" | "blue" | "gray" | "slate";

export function toneForStatus(status?: unknown): ChipTone {
  const normalized = String(status ?? "").toLowerCase();
  if (["closed", "done", "resolved", "success", "ok"].includes(normalized)) return "green";
  if (["urgent", "high", "human_required", "requires_human", "failed", "error"].includes(normalized)) return "red";
  if (["open", "pending", "waiting_human", "partial", "warning"].includes(normalized)) return "amber";
  if (["active", "sent", "outbound", "manual"].includes(normalized)) return "blue";
  return "gray";
}

export function labelForModuleStatus(status: ModuleStatus) {
  const labels: Record<ModuleStatus, string> = {
    active: "Activo",
    partial: "Parcial",
    preview: "Preview",
    disabled: "Off"
  };
  return labels[status];
}

export function stateForTone(tone?: ChipTone) {
  if (tone === "green") return "ok" as const;
  if (tone === "red") return "error" as const;
  if (tone === "amber") return "warning" as const;
  return "muted" as const;
}
