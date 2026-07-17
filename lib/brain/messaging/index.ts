export * from "./types";
export * from "./outbox";
export * from "./dedupe";
export * from "./outboxTransitions";
// ACS-R1-05-T05: `./outbox-worker` (hyphenated) is a self-contained, in-memory
// simulator consumed only by lib/brain/commercial/autonomous-loop (dev-only,
// see docs/audits/follow-up-runtime-reconciliation.md P2-5). It is not
// re-exported here so it cannot be mistaken for part of the productive
// messaging API; production code writes/sends via canonicalOutboxWriter.ts,
// autonomousOutboxTick.ts and outboxWorker.ts, none of which import it.
export * from "./whatsapp-transport";
