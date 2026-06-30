import type { PoolConnection, ResultSetHeader } from "mysql2/promise";
import { withConnection } from "@/lib/db";
import { deserializeAgentActionRow, type CrmAgentAction } from "../action-queue";
import { CRM_AGENT_ACTIONS_TABLE } from "../action-queue/constants";
import { BRAIN_MESSAGE_OUTBOX_TABLE } from "../../messaging/outbox";
import { hashMessageText } from "../../messaging/dedupe";
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

function asJson(value: unknown) {
  return JSON.stringify(value ?? null);
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
    const existing = await this.findByIdempotencyKey(command.idempotencyKey);
    if (existing) return { inserted: false, duplicate: true, rowId: existing.id };

    const [result] = await this.connection.execute<ResultSetHeader>(
      `
        INSERT IGNORE INTO \`${BRAIN_MESSAGE_OUTBOX_TABLE}\`
          (
            dedupe_key, channel, direction, status, source, source_request_id,
            source_agent_name, source_agent_version, wa_id, phone_number_id,
            conversation_case_id, message_text, message_hash, meta_payload_json,
            provider_message_id, error_code, error_message, planned_at, locked_at,
            sent_at, failed_at, created_at, updated_at
          )
        VALUES (?, ?, 'outbound', 'planned', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, NULL, ?, ?)
      `,
      [
        command.idempotencyKey,
        command.channel,
        command.metadata.source,
        command.commandId,
        "sales-agent",
        command.metadata.runtimeVersion,
        command.recipient,
        command.conversationCaseId,
        command.messageText,
        hashMessageText(command.messageText),
        asJson({
          commandId: command.commandId,
          actionId: command.actionId,
          opportunityId: command.opportunityId,
          decisionId: command.decisionId,
          commandType: command.commandType,
          metadata: command.metadata
        }),
        toMysqlDateTime(command.createdAt),
        toMysqlDateTime(command.createdAt),
        toMysqlDateTime(command.createdAt)
      ]
    );

    if (result.affectedRows === 0) {
      const duplicate = await this.findByIdempotencyKey(command.idempotencyKey);
      return { inserted: false, duplicate: true, rowId: duplicate?.id ?? null };
    }

    return { inserted: true, duplicate: false, rowId: result.insertId || null };
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
