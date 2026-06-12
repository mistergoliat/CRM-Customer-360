import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "hub_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("SESSION_SECRET no configurado");
  }

  return secret;
}

function getAdminBypassToken() {
  const token = process.env.ADMIN_BYPASS_TOKEN?.trim();
  if (!token) {
    throw new Error("ADMIN_BYPASS_TOKEN no configurado");
  }

  return token;
}

async function hmac(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toHex(signature);
}

async function verifySession(value: string | undefined, secret: string) {
  if (!value) return false;
  const [timestamp, sig] = value.split(".");
  if (!timestamp || !sig) return false;
  const age = Date.now() - Number(timestamp);
  if (!Number.isFinite(age) || age < 0 || age > SESSION_TTL_MS) return false;
  return (await hmac(timestamp, secret)) === sig;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/login" ||
    pathname === "/api/auth/login"
  ) {
    return NextResponse.next();
  }

  let sessionSecret: string;
  let adminBypassToken: string;
  try {
    sessionSecret = getSessionSecret();
    adminBypassToken = getAdminBypassToken();
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Auth configuration missing"
      },
      { status: 500 }
    );
  }

  const session = request.cookies.get(COOKIE_NAME)?.value;
  const headerToken = request.headers.get("x-admin-bypass-token");
  const headerOk = headerToken === adminBypassToken;

  if (headerOk || (await verifySession(session, sessionSecret))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!.*\\.).*)"]
};
