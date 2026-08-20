export type CustomerIntelligenceCopilotResponse =
  | {
      status: "answered";
      answer: string;
      analysis: {
        queryCount: number;
        queryPlanHashes: string[];
        resultRowCount: number;
        executionDurationMs: number;
        plannerModel: string | null;
        answerModel: string | null;
      };
      provenance: CustomerIntelligenceCopilotProvenance;
    }
  | {
      status: "clarification_required" | "unsupported_data" | "unsupported_operation" | "analytics_unavailable" | "analytics_timeout" | "answer_generation_failed";
      message: string;
    }
  | {
      status: "planner_invalid";
      errors: string[];
    };

export type CustomerIntelligenceCopilotProvenance = {
  featureSnapshot: { snapshotId: string; referenceTime: string; featureVersion: string; populationPolicyVersion: string };
  rfmSnapshot: { snapshotId: string; referenceTime: string; calculationVersion: string } | null;
  clusterSnapshot: { snapshotId: string; referenceTime: string; modelId: string; modelVersion: string } | null;
  population: {
    featurePopulation: number;
    rfmMatched: number;
    clusterMatched: number;
    bothMatched: number;
    neitherMatched: number;
    rfmCoveragePct: number;
    clusterCoveragePct: number;
  };
};

export const CUSTOMER_INTELLIGENCE_COPILOT_DEMO_QUESTIONS = [
  "Cuantos clientes hay?",
  "Cuantos clientes hay en cada cluster?",
  "Que cluster tiene mayor ticket promedio?",
  "Como se distribuyen los segmentos RFM por cluster?",
  "Cuantos AT_RISK_HIGH_VALUE hay en cada cluster?",
  "Compara los clusters por ticket promedio y cantidad de clientes.",
  "Analiza los clusters y dime que oportunidades comerciales observas.",
  "Cual es el mejor cluster?",
  "Cual es la mediana del ticket?",
  "Cuantos clientes abandonaron carrito ayer?"
] as const;
