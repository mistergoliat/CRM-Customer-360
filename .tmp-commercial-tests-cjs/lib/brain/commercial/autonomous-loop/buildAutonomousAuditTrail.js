"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAutonomousAuditTrail = buildAutonomousAuditTrail;
const constants_1 = require("./constants");
function buildAutonomousAuditTrail(input) {
    return input.descriptors.map((descriptor) => {
        const metadata = {
            ...(descriptor.metadata ?? {}),
            stage: descriptor.stage
        };
        return {
            eventId: (0, constants_1.buildAutonomousAuditEventId)({
                runId: input.runId,
                stage: descriptor.stage,
                eventType: descriptor.eventType,
                entityId: descriptor.entityId,
                status: descriptor.status,
                createdAt: input.createdAt
            }),
            runId: input.runId,
            stage: descriptor.stage,
            eventType: descriptor.eventType,
            entityType: descriptor.entityType,
            entityId: descriptor.entityId,
            status: descriptor.status,
            reason: descriptor.reason,
            metadata: sanitizeMetadata(metadata),
            createdAt: input.createdAt
        };
    });
}
function sanitizeMetadata(metadata) {
    const output = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (value === null || value === undefined)
            continue;
        if (key.toLowerCase().includes("phone") || key.toLowerCase().includes("token") || key.toLowerCase().includes("authorization")) {
            continue;
        }
        if (typeof value === "string") {
            const sanitized = (0, constants_1.sanitizeAutonomousLoopText)(value, 240);
            if (sanitized !== null)
                output[key] = sanitized;
            continue;
        }
        if (key === "waId") {
            output[key] = (0, constants_1.maskAutonomousLoopWaId)(typeof value === "string" ? value : String(value));
            continue;
        }
        output[key] = value;
    }
    return output;
}
