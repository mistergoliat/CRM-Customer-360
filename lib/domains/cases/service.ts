import { createDefaultCaseRepository } from "./repository";
import { buildCaseDetailReadModel, buildCaseListReadModel, buildCaseTimelineReadModel } from "./read-model";
import type { CaseRepository } from "./contracts";
import type { CaseListInput, CaseListReadModel, CaseDetailReadModel, CaseTimelineReadModel } from "./types";

export type CaseServiceDependencies = {
  repository?: CaseRepository;
};

export function createCaseService(dependencies: CaseServiceDependencies = {}) {
  const repository = dependencies.repository ?? createDefaultCaseRepository();

  return {
    async list(input: CaseListInput): Promise<CaseListReadModel> {
      const result = await repository.list(input);
      return buildCaseListReadModel(result);
    },
    async getById(id: string): Promise<CaseDetailReadModel | null> {
      const result = await repository.getById(id);
      return result ? buildCaseDetailReadModel(result) : null;
    },
    async getTimeline(id: string): Promise<CaseTimelineReadModel> {
      return buildCaseTimelineReadModel(await repository.getTimeline(id));
    }
  };
}

const defaultService = createCaseService();

export async function listCases(input: CaseListInput): Promise<CaseListReadModel> {
  return defaultService.list(input);
}

export async function getCaseById(id: string): Promise<CaseDetailReadModel | null> {
  return defaultService.getById(id);
}

export async function getCaseTimeline(id: string): Promise<CaseTimelineReadModel> {
  return defaultService.getTimeline(id);
}
