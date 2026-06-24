import type { DbRow } from "@/lib/db";
import type { ChatCaseContext, ChatListItem } from "@/lib/chats";
import type { TimelineEntry } from "@/lib/cases";

export type LegacyN8nConversationListRow = ChatListItem & {
  source: "n8n_legacy_tables";
};

export type LegacyN8nConversationDetailBundle = {
  listItem: ChatListItem | null;
  context: ChatCaseContext | null;
  messages: TimelineEntry[];
  caseRow: DbRow | null;
  warnings: string[];
};

export type LegacyN8nCaseBundle = {
  caseRow: DbRow | null;
  timeline: TimelineEntry[];
  timelineSource: string;
  warnings: string[];
};
