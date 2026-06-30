import type { ConversationDetailReadModel, ConversationListInput, ConversationListReadModel } from "./types";

export interface ConversationRepository {
  list(input: ConversationListInput): Promise<ConversationListReadModel>;
  getById(id: string): Promise<ConversationDetailReadModel | null>;
}

export type { ConversationDetailReadModel, ConversationListInput, ConversationListReadModel };
