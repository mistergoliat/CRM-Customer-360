import { requireOperator } from "@/lib/auth";
import { createCustomer360QueryService, type Customer360QueryService } from "@/lib/domains/customer-360";

type Context = {
  params: Promise<{ id: string }>;
};

type Customer360RouteDependencies = {
  service?: Customer360QueryService;
  requireOperator?: typeof requireOperator;
};

export function createCustomer360GetHandler(dependencies: Customer360RouteDependencies = {}) {
  const service = dependencies.service ?? createCustomer360QueryService();
  const requireOperatorFn = dependencies.requireOperator ?? requireOperator;

  return async function GET(request: Request, context: Context) {
    const auth = await requireOperatorFn(request);
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const snapshot = await service.getByCustomerId(id);
    if (!snapshot) {
      return Response.json({ error: "customer_not_found" }, { status: 404 });
    }

    return Response.json(snapshot);
  };
}

export const GET = createCustomer360GetHandler();

