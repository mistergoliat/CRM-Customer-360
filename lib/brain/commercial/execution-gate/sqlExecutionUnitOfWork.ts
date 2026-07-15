import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { withConnection } from "@/lib/db";
import { deserializeAgentActionRow, type CrmAgentAction } from "../action-queue";
import { CRM_AGENT_ACTIONS_TABLE } from "../action-queue/constants";
import { BRAIN_MESSAGE_OUTBOX_TABLE, writeCanonicalOutboxMessage } from "../../messaging/canonicalOutboxWriter";
import type { AgentActionRepository, ExecutionUnitOfWork, OutboxRepository } from "./repositories";
import type { CanonicalOutboxCommand } from "./types";

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toMysqlDateTime(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date(0) : date;
  return safeDate.toISOString().slice(0, 19).replace("T", " ");
}

class SqlAgentActionRepository implements AgentActionRepository {
  constructor(private readonly connection: PoolConnection) {}

  private async findByColumn(column: "action_id" | "idempotency_key", value: string): Promise<CrmAgentAction | null> {
    const [rows] = await this.connection.execute(
      `SELECT * FROM \`${CRM_AGENT_ACTIONS_TABLE}\` WHERE \`${column}\` = ? LIMIT 1 FOR UPDATE`,
      [value]
    );
    const row = (rows as Record<string, unknown>[])[0];
    return row ? deserializeAgentActionRow(row) : null;
  }

  findByActionId(actionId: string): Promise<CrmAgentAction | null> {
    return this.findByColumn("action_id", actionId);
  }

  findByIdempotencyKey(idempotencyKey: string): Promise<CrmAgentAction | null> {
    return this.findByColumn("idempotency_key", idempotencyKey);
  }

  async markPlanned(input: {
    actionId: string;
    expectedCurrentStatuses: string[];
    outboxMessageId: number | null;
    updatedAt: string;
  }): Promise<{ updated: boolean; rowId: number | null; conflict: boolean }> {
    const placeholders = input.expectedCurrentStatuses.map(() => "?").join(", ");
    const [result] = await this.connection.execute<ResultSetHeader>(
      `
        UPDATE \`${CRM_AGENT_ACTIONS_TABLE}\`
        SET status = ?, outbox_message_id = ?, updated_at = ?
        WHERE action_id = ? AND status IN (${placeholders})
      `,
      ["planned", input.outboxMessageId, toMysqlDateTime(input.updatedAt), input.actionId, ...input.expectedCurrentStatuses]
    );

    const existing = await this.findByActionId(input.actionId);
    return {
      updated: result.affectedRows > 0,
      rowId: existing?.id ?? null,
      conflict: result.affectedRows === 0 && Boolean(existing)
    };
  }
}

class SqlOutboxRepository implements OutboxRepository {
  constructor(private readonly connection: PoolConnection) {}

  async findByIdempotencyKey(idempotencyKey: string): Promise<{ id: number; status: string } | null> {
    const [rows] = await this.connection.execute(
      `SELECT id, status FROM \`${BRAIN_MESSAGE_OUTBOX_TABLE}\` WHERE dedupe_key = ? LIMIT 1 FOR UPDATE`,
      [idempotencyKey]
    );
    const row = (rows as Record<string, unknown>[])[0];
    const id = asNumber(row?.id);
    return row && id !== null ? { id, status: String(row.status ?? "planned") } : null;
  }

  async insertCommand(command: CanonicalOutboxCommand): Promise<{ inserted: boolean; duplicate: boolean; rowId: number | null }> {
    // Delegates to the canonical writer (ACS-R1-05-T04, P1-4) - same INSERT
    // SQL, same column normalization, same phone_number_id resolution as the
    // legacy outbox.ts adapter. Passing this.connection keeps the write
    // inside the unit-of-work's own transaction instead of opening a second one.
    const result = await writeCanonicalOutboxMessage(
      {
        dedupeKey: command.idempotencyKey,
        status: "planned",
        source: command.metadata.source,
        sourceRequestId: command.actionId,
        sourceAgentName: "sales-agent",
        sourceAgentVersion: command.metadata.runtimeVersion,
        waId: command.recipient,
        phoneNumberId: null,
        conversationCaseId: command.conversationCaseId,
        messageText: command.messageText,
        metaPayloadJson: {
          commandId: command.commandId,
          actionId: command.actionId,
          opportunityId: command.opportunityId,
          decisionId: command.decisionId,
          commandType: command.commandType,
          metadata: command.metadata
        },
        providerMessageId: null,
        errorCode: null,
        errorMessage: null,
        opportunityId: command.opportunityId,
        plannedAt: command.createdAt
      },
      this.connection
    );

    return { inserted: result.inserted, duplicate: result.duplicate, rowId: result.rowId };
  }
}

export class SqlExecutionUnitOfWork implements ExecutionUnitOfWork {
  async run<T>(
    operation: (repositories: { agentActions: AgentActionRepository; outbox: OutboxRepository }) => Promise<T>
  ): Promise<T> {
    return withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const result = await operation({
          agentActions: new SqlAgentActionRepository(connection),
          outbox: new SqlOutboxRepository(connection)
        });
        await connection.commit();
        return result;
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the original failure.
        }
        throw error;
      }
    });
  }
}
