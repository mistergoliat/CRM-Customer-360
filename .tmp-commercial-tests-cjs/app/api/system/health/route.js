"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const auth_1 = require("@/lib/auth");
const system_1 = require("@/lib/system");
async function GET(request) {
    const auth = await (0, auth_1.requireOperator)(request);
    if (!auth.ok)
        return auth.response;
    const health = await (0, system_1.getSystemHealth)();
    return Response.json(health);
}
