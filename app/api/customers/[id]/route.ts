import { requireOperator } from "@/lib/auth";
import { getCustomerById } from "@/lib/domains/customers";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: Context) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const result = await getCustomerById(id);
  if (!result) {
    return Response.json({ error: "customer_not_found" }, { status: 404 });
  }

  return Response.json(result);
}
