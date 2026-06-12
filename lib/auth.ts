import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE_NAME = "hub_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

function secret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_BYPASS_TOKEN || "dev-only-change-me";
}

export function signSession(timestamp = Date.now()) {
  const payload = String(timestamp);
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifySession(value?: string | null) {
  if (!value) return false;
  const [timestamp, sig] = value.split(".");
  if (!timestamp || !sig) return false;
  const age = Date.now() - Number(timestamp);
  if (!Number.isFinite(age) || age < 0 || age > SESSION_TTL_MS) return false;
  const expected = crypto.createHmac("sha256", secret()).update(timestamp).digest("hex");
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export async function requireOperator(request?: Request) {
  const token = request?.headers.get("x-admin-bypass-token");
  if (process.env.ADMIN_BYPASS_TOKEN && token === process.env.ADMIN_BYPASS_TOKEN) return { ok: true as const };

  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME)?.value;
  if (verifySession(session)) return { ok: true as const };

  return { ok: false as const, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
}

export function setSessionCookie(response: NextResponse) {
  const appBaseUrl = process.env.APP_BASE_URL || "";
  const useSecureCookie = process.env.NODE_ENV === "production" && appBaseUrl.startsWith("https://");

  response.cookies.set(COOKIE_NAME, signSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookie,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000
  });
  return response;
}
