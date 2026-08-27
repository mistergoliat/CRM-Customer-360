import { callCustomerProfileJson, type JsonUpstreamResult } from "@/lib/customer-intelligence/copilotClient";
import type { AnalyticalFilterInput } from "@/lib/marketing/customerIntelligenceCopilot";
import type {
  DashboardClustersResult,
  DashboardContextResult,
  DashboardIntersectionResult,
  DashboardOverviewResult,
  DashboardRfmResult
} from "@/lib/marketing/customerIntelligenceDashboard";

export async function getDashboardContext(input: { readonly featureSnapshotId?: string } = {}): Promise<JsonUpstreamResult<DashboardContextResult>> {
  return callCustomerProfileJson<DashboardContextResult>(dashboardPath("context", input.featureSnapshotId), { method: "GET" });
}

export async function getDashboardOverview(input: { readonly featureSnapshotId?: string } = {}): Promise<JsonUpstreamResult<DashboardOverviewResult>> {
  return callCustomerProfileJson<DashboardOverviewResult>(dashboardPath("overview", input.featureSnapshotId), { method: "GET" });
}

export async function getDashboardRfm(input: { readonly featureSnapshotId?: string } = {}): Promise<JsonUpstreamResult<DashboardRfmResult>> {
  return callCustomerProfileJson<DashboardRfmResult>(dashboardPath("rfm", input.featureSnapshotId), { method: "GET" });
}

export async function getDashboardClusters(input: { readonly featureSnapshotId?: string } = {}): Promise<JsonUpstreamResult<DashboardClustersResult>> {
  return callCustomerProfileJson<DashboardClustersResult>(dashboardPath("clusters", input.featureSnapshotId), { method: "GET" });
}

export async function getDashboardIntersection(input: {
  readonly featureSnapshotId?: string;
  readonly filters?: AnalyticalFilterInput;
  readonly contractVersion?: string;
}): Promise<JsonUpstreamResult<DashboardIntersectionResult>> {
  return callCustomerProfileJson<DashboardIntersectionResult>("/v1/customer-intelligence/dashboard/intersections", {
    method: "POST",
    body: {
      ...(input.contractVersion ? { contractVersion: input.contractVersion } : {}),
      ...(input.featureSnapshotId ? { featureSnapshotId: input.featureSnapshotId } : {}),
      ...(input.filters ? { filters: input.filters } : {})
    }
  });
}

function dashboardPath(resource: "context" | "overview" | "rfm" | "clusters", featureSnapshotId?: string): string {
  const base = `/v1/customer-intelligence/dashboard/${resource}`;
  return featureSnapshotId ? `${base}?featureSnapshotId=${encodeURIComponent(featureSnapshotId)}` : base;
}
