import { buildAutonomousAuditEventId, maskAutonomousLoopWaId, sanitizeAutonomousLoopText } from "./constants";
import type { AutonomousLoopAuditEvent, AutonomousLoopStage } from "./types";

export type AutonomousAuditTrailDescriptor = {
  stage: AutonomousLoopStage;
  eventType: string;
  entityType: AutonomousLoopAuditEvent["entityType"];
  entityId: string | null;
  status: string;
  reason: string | null;
  metadata?: Record<string, unknown>;
};

export function buildAutonomousAuditTrail(input: {
  runId: string;
  createdAt: string;
  descriptors: AutonomousAuditTrailDescriptor[];
}): AutonomousLoopAuditEvent[] {
  return input.descriptors.map((descriptor) => {
    const metadata = {
      ...(descriptor.metadata ?? {}),
      stage: descriptor.stage
    };

    return {
      eventId: buildAutonomousAuditEventId({
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

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined) continue;
    if (key.toLowerCase().includes("phone") || key.toLowerCase().includes("token") || key.toLowerCase().includes("authorization")) {
      continue;
    }
    if (typeof value === "string") {
      const sanitized = sanitizeAutonomousLoopText(value, 240);
      if (sanitized !== null) output[key] = sanitized;
      continue;
    }
    if (key === "waId") {
      output[key] = maskAutonomousLoopWaId(typeof value === "string" ? value : String(value));
      continue;
    }
    output[key] = value;
  }

  return output;
}
