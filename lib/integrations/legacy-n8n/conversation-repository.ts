import { getCaseById } from "@/lib/cases";
import { getChatContext, getChatMessages, listChats } from "@/lib/chats";
import type { ChatCaseContext, ChatListItem } from "@/lib/chats";
import type { TimelineEntry } from "@/lib/cases";
import { mapLegacyConversationBundle, mapLegacyConversationListRow } from "./mappers";
import type { LegacyN8nConversationDetailBundle, LegacyN8nConversationListRow } from "./types";

export type LegacyConversationRepository = {
  list(input: { page?: number; q?: string }): Promise<{ items: LegacyN8nConversationListRow[]; total: number; page: number; pageSize: number; warnings: string[] }>;
  getById(id: string): Promise<LegacyN8nConversationDetailBundle | null>;
  getContext(id: string): Promise<ChatCaseContext | null>;
  getMessages(id: string): Promise<TimelineEntry[]>;
};

export function createLegacyN8nConversationRepository(): LegacyConversationRepository {
  return {
    async list(input) {
      const result = await listChats({ page: input.page, q: input.q });
      if (result.error) {
        throw new Error(result.error);
      }
      return {
        items: result.rows.map(mapLegacyConversationListRow),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        warnings: []
      };
    },
    async getById(id: string) {
      const [contextResult, messagesResult, caseResult, listResult] = await Promise.all([
        getChatContext(id),
        getChatMessages(id),
        getCaseById(id),
        listChats({ page: 1, q: id })
      ]);

      if (!contextResult.ok || !messagesResult.ok) {
        return null;
      }

      const listItem = listResult.rows.find((row: ChatListItem) => String(row.conversation_case_id) === String(id)) ?? null;
      return mapLegacyConversationBundle({
        listItem,
        context: contextResult.row,
        messages: messagesResult.rows,
        caseRow: caseResult.ok ? caseResult.row : null,
        warnings: []
      });
    },
    async getContext(id: string) {
      const result = await getChatContext(id);
      return result.ok ? result.row : null;
    },
    async getMessages(id: string) {
      const result = await getChatMessages(id);
      return result.ok ? result.rows : [];
    }
  };
}
