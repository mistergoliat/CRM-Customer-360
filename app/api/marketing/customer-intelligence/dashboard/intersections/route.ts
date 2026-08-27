import { getDashboardIntersection } from "@/lib/customer-intelligence/dashboardClient";
import { readDashboardIntersectionBody, proxyError } from "../proxy";
import type { AnalyticalFilterInput } from "@/lib/marketing/customerIntelligenceCopilot";

export async function POST(request: Request) {
  const parsed = await readDashboardIntersectionBody(request);
  if (!parsed.ok) return parsed.response;

  try {
    const upstream = await getDashboardIntersection({
      contractVersion: typeof parsed.body.contractVersion === "string" ? parsed.body.contractVersion : undefined,
      featureSnapshotId: typeof parsed.body.featureSnapshotId === "string" ? parsed.body.featureSnapshotId : undefined,
      filters: parsed.body.filters as AnalyticalFilterInput | undefined
    });
    return Response.json(upstream.body, { status: upstream.status });
  } catch (error) {
    return proxyError(error);
  }
}
