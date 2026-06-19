import React from "react";
import { StatusChip } from "@/components/ui/StatusChip";

function toneForLabel(label: string) {
  const text = label.toLowerCase();
  if (text.includes("error") || text.includes("blocked") || text.includes("cancel")) return "red" as const;
  if (text.includes("invalid") || text.includes("expired")) return "red" as const;
  if (text.includes("preview") || text.includes("review") || text.includes("scheduled") || text.includes("unavailable")) return "amber" as const;
  if (text.includes("eligible") || text.includes("available") || text.includes("proposed") || text.includes("persisted")) return "green" as const;
  if (text.includes("disabled")) return "gray" as const;
  if (text.includes("mixed") || text.includes("origin")) return "blue" as const;
  return "gray" as const;
}

export function ActionQueueStatusBadge({ label }: { label: string }) {
  void React;
  return <StatusChip label={label} tone={toneForLabel(label)} />;
}
