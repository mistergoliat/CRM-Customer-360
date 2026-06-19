import { queryRows, hasTable, sanitizeDbError } from "../../../db";
import { CRM_AGENT_ACTIONS_TABLE, COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_LIMIT, COMMERCIAL_AGENT_ACTION_QUEUE_MAX_LIMIT } from "./constants";
import { deserializeAgentActionRow } from "./serializeAgentAction";
import { validateAgentAction } from "./validateAgentAction";
import type { AgentActionQueueDatabaseAdapter, CrmAgentAction, LoadAgentActionsInput, LoadAgentActionsResult, LoadAgentActionsStatus } from "./types";

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asId(value: unknown): number | string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isSafeInteger(numeric) && String(numeric) === trimmed) return numeric;
    return trimmed;
  }
  return null;
}

function asList(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => asText(item)).filter((item): item is string => Boolean(item)))];
  }
  const text = asText(value);
  return text ? [text] : [];
}

function buildResult(
  status: LoadAgentActionsStatus,
  actions: CrmAgentAction[],
  warnings: string[],
  error: string | null,
  limit: number
): LoadAgentActionsResult {
  return {
    status,
    actions,
    warnings: [...new Set(warnings)],
    error,
    totalCount: actions.length,
    limit
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isInteger(limit ?? COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_LIMIT)) return COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_LIMIT;
  return Math.min(COMMERCIAL_AGENT_ACTION_QUEUE_MAX_LIMIT, Math.max(1, limit ?? COMMERCIAL_AGENT_ACTION_QUEUE_DEFAULT_LIMIT));
}

function buildWhereClause(input: LoadAgentActionsInput) {
  const identityClauses: string[] = [];
  const identityParams: Array<string | number> = [];

  const opportunityId = asId(input.opportunityId);
  const conversationCaseId = asId(input.conversationCaseId);
  const waId = asText(input.waId);

  if (opportunityId !== null) {
    identityClauses.push("opportunity_id = ?");
    identityParams.push(opportunityId);
  }
  if (conversationCaseId !== null) {
    identityClauses.push("conversation_case_id = ?");
    identityParams.push(conversationCaseId);
  }
  if (waId !== null) {
    identityClauses.push("wa_id = ?");
    identityParams.push(waId);
  }

  const statusValues = asList(input.status);
  const actionTypeValues = asList(input.actionType);
  const clauses: string[] = [];
  const params: Array<string | number> = [...identityParams];

  if (identityClauses.length > 0) {
    clauses.push(`(${identityClauses.join(" OR ")})`);
  }

  if (statusValues.length > 0) {
    clauses.push(`status IN (${statusValues.map(() => "?").join(", ")})`);
    params.push(...statusValues);
  }

  if (actionTypeValues.length > 0) {
    clauses.push(`action_type IN (${actionTypeValues.map(() => "?").join(", ")})`);
    params.push(...actionTypeValues);
  }

  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

async function defaultHasTable(tableName: string) {
  try {
    return await hasTable(tableName);
  } catch {
    return false;
  }
}

function normalizeAdapter(adapter?: AgentActionQueueDatabaseAdapter | null): Required<Pick<AgentActionQueueDatabaseAdapter, "hasTable" | "queryRows">> | null {
  if (!adapter) return null;
  return {
    hasTable: adapter.hasTable ?? defaultHasTable,
    queryRows: adapter.queryRows ?? (async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => queryRows<T>(sql, params))
  };
}

export async function loadAgentActions(
  input: LoadAgentActionsInput,
  adapter?: AgentActionQueueDatabaseAdapter | null
): Promise<LoadAgentActionsResult> {
  const limit = normalizeLimit(input.limit);
  const safeAdapter = normalizeAdapter(adapter);

  if (!input.queueEnabled) {
    return buildResult("unavailable", [], ["agent_action_queue_disabled"], null, limit);
  }

  try {
    const tableExists = safeAdapter ? await safeAdapter.hasTable(CRM_AGENT_ACTIONS_TABLE) : await defaultHasTable(CRM_AGENT_ACTIONS_TABLE);
    if (!tableExists) {
      return buildResult("unavailable", [], ["agent_action_queue_missing"], null, limit);
    }

    const { where, params } = buildWhereClause(input);
    const rows = safeAdapter
      ? await safeAdapter.queryRows<Record<string, unknown>>(
          `
            SELECT *
            FROM ${CRM_AGENT_ACTIONS_TABLE}
            ${where}
            ORDER BY updated_at DESC, id DESC
            LIMIT ${limit}
          `,
          params
        )
      : await queryRows<Record<string, unknown>>(
          `
            SELECT *
            FROM ${CRM_AGENT_ACTIONS_TABLE}
            ${where}
            ORDER BY updated_at DESC, id DESC
            LIMIT ${limit}
          `,
          params
        );

    const actions: CrmAgentAction[] = [];
    const warnings: string[] = [];

    for (const row of rows) {
      const action = deserializeAgentActionRow(row);
      const validation = validateAgentAction(action);
      if (validation.valid && validation.action) {
        actions.push(validation.action);
      } else {
        warnings.push(validation.code);
      }
    }

    return buildResult("loaded", actions, warnings, null, limit);
  } catch (error) {
    return buildResult("error", [], ["agent_action_queue_read_failed"], sanitizeDbError(error), limit);
  }
}
