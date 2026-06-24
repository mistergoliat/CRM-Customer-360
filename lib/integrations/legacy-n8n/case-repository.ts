import { getCaseById, getCaseTimeline, listCases, type CaseFilters } from "@/lib/cases";
import { mapLegacyCaseBundle } from "./mappers";
import type { LegacyN8nCaseBundle } from "./types";

export type LegacyCaseRepository = {
  list(filters: CaseFilters): Promise<{ rows: unknown[]; total: number; page: number; pageSize: number; error?: string }>;
  getById(id: string): Promise<LegacyN8nCaseBundle | null>;
  getTimeline(id: string): Promise<LegacyN8nCaseBundle>;
};

export function createLegacyN8nCaseRepository(): LegacyCaseRepository {
  return {
    async list(filters: CaseFilters) {
      return listCases(filters);
    },
    async getById(id: string) {
      const result = await getCaseById(id);
      if (!result.ok || !result.row) return null;
      const timeline = await getCaseTimeline(result.row);
      return mapLegacyCaseBundle({
        caseRow: result.row,
        timeline: timeline.ok ? timeline.rows : [],
        timelineSource: timeline.ok ? timeline.source : "error",
        warnings: timeline.ok ? [] : [timeline.error]
      });
    },
    async getTimeline(id: string) {
      const result = await getCaseById(id);
      if (!result.ok || !result.row) {
        return mapLegacyCaseBundle({ caseRow: null, timeline: [], timelineSource: "missing", warnings: [result.error ?? "not_found"] });
      }
      const timeline = await getCaseTimeline(result.row);
      return mapLegacyCaseBundle({
        caseRow: result.row,
        timeline: timeline.ok ? timeline.rows : [],
        timelineSource: timeline.ok ? timeline.source : "error",
        warnings: timeline.ok ? [] : [timeline.error]
      });
    }
  };
}
