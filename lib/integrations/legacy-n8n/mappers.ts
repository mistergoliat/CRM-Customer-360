import type { ChatCaseContext, ChatListItem } from "@/lib/chats";
import type { TimelineEntry } from "@/lib/cases";
import type { DbRow } from "@/lib/db";
import type { LegacyN8nConversationDetailBundle, LegacyN8nConversationListRow, LegacyN8nCaseBundle } from "./types";

export function mapLegacyConversationListRow(row: ChatListItem): LegacyN8nConversationListRow {
  return {
    ...row,
    source: "n8n_legacy_tables"
  };
}

export function mapLegacyConversationBundle(input: {
  listItem: ChatListItem | null;
  context: ChatCaseContext | null;
  messages: TimelineEntry[];
  caseRow: DbRow | null;
  warnings?: string[];
}): LegacyN8nConversationDetailBundle {
  return {
    listItem: input.listItem,
    context: input.context,
    messages: input.messages,
    caseRow: input.caseRow,
    warnings: input.warnings ?? []
  };
}

export function mapLegacyCaseBundle(input: {
  caseRow: DbRow | null;
  timeline: TimelineEntry[];
  timelineSource: string;
  warnings?: string[];
}): LegacyN8nCaseBundle {
  return {
    caseRow: input.caseRow,
    timeline: input.timeline,
    timelineSource: input.timelineSource,
    warnings: input.warnings ?? []
  };
}
