import type { RowDataPacket, ResultSetHeader, PoolConnection } from "mysql2/promise";
import { withConnection, hasTable } from "../../../db";
import { TERMINAL_OPPORTUNITY_STATUSES } from "../constants";

/**
 * SALES-AGENT-R3-V1.1. Runtime-neutral opportunity anchor for the Harness
 * path (ATL/future SalesAgentRuntime). Deliberately smaller than
 * operational-loop's CommercialOperationalState: no primaryIntent, stage,
 * temperature, requirements, or decision record - those are legacy
 * planner/operational-loop concerns (see persistCommercialState.ts) that a
 * Harness turn must never require to anchor a mutation. crm_opportunities
 * remains the single authoritative table; this module adds no new store.
 */
export type RuntimeOpportunityContext = {
  opportunityId: number;
  opportunityKey: string;
  status: string;
  version: number;
};

export type RuntimeOpportunityResolution =
  | { status: "existing"; opportunity: RuntimeOpportunityContext }
  | { status: "created"; opportunity: RuntimeOpportunityContext }
  | { status: "unavailable"; reason: string };

export type ResolveRuntimeOpportunityInput = {
  conversationId: number;
  customerMasterId: number | null;
  waId: string | null;
  channel: string;
  correlationId: string;
  currentTime: string;
};

type OpportunityRow = RowDataPacket & {
  id: number;
  opportunity_key: string;
  status: string;
  version: number;
};

/**
 * Same session-advisory-lock pattern as
 * sales-agent-configuration/repository.ts#acquireScopeLock: GET_LOCK before
 * BEGIN on the SAME connection, scoped per conversation so two concurrent
 * resolutions for the same conversation are fully serialized - the second
 * caller's SELECT (inside the lock) already sees the first caller's commit,
 * so it returns "existing" instead of racing to create a sibling row. This
 * is the reused mechanism per Phase 8 of the task brief, not a new one.
 */
const LOCK_TIMEOUT_SECONDS = 10;

function lockKeyFor(conversationId: number): string {
  return `runtime_opportunity:${conversationId}`;
}

async function acquireConversationLock(connection: PoolConnection, conversationId: number): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>("SELECT GET_LOCK(?, ?) AS acquired", [
    lockKeyFor(conversationId),
    LOCK_TIMEOUT_SECONDS
  ]);
  const acquired = Number((rows[0] as { acquired?: unknown } | undefined)?.acquired) === 1;
  if (!acquired) {
    throw new Error(`runtime_opportunity_lock_timeout:${conversationId}`);
  }
}

async function releaseConversationLock(connection: PoolConnection, conversationId: number): Promise<void> {
  try {
    await connection.execute("SELECT RELEASE_LOCK(?)", [lockKeyFor(conversationId)]);
  } catch {
    // Same rationale as the sales-agent-configuration precedent: MariaDB
    // releases session advisory locks automatically once the connection
    // closes/returns, so a failed explicit release is not fatal.
  }
}

/**
 * Same scoping as the existing loadActiveOpportunity query
 * (lib/brain/native-whatsapp/service.ts) - one active commercial thread per
 * conversation_case_id, most recently updated row wins. That query has no
 * terminal-status filter today (a real, pre-existing gap this function
 * closes for the Harness path only - loadActiveOpportunity itself is
 * untouched, still consumed by CommercialWork/ATL read context exactly as
 * before).
 */
async function loadLatestOpportunity(connection: PoolConnection, conversationId: number): Promise<OpportunityRow | null> {
  const [rows] = await connection.execute<OpportunityRow[]>(
    `
      SELECT id, opportunity_key, status, version
      FROM crm_opportunities
      WHERE conversation_case_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `,
    [String(conversationId)]
  );
  return rows[0] ?? null;
}

/**
 * Deterministic and readable, never intent-derived (Phase 4 finding:
 * operational-loop's buildOpportunityKey bakes in primaryIntent, which
 * would recreate the state-machine coupling R3 explicitly forbids). The
 * numeric suffix only advances past a terminal opportunity - safe under
 * concurrency because it is always computed and consumed inside the
 * per-conversation advisory lock above, never raced.
 */
async function nextOpportunityKey(connection: PoolConnection, conversationId: number): Promise<string> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS priorCount FROM crm_opportunities WHERE conversation_case_id = ?`,
    [String(conversationId)]
  );
  const priorCount = Number((rows[0] as { priorCount?: unknown } | undefined)?.priorCount ?? 0);
  return priorCount === 0 ? `runtime:conversation:${conversationId}` : `runtime:conversation:${conversationId}:${priorCount + 1}`;
}

async function createOpportunity(
  connection: PoolConnection,
  input: ResolveRuntimeOpportunityInput
): Promise<RuntimeOpportunityContext> {
  const opportunityKey = await nextOpportunityKey(connection, input.conversationId);
  const [result] = await connection.execute<ResultSetHeader>(
    `
      INSERT INTO crm_opportunities (
        opportunity_key, conversation_case_id, customer_master_id, wa_id, channel,
        requirements_json, missing_requirements_json, product_interests_json,
        objections_json, signals_json
      ) VALUES (?, ?, ?, ?, ?, JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY())
    `,
    [opportunityKey, String(input.conversationId), input.customerMasterId, input.waId, input.channel]
  );
  return { opportunityId: result.insertId, opportunityKey, status: "new", version: 1 };
}

export async function resolveRuntimeOpportunity(input: ResolveRuntimeOpportunityInput): Promise<RuntimeOpportunityResolution> {
  try {
    if (!(await hasTable("crm_opportunities"))) {
      return { status: "unavailable", reason: "crm_opportunities_table_missing" };
    }

    return await withConnection(async (connection) => {
      await acquireConversationLock(connection, input.conversationId);
      try {
        await connection.beginTransaction();
        try {
          const existing = await loadLatestOpportunity(connection, input.conversationId);

          if (existing && !TERMINAL_OPPORTUNITY_STATUSES.includes(existing.status as (typeof TERMINAL_OPPORTUNITY_STATUSES)[number])) {
            await connection.commit();
            return {
              status: "existing",
              opportunity: {
                opportunityId: existing.id,
                opportunityKey: existing.opportunity_key,
                status: existing.status,
                version: existing.version
              }
            };
          }

          const created = await createOpportunity(connection, input);
          await connection.commit();
          return { status: "created", opportunity: created };
        } catch (error) {
          await connection.rollback();
          throw error;
        }
      } finally {
        await releaseConversationLock(connection, input.conversationId);
      }
    });
  } catch (error) {
    return { status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
}
