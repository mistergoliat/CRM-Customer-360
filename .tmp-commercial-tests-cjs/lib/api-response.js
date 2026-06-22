"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorResponse = errorResponse;
function errorResponse(code, message, status = 400, extra) {
    return Response.json({
        code,
        message,
        ...extra
    }, { status });
}
