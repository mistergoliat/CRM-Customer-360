import { requireOperator } from "@/lib/auth";
import { getCatalogConsoleProductContext, statusForCatalogConsoleError } from "@/lib/catalog/consoleService";

export async function GET(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { productId: rawProductId } = await params;
  const productId = decodeURIComponent(rawProductId ?? "").trim();
  const result = await getCatalogConsoleProductContext(productId);

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: statusForCatalogConsoleError(result.error) });
  }

  return Response.json(result);
}
