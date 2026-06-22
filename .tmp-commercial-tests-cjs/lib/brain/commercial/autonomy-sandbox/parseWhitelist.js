"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAutonomousTestWaIds = parseAutonomousTestWaIds;
function parseAutonomousTestWaIds(raw) {
    if (typeof raw !== "string")
        return [];
    const output = [];
    const seen = new Set();
    for (const token of raw.split(",")) {
        const trimmed = token.trim();
        if (!trimmed)
            continue;
        const cleaned = trimmed.replace(/[\s()+-]+/g, "").replace(/^\+/, "");
        if (!/^\d+$/.test(cleaned))
            continue;
        if (cleaned.length === 0)
            continue;
        if (seen.has(cleaned))
            continue;
        seen.add(cleaned);
        output.push(cleaned);
    }
    return output;
}
