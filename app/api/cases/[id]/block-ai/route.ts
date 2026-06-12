import { requireOperator } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { blockAi } from "@/lib/caseActions";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    return await blockAi(id);
  } catch (error) {
    await auditLog({ action: "api_error", entityType: "case", entityId: id, after: { error: error instanceof Error ? error.message : String(error) } });
    return Response.json({ error: "Error interno al bloquear IA" }, { status: 500 });
  }
}
