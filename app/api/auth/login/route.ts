import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";

  if (!process.env.ADMIN_BYPASS_TOKEN) {
    return NextResponse.json({ error: "ADMIN_BYPASS_TOKEN no configurado" }, { status: 500 });
  }

  if (token !== process.env.ADMIN_BYPASS_TOKEN) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  return setSessionCookie(NextResponse.json({ ok: true }));
}
