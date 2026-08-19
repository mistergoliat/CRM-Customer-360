import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { queryRows, sanitizeDbError, withConnection } from "@/lib/db";
import type { CommercialTrigger } from "./types";

export type CommercialTriggerSequenceRecord = {
  conversationId: number;
  triggerDedupeKey: string;
  triggerType: CommercialTrigger["type"];
  sourceMessageId: number | null;
  commercialSequence: number;
};

export type AssignCommercialTriggerSequenceInput = {
  conversationId: number;
  triggerType: CommercialTrigger["type"];
  triggerDedupeKey: string;
  sourceMessageId?: number | null;
};

export type AssignCommercialTriggerSequenceResult =
  | { status: "assigned" | "existing"; record: CommercialTriggerSequenceRecord }
  | { status: "failed"; error: string };

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeDedupeKey(value: string): string {
  return value.trim().slice(0, 191);
}

function lockName(input: Pick<AssignCommercialTriggerSequenceInput, "conversationId">): string {
  return `crm-commercial-seq:${input.conversationId}`.slice(0, 191);
}

function hydrate(row: Record<string, unknown>): CommercialTriggerSequenceRecord {
  return {
    conversationId: asNumber(row.conversation_id) ?? 0,
    triggerDedupeKey: String(row.trigger_dedupe_key ?? ""),
    triggerType: String(row.trigger_type ?? "SYSTEM_EVENT") as CommercialTrigger["type"],
    sourceMessageId: asNumber(row.source_message_id),
    commercialSequence: asNumber(row.commercial_sequence) ?? 0
  };
}

async function loadExisting(conversationId: number, triggerDedupeKey: string): Promise<CommercialTriggerSequenceRecord | null> {
  const rows = await queryRows<Record<string, unknown>>(
    `SELECT conversation_id, trigger_dedupe_key, trigger_type, source_message_id, commercial_sequence
      FROM crm_commercial_trigger_sequences
      WHERE conversation_id = ? AND trigger_dedupe_key = ?
      LIMIT 1`,
    [conversationId, triggerDedupeKey]
  );
  return rows[0] ? hydrate(rows[0]) : null;
}

// The per-conversation GET_LOCK below already serializes concurrent callers
// targeting the SAME conversation - it cannot prevent an InnoDB deadlock
// (1213) against an unrelated transaction's gap locks on the same shared
// sequence tables (a different conversation's allocation, running at the
// same instant). That is a transient condition, not a correctness failure -
// retrying the whole attempt a bounded number of times is the standard
// response, same as any other deadlock-eligible write.
const DEADLOCK_RETRYABLE_ERROR_CODES = new Set(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]);
const MAX_SEQUENCE_ASSIGNMENT_ATTEMPTS = 3;

function isRetryableSequenceError(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code;
  return typeof code === "string" && DEADLOCK_RETRYABLE_ERROR_CODES.has(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function assignCommercialTriggerSequence(input: AssignCommercialTriggerSequenceInput): Promise<AssignCommercialTriggerSequenceResult> {
  const triggerDedupeKey = normalizeDedupeKey(input.triggerDedupeKey);
  if (!Number.isSafeInteger(input.conversationId) || input.conversationId <= 0 || !triggerDedupeKey) {
    return { status: "failed", error: "invalid_sequence_input" };
  }

  for (let attempt = 1; attempt <= MAX_SEQUENCE_ASSIGNMENT_ATTEMPTS; attempt += 1) {
    const outcome = await assignCommercialTriggerSequenceAttempt(input, triggerDedupeKey);
    if (outcome.status !== "failed" || !isRetryableSequenceError(outcome.cause) || attempt === MAX_SEQUENCE_ASSIGNMENT_ATTEMPTS) {
      return outcome.status === "failed" ? { status: "failed", error: outcome.error } : outcome;
    }
    await sleep(25 * attempt);
  }
  // Unreachable: the loop always returns on its last iteration.
  return { status: "failed", error: "commercial_sequence_allocation_failed" };
}

async function assignCommercialTriggerSequenceAttempt(
  input: AssignCommercialTriggerSequenceInput,
  triggerDedupeKey: string
): Promise<AssignCommercialTriggerSequenceResult & { cause?: unknown }> {
  try {
    const existing = await loadExisting(input.conversationId, triggerDedupeKey);
    if (existing) return { status: "existing", record: existing };

    const result = await withConnection(async (connection) => {
      const [lockRows] = await connection.execute<RowDataPacket[]>("SELECT GET_LOCK(?, 10) AS acquired", [lockName(input)]);
      const acquired = asNumber((lockRows[0] as Record<string, unknown> | undefined)?.acquired) === 1;
      if (!acquired) throw new Error("commercial_sequence_lock_timeout");

      try {
        await connection.beginTransaction();
        const [existingRows] = await connection.execute<RowDataPacket[]>(
          `SELECT conversation_id, trigger_dedupe_key, trigger_type, source_message_id, commercial_sequence
            FROM crm_commercial_trigger_sequences
            WHERE conversation_id = ? AND trigger_dedupe_key = ?
            LIMIT 1
            FOR UPDATE`,
          [input.conversationId, triggerDedupeKey]
        );
        if (existingRows[0]) {
          await connection.commit();
          return { status: "existing" as const, record: hydrate(existingRows[0] as Record<string, unknown>) };
        }

        await connection.execute<ResultSetHeader>(
          `INSERT INTO crm_commercial_conversation_sequences (conversation_id, current_sequence)
            VALUES (?, 0)
            ON DUPLICATE KEY UPDATE current_sequence = current_sequence`,
          [input.conversationId]
        );
        await connection.execute<ResultSetHeader>(
          `UPDATE crm_commercial_conversation_sequences
            SET current_sequence = LAST_INSERT_ID(current_sequence + 1)
            WHERE conversation_id = ?`,
          [input.conversationId]
        );
        const [sequenceRows] = await connection.execute<RowDataPacket[]>("SELECT LAST_INSERT_ID() AS commercial_sequence");
        const commercialSequence = asNumber((sequenceRows[0] as Record<string, unknown> | undefined)?.commercial_sequence);
        if (!commercialSequence) throw new Error("commercial_sequence_allocation_failed");

        await connection.execute<ResultSetHeader>(
          `INSERT INTO crm_commercial_trigger_sequences (
              conversation_id, trigger_dedupe_key, trigger_type, source_message_id, commercial_sequence
            ) VALUES (?, ?, ?, ?, ?)`,
          [input.conversationId, triggerDedupeKey, input.triggerType, input.sourceMessageId ?? null, commercialSequence]
        );
        await connection.commit();
        return {
          status: "assigned" as const,
          record: {
            conversationId: input.conversationId,
            triggerDedupeKey,
            triggerType: input.triggerType,
            sourceMessageId: input.sourceMessageId ?? null,
            commercialSequence
          }
        };
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          // keep original error
        }
        throw error;
      } finally {
        await connection.execute("SELECT RELEASE_LOCK(?)", [lockName(input)]).catch(() => undefined);
      }
    });
    return result;
  } catch (error) {
    return { status: "failed", error: sanitizeDbError(error), cause: error };
  }
}

export async function getLatestCommercialSequence(conversationId: number): Promise<number | null> {
  const rows = await queryRows<{ current_sequence: number | string | bigint }>(
    "SELECT current_sequence FROM crm_commercial_conversation_sequences WHERE conversation_id = ? LIMIT 1",
    [conversationId]
  );
  return rows[0] ? asNumber(rows[0].current_sequence) : null;
}

export function getTriggerCommercialSequence(trigger: CommercialTrigger): number | null {
  const commercialSequence = "commercialSequence" in trigger ? trigger.commercialSequence : null;
  if (typeof commercialSequence === "number" && Number.isSafeInteger(commercialSequence) && commercialSequence > 0) return commercialSequence;
  if (trigger.type === "CUSTOMER_MESSAGE" && typeof trigger.sourceMessageSequence === "number" && Number.isSafeInteger(trigger.sourceMessageSequence) && trigger.sourceMessageSequence > 0) {
    return trigger.sourceMessageSequence;
  }
  return null;
}
