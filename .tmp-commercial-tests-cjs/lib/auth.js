"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSessionSecret = getSessionSecret;
exports.getAdminBypassToken = getAdminBypassToken;
exports.getAiOrchestrationApiToken = getAiOrchestrationApiToken;
exports.signSession = signSession;
exports.verifySession = verifySession;
exports.requireOperator = requireOperator;
exports.requireAiOrchestrationAccess = requireAiOrchestrationAccess;
exports.setSessionCookie = setSessionCookie;
const node_crypto_1 = __importDefault(require("node:crypto"));
const headers_1 = require("next/headers");
const server_1 = require("next/server");
const COOKIE_NAME = "hub_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
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
function getAiOrchestrationApiToken() {
    const token = process.env.AI_ORCHESTRATION_API_TOKEN?.trim();
    if (!token) {
        throw new Error("AI_ORCHESTRATION_API_TOKEN no configurado");
    }
    return token;
}
function timingSafeStringEquals(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length)
        return false;
    return node_crypto_1.default.timingSafeEqual(leftBuffer, rightBuffer);
}
function getBearerToken(request) {
    const authorization = request?.headers.get("authorization")?.trim();
    if (!authorization)
        return null;
    const [scheme, ...tokenParts] = authorization.split(/\s+/);
    if (scheme?.toLowerCase() !== "bearer")
        return null;
    const token = tokenParts.join(" ").trim();
    return token || null;
}
function verifyAiOrchestrationApiToken(request) {
    const providedToken = getBearerToken(request) || request?.headers.get("x-ai-orchestration-token")?.trim();
    if (!providedToken)
        return { ok: false, configured: Boolean(process.env.AI_ORCHESTRATION_API_TOKEN?.trim()) };
    const expectedToken = getAiOrchestrationApiToken();
    return {
        ok: timingSafeStringEquals(providedToken, expectedToken),
        configured: true
    };
}
function signSession(timestamp = Date.now()) {
    const payload = String(timestamp);
    const sig = node_crypto_1.default.createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
    return `${payload}.${sig}`;
}
function verifySession(value) {
    if (!value)
        return false;
    let secret;
    try {
        secret = getSessionSecret();
    }
    catch {
        return false;
    }
    const [timestamp, sig] = value.split(".");
    if (!timestamp || !sig)
        return false;
    const age = Date.now() - Number(timestamp);
    if (!Number.isFinite(age) || age < 0 || age > SESSION_TTL_MS)
        return false;
    const expected = node_crypto_1.default.createHmac("sha256", secret).update(timestamp).digest("hex");
    if (sig.length !== expected.length)
        return false;
    return node_crypto_1.default.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
async function requireOperator(request) {
    try {
        const adminBypassToken = getAdminBypassToken();
        getSessionSecret();
        const token = request?.headers.get("x-admin-bypass-token");
        if (token === adminBypassToken)
            return { ok: true };
        const cookieStore = await (0, headers_1.cookies)();
        const session = cookieStore.get(COOKIE_NAME)?.value;
        if (verifySession(session))
            return { ok: true };
    }
    catch (error) {
        return {
            ok: false,
            response: server_1.NextResponse.json({
                error: error instanceof Error ? error.message : "Auth configuration missing"
            }, { status: 500 })
        };
    }
    return { ok: false, response: server_1.NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
}
async function requireAiOrchestrationAccess(request) {
    try {
        const tokenAuth = verifyAiOrchestrationApiToken(request);
        if (tokenAuth.ok)
            return { ok: true };
    }
    catch (error) {
        return {
            ok: false,
            response: server_1.NextResponse.json({
                error: error instanceof Error ? error.message : "AI orchestration auth configuration missing"
            }, { status: 500 })
        };
    }
    return requireOperator(request);
}
function setSessionCookie(response) {
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
