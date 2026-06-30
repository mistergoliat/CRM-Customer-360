import { requireOperator } from "@/lib/auth";
import { dbWriteDisabledResponse, isDbWriteEnabled } from "@/lib/write-access";
import { listCustomers, createCustomer } from "@/lib/domains/customers";
import { validateCreateCustomerPayload } from "@/lib/domains/customers/validation";

export async function GET(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const page = Number(searchParams.get("page") || 1);
  const pageSize = Number(searchParams.get("page_size") || 25);

  return Response.json(await listCustomers({ search, page, pageSize }));
}

export async function POST(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  if (!isDbWriteEnabled()) {
    return dbWriteDisabledResponse(409);
  }

  const payload = await request.json().catch(() => null);
  const validation = validateCreateCustomerPayload(payload);
  if (!validation.ok) {
    return Response.json({ error: validation.failure.error }, { status: validation.failure.status });
  }

  try {
    const created = await createCustomer({
      firstname: validation.data.firstname,
      lastname: validation.data.lastname,
      email: validation.data.email,
      platformOrigin: validation.data.platformOrigin,
      idempotencyKey: request.headers.get("Idempotency-Key")
    });
    return Response.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("duplicate") ? 409 : 500;
    return Response.json({ error: message }, { status });
  }
}
