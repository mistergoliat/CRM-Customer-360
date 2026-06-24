import { createDefaultConversationRepository } from "./repository";
import { buildConversationDetailReadModel, buildConversationListReadModel } from "./read-model";
import type { ConversationRepository } from "./contracts";
import type { ConversationListInput, ConversationListReadModel, ConversationDetailReadModel } from "./types";

export type ConversationServiceDependencies = {
  repository?: ConversationRepository;
};

export function createConversationService(dependencies: ConversationServiceDependencies = {}) {
  const repository = dependencies.repository ?? createDefaultConversationRepository();

  return {
    async list(input: ConversationListInput): Promise<ConversationListReadModel> {
      const result = await repository.list(input);
      return buildConversationListReadModel(result);
    },
    async getById(id: string): Promise<ConversationDetailReadModel | null> {
      const result = await repository.getById(id);
      return result ? buildConversationDetailReadModel(result) : null;
    }
  };
}

const defaultService = createConversationService();

export async function listConversations(input: ConversationListInput): Promise<ConversationListReadModel> {
  return defaultService.list(input);
}

export async function getConversationById(id: string): Promise<ConversationDetailReadModel | null> {
  return defaultService.getById(id);
}
