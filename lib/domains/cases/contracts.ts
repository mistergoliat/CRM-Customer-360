import type { CaseDetailReadModel, CaseListInput, CaseListReadModel, CaseTimelineReadModel } from "./types";

export interface CaseRepository {
  list(filters: CaseListInput): Promise<CaseListReadModel>;
  getById(id: string): Promise<CaseDetailReadModel | null>;
  getTimeline(id: string): Promise<CaseTimelineReadModel>;
}

export type { CaseDetailReadModel, CaseListInput, CaseListReadModel, CaseTimelineReadModel };
