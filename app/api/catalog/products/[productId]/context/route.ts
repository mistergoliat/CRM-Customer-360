import { requireOperator } from "@/lib/auth";
import { getCatalogConsoleProductContextWithLimit, normalizeCatalogRecommendationLimit, statusForCatalogConsoleError } from "@/lib/catalog/consoleService";

export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { productId: rawProductId } = await params;
  const productId = decodeURIComponent(rawProductId ?? "").trim();
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const parsedLimit = rawLimit === null ? undefined : Number(rawLimit);
  const normalizedLimit = normalizeCatalogRecommendationLimit(parsedLimit);
  if (!normalizedLimit.ok) {
    return Response.json({ error: normalizedLimit.error }, { status: statusForCatalogConsoleError(normalizedLimit.error) });
  }

  const result = await getCatalogConsoleProductContextWithLimit(productId, normalizedLimit.value);

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: statusForCatalogConsoleError(result.error) });
  }

  return Response.json(result);
}
