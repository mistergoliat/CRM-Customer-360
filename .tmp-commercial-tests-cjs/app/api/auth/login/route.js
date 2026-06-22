"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
async function POST(request) {
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token : "";
    let adminBypassToken;
    try {
        adminBypassToken = (0, auth_1.getAdminBypassToken)();
        (0, auth_1.getSessionSecret)();
    }
    catch (error) {
        return server_1.NextResponse.json({
            error: error instanceof Error ? error.message : "Auth configuration missing"
        }, { status: 500 });
    }
    if (token !== adminBypassToken) {
        return server_1.NextResponse.json({ error: "Token invalido" }, { status: 401 });
    }
    return (0, auth_1.setSessionCookie)(server_1.NextResponse.json({ ok: true }));
}
