import { requireOperator } from "@/lib/auth";
import { searchCatalogConsoleProducts, statusForCatalogConsoleError } from "@/lib/catalog/consoleService";

export async function GET(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit === null ? undefined : Number.parseInt(rawLimit, 10);

  const result = await searchCatalogConsoleProducts(query, limit);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: statusForCatalogConsoleError(result.error) });
  }

  return Response.json(result);
}
