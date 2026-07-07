import { StatusChip } from "@/components/ui/StatusChip";
import { CONTROL_MODE_PRESENTATION } from "./presentation";
import type { AiControlMode as AiControlModeValue } from "@/lib/domains/conversations/thread";

export function AiControlMode({ mode }: { mode: AiControlModeValue }) {
  const presentation = CONTROL_MODE_PRESENTATION[mode];
  return <StatusChip label={`Control: ${presentation.label}`} tone={presentation.tone} />;
}
