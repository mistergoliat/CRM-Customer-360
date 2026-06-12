export function errorResponse(code: string, message: string, status = 400, extra?: Record<string, unknown>) {
  return Response.json(
    {
      code,
      message,
      ...extra
    },
    { status }
  );
}
