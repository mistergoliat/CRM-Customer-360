import { NextResponse } from "next/server";
import { getAdminBypassToken, getSessionSecret, setSessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";

  let adminBypassToken: string;
  try {
    adminBypassToken = getAdminBypassToken();
    getSessionSecret();
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Auth configuration missing"
      },
      { status: 500 }
    );
  }

  if (token !== adminBypassToken) {
    return NextResponse.json({ error: "Token invalido" }, { status: 401 });
  }

  return setSessionCookie(NextResponse.json({ ok: true }));
}
