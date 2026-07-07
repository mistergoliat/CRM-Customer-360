import type { RequestFactStatus } from "./constants";

export type RequestFact = {
  factId: string;
  requestId: string;
  factKey: string;
  value: unknown;
  status: RequestFactStatus;
  sourceMessageId: string | null;
  sourceToolExecutionId: string | null;
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
  supersededAt: string | null;
};

export type UpsertRequestFactInput = {
  requestId: string;
  factKey: string;
  value: unknown;
  status?: Extract<RequestFactStatus, "inferred" | "confirmed" | "verified">;
  sourceMessageId?: string | null;
  sourceToolExecutionId?: string | null;
  confidence?: number | null;
};

export type UpsertRequestFactResult =
  | { ok: true; status: "created" | "versioned"; fact: RequestFact }
  | { ok: false; status: "conflict" | "error"; fact: null; warning: string };

export type ChangeRequestFactStatusResult =
  | { ok: true; status: "updated"; fact: RequestFact }
  | { ok: false; status: "not_found" | "conflict" | "error"; fact: RequestFact | null; warning: string };
