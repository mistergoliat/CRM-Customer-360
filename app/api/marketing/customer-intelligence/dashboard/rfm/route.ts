import { getDashboardRfm } from "@/lib/customer-intelligence/dashboardClient";
import { parseFeatureSnapshotId, proxyError } from "../proxy";

export async function GET(request: Request) {
  const parsed = parseFeatureSnapshotId(request);
  if (!parsed.ok) return parsed.response;

  try {
    const upstream = await getDashboardRfm({ featureSnapshotId: parsed.featureSnapshotId });
    return Response.json(upstream.body, { status: upstream.status });
  } catch (error) {
    return proxyError(error);
  }
}
