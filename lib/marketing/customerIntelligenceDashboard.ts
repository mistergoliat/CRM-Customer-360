import {
  CUSTOMER_INTELLIGENCE_COPILOT_UI_CONTEXT_VERSION,
  type AnalyticalFilterCondition,
  type AnalyticalFilterInput,
  type CustomerIntelligenceCopilotUiContext
} from "@/lib/marketing/customerIntelligenceCopilot";

export type DashboardContext = {
  readonly featureSnapshotId: string;
  readonly featureReferenceTime: string;
  readonly featureVersion: string;
  readonly populationPolicyVersion: string;
  readonly rfmSnapshotId: string | null;
  readonly rfmReferenceTime: string | null;
  readonly rfmCalculationVersion: string | null;
  readonly clusterSnapshotId: string | null;
  readonly clusterReferenceTime: string | null;
  readonly clusterModelVersion: string | null;
  readonly clusterInterpretationVersion: string | null;
};

export type DashboardPopulation = {
  readonly featurePopulation: number;
  readonly rfmMatched: number;
  readonly clusterMatched: number;
  readonly bothMatched: number;
  readonly neitherMatched: number;
  readonly rfmCoveragePct: number;
  readonly clusterCoveragePct: number;
};

export type DashboardContextResult =
  | { readonly status: "available"; readonly contractVersion: string; readonly context: DashboardContext; readonly population: DashboardPopulation }
  | { readonly status: "no_published_feature_snapshot" | "feature_snapshot_not_found" | "degraded"; readonly contractVersion: string; readonly reason?: string; readonly featureSnapshotId?: string };

export type DashboardOverviewResult =
  | {
      readonly status: "available";
      readonly contractVersion: string;
      readonly context: DashboardContext;
      readonly population: DashboardPopulation;
      readonly commercial: {
        readonly totalSpentTaxIncl: string;
        readonly totalValidOrders: number;
        readonly averageOrderValueTaxIncl: string | null;
        readonly averageValidOrders: string;
        readonly averageOrders365d: string;
        readonly averageDaysSinceLastOrder: string;
        readonly averagePurchaseFrequencyDays: string | null;
        readonly purchaseFrequencyDaysSampleSize: number;
      };
    }
  | { readonly status: "no_published_feature_snapshot" | "feature_snapshot_not_found" | "degraded"; readonly contractVersion: string; readonly reason?: string; readonly featureSnapshotId?: string };

export type DashboardRfmSegment = {
  readonly segmentCode: string | null;
  readonly businessLabel: string;
  readonly customerCount: number;
  readonly percentageOfRfmPopulation: number;
  readonly percentageOfFeaturePopulation: number;
  readonly averageRScore: string;
  readonly averageFScore: string;
  readonly averageMScore: string;
  readonly averageOrderValueTaxIncl: string | null;
  readonly averageTotalSpentTaxIncl: string;
  readonly averageValidOrders: string;
  readonly averageDaysSinceLastOrder: string;
};

export type DashboardRfmResult =
  | {
      readonly status: "available";
      readonly contractVersion: string;
      readonly context: DashboardContext;
      readonly analyzedPopulation: number;
      readonly fullFeaturePopulation: number;
      readonly coveragePct: number;
      readonly segments: readonly DashboardRfmSegment[];
    }
  | {
      readonly status: "no_published_feature_snapshot" | "feature_snapshot_not_found" | "no_compatible_rfm_snapshot" | "degraded";
      readonly contractVersion: string;
      readonly context?: DashboardContext;
      readonly reason?: string;
      readonly featureSnapshotId?: string;
    };

export type DashboardCluster = {
  readonly clusterId: number;
  readonly businessLabel: string | null;
  readonly interpretationVersion: string | null;
  readonly customerCount: number;
  readonly percentageOfClusterPopulation: number;
  readonly percentageOfFeaturePopulation: number;
  readonly averageOrderValueTaxIncl: string | null;
  readonly averageTotalSpentTaxIncl: string;
  readonly averageValidOrders: string;
  readonly averageOrders365d: string;
  readonly averageDaysSinceLastOrder: string;
  readonly averageEffectiveDiversity: string;
  readonly averageRepeatProductRate: string;
  readonly rfmCrossSection: {
    readonly comparablePopulation: number;
    readonly notInRfmPopulation: number;
    readonly coveragePct: number;
    readonly segments: readonly {
      readonly segmentCode: string | null;
      readonly businessLabel: string;
      readonly customerCount: number;
      readonly percentageOfComparablePopulation: number;
    }[];
  } | null;
};

export type DashboardClustersResult =
  | {
      readonly status: "available";
      readonly contractVersion: string;
      readonly context: DashboardContext;
      readonly analyzedPopulation: number;
      readonly fullFeaturePopulation: number;
      readonly coveragePct: number;
      readonly rfmCrossSectionAvailable: boolean;
      readonly clusters: readonly DashboardCluster[];
    }
  | {
      readonly status: "no_published_feature_snapshot" | "feature_snapshot_not_found" | "no_compatible_cluster_snapshot" | "degraded";
      readonly contractVersion: string;
      readonly context?: DashboardContext;
      readonly reason?: string;
      readonly featureSnapshotId?: string;
    };

export type DashboardIntersectionResult =
  | {
      readonly status: "available";
      readonly contractVersion: string;
      readonly context: DashboardContext;
      readonly intersection: {
        readonly matchingPopulation: number;
        readonly featurePopulation: number;
        readonly rfmMatchedPopulation: number;
        readonly clusterMatchedPopulation: number;
        readonly bothMatchedPopulation: number;
        readonly rfmCoveragePct: number;
        readonly clusterCoveragePct: number;
        readonly requiredDimensions: readonly ("rfm" | "cluster")[];
      };
      readonly metrics: {
        readonly totalSpentTaxIncl: string;
        readonly averageOrderValueTaxIncl: string | null;
        readonly averageTotalSpentTaxIncl: string | null;
        readonly averageValidOrders: string | null;
        readonly averageOrders365d: string | null;
        readonly averageDaysSinceLastOrder: string | null;
        readonly averagePurchaseFrequencyDays: string | null;
        readonly purchaseFrequencyDaysSampleSize: number;
        readonly averageEffectiveDiversity: string | null;
        readonly averageRepeatProductRate: string | null;
      };
      readonly analyticalDefinition: {
        readonly queryPlanHash: string;
        readonly filters: AnalyticalFilterInput | null;
      };
      readonly execution: {
        readonly queryCount: 1 | 2;
        readonly filterLeafCount: number;
        readonly filterDepth: number;
      };
    }
  | {
      readonly status:
        | "no_published_feature_snapshot"
        | "feature_snapshot_not_found"
        | "required_rfm_snapshot_unavailable"
        | "required_cluster_snapshot_unavailable"
        | "invalid_intersection"
        | "degraded";
      readonly contractVersion: string;
      readonly context?: DashboardContext;
      readonly errors?: readonly string[];
      readonly reason?: string;
      readonly featureSnapshotId?: string;
    };

export type CustomerIntelligenceFilterSelection = {
  readonly rfmSegmentCode: string | null;
  readonly clusterId: number | null;
  readonly commercial: {
    readonly daysSinceLastOrderGte: string;
    readonly daysSinceLastOrderLte: string;
    readonly totalSpentGte: string;
    readonly totalSpentLte: string;
    readonly averageOrderValueGte: string;
    readonly averageOrderValueLte: string;
    readonly validOrdersGte: string;
    readonly validOrdersLte: string;
  };
};

export const EMPTY_CUSTOMER_INTELLIGENCE_FILTER_SELECTION: CustomerIntelligenceFilterSelection = {
  rfmSegmentCode: null,
  clusterId: null,
  commercial: {
    daysSinceLastOrderGte: "",
    daysSinceLastOrderLte: "",
    totalSpentGte: "",
    totalSpentLte: "",
    averageOrderValueGte: "",
    averageOrderValueLte: "",
    validOrdersGte: "",
    validOrdersLte: ""
  }
};

export function buildCustomerIntelligenceFilterTree(selection: CustomerIntelligenceFilterSelection): AnalyticalFilterInput | null {
  const leaves: AnalyticalFilterCondition[] = [];
  const segmentCode = selection.rfmSegmentCode?.trim();
  if (segmentCode) leaves.push({ field: "rfm.segmentCode", operator: "eq", value: segmentCode });
  if (selection.clusterId !== null) leaves.push({ field: "cluster.clusterId", operator: "eq", value: selection.clusterId });
  appendNumberFilter(leaves, "commercial.daysSinceLastOrder", "gte", selection.commercial.daysSinceLastOrderGte);
  appendNumberFilter(leaves, "commercial.daysSinceLastOrder", "lte", selection.commercial.daysSinceLastOrderLte);
  appendNumberFilter(leaves, "commercial.totalSpentTaxIncl", "gte", selection.commercial.totalSpentGte);
  appendNumberFilter(leaves, "commercial.totalSpentTaxIncl", "lte", selection.commercial.totalSpentLte);
  appendNumberFilter(leaves, "commercial.averageOrderValueTaxIncl", "gte", selection.commercial.averageOrderValueGte);
  appendNumberFilter(leaves, "commercial.averageOrderValueTaxIncl", "lte", selection.commercial.averageOrderValueLte);
  appendNumberFilter(leaves, "commercial.validOrders", "gte", selection.commercial.validOrdersGte);
  appendNumberFilter(leaves, "commercial.validOrders", "lte", selection.commercial.validOrdersLte);
  return leaves.length === 0 ? null : { and: leaves };
}

export function buildCustomerIntelligenceCopilotUiContext(filters: AnalyticalFilterInput | null): CustomerIntelligenceCopilotUiContext | undefined {
  if (!filters) return undefined;
  return {
    intersection: {
      contractVersion: CUSTOMER_INTELLIGENCE_COPILOT_UI_CONTEXT_VERSION,
      filters
    }
  };
}

function appendNumberFilter(leaves: AnalyticalFilterCondition[], field: string, operator: "gte" | "lte", rawValue: string): void {
  const value = numberFromInput(rawValue);
  if (value === null) return;
  leaves.push({ field, operator, value });
}

function numberFromInput(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
