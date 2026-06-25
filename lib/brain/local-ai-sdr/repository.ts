import { createHash } from "node:crypto";
import { queryRows, safeQueryRows } from "@/lib/db";
import { normalizePlatformOrigin } from "@/lib/domains/customers/platform-origin";
import type {
  LocalAiSdrAction,
  LocalAiSdrConversationState,
  LocalAiSdrConversationSummary,
  LocalAiSdrDetail,
  LocalAiSdrExecution,
  LocalAiSdrMessage,
  LocalAiSdrToolExecution,
  LocalAiSdrToolName
} from "./types";
import { normalizeIso, parseJsonArray, parseJsonObject, pickText } from "./utils";

const AGENT_TYPE = "local_ai_sdr";

type ConversationRow = {
  id: number;
  public_id: string;
  channel: string;
  provider: string;
  channel_account_id: string;
  external_contact_id: string;
  customer_id: string | null;
  status: string;
  owner_type: string;
  owner_id: string | null;
  ai_enabled: number | string;
  last_message_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  created_at: string;
  updated_at: string;
  customer_firstname?: string | null;
  customer_lastname?: string | null;
  customer_email?: string | null;
  customer_platform_origin?: string | null;
  state_state?: string | null;
  state_pending_action?: string | null;
  state_data_json?: unknown;
  state_updated_at?: string | null;
  message_count?: number | string | null;
  last_message?: string | null;
  warnings_json?: unknown;
};

type ConversationMessageRow = {
  id: number;
  public_id: string;
  conversation_id: number;
  provider: string;
  provider_message_id: string | null;
  direction: string;
  sender_type: string;
  message_type: string;
  body: string | null;
  status: string | null;
  provider_timestamp: string | null;
  created_at: string;
  updated_at: string;
};

type StateRow = {
  conversation_id: number;
  agent_type: string;
  state: string;
  pending_action: string | null;
  state_data_json: unknown;
  updated_at: string;
};

type ExecutionRow = {
  id: number;
  public_id: string;
  conversation_id: number;
  trigger_message_id: number | null;
  customer_id: string | null;
  agent_type: string;
  trigger_type: string;
  execution_mode: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

type DecisionRow = {
  id: number;
  public_id: string;
  execution_id: number;
  intent: string;
  action: string;
  tool_name: string | null;
  confidence: number | string | null;
  requires_customer_confirmation: number | string;
  requires_human_approval: number | string;
  policy_tags_json: unknown;
  arguments_json: unknown;
  reason_summary: string | null;
  created_at: string;
};

type ToolExecutionRow = {
  id: number;
  public_id: string;
  execution_id: number;
  decision_id: number | null;
  tool_name: string;
  input_json: unknown;
  output_json: unknown;
  status: string;
  idempotency_key: string;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
};

function asNullableText(value: unknown) {
  return pickText(value);
}

function toNullableNumericId(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function toMysqlDatetime(value: string | Date | null | undefined) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 23).replace("T", " ");
  }
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function toConversationState(row: StateRow | null, fallbackWarnings: string[] = []): LocalAiSdrConversationState {
  const stateData = parseJsonObject(row?.state_data_json);
  return {
    state: (asNullableText(row?.state) ?? "unresolved") as LocalAiSdrConversationState["state"],
    pendingAction: (asNullableText(row?.pending_action) as LocalAiSdrConversationState["pendingAction"]) ?? null,
    email: asNullableText(stateData.email),
    firstname: asNullableText(stateData.firstname),
    lastname: asNullableText(stateData.lastname),
    customerId: asNullableText(stateData.customerId ?? stateData.customer_id),
    customerEmail: asNullableText(stateData.customerEmail ?? stateData.customer_email),
    customerName: asNullableText(stateData.customerName ?? stateData.customer_name),
    customerPlatformOrigin: normalizePlatformOrigin(stateData.customerPlatformOrigin ?? stateData.customer_platform_origin),
    linkStatus: (asNullableText(stateData.linkStatus) as LocalAiSdrConversationState["linkStatus"]) ?? null,
    lastDecisionId: asNullableText(stateData.lastDecisionId ?? stateData.decisionId),
    lastToolName: (asNullableText(stateData.lastToolName) as LocalAiSdrConversationState["lastToolName"]) ?? null,
    lastToolStatus: asNullableText(stateData.lastToolStatus),
    lastToolResult: parseJsonObject(stateData.lastToolResult),
    lastResponseText: asNullableText(stateData.lastResponseText),
    reason: asNullableText(stateData.reason),
    confidence: typeof stateData.confidence === "number" ? stateData.confidence : typeof stateData.confidence === "string" ? Number(stateData.confidence) : null,
    warnings: [...fallbackWarnings, ...parseJsonArray<string>(stateData.warnings)].filter(Boolean),
    context: parseJsonObject(stateData.context)
  };
}

function toConversationSummary(row: ConversationRow): LocalAiSdrConversationSummary {
  const state = toConversationState({
    conversation_id: row.id,
    agent_type: AGENT_TYPE,
    state: row.state_state ?? "unresolved",
    pending_action: row.state_pending_action ?? null,
    state_data_json: row.state_data_json ?? {},
    updated_at: row.state_updated_at ?? row.updated_at
  });
  const customerName = [row.customer_firstname, row.customer_lastname].filter(Boolean).join(" ").trim() || null;
  return {
    publicId: row.public_id,
    waId: row.external_contact_id,
    customerId: row.customer_id,
    customerName,
    customerEmail: row.customer_email ?? state.customerEmail ?? null,
    customerPlatformOrigin: normalizePlatformOrigin(row.customer_platform_origin ?? state.customerPlatformOrigin),
    state: state.state,
    pendingAction: state.pendingAction,
    lastMessage: row.last_message ?? null,
    lastMessageAt: row.last_message_at ?? null,
    updatedAt: row.updated_at ?? null,
    messageCount: Number(row.message_count ?? 0),
    warnings: parseJsonArray<string>(row.warnings_json)
  };
}

function mapMessageRow(row: ConversationMessageRow): LocalAiSdrMessage {
  return {
    id: row.public_id,
    providerMessageId: row.provider_message_id,
    direction: row.direction === "outbound" ? "outbound" : "inbound",
    senderType: row.sender_type,
    messageType: row.message_type,
    body: row.body ?? "",
    status: row.status,
    createdAt: row.created_at,
    source: row.provider
  };
}

function mapExecutionRow(row: ExecutionRow): LocalAiSdrExecution {
  return {
    publicId: row.public_id,
    status: row.status,
    triggerType: row.trigger_type,
    executionMode: row.execution_mode,
    agentType: row.agent_type,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorCode: row.error_code,
    errorMessage: row.error_message
  };
}

function mapDecisionRow(row: DecisionRow) {
  return {
    publicId: row.public_id,
    intent: row.intent,
    action: row.action as LocalAiSdrAction,
    tool: (row.tool_name as LocalAiSdrToolName | null) ?? null,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    reason: row.reason_summary,
    policyTags: parseJsonArray<string>(row.policy_tags_json),
    arguments: parseJsonObject(row.arguments_json)
  };
}

function mapToolExecutionRow(row: ToolExecutionRow): LocalAiSdrToolExecution {
  return {
    publicId: row.public_id,
    toolName: row.tool_name,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    input: parseJsonObject(row.input_json),
    output: parseJsonObject(row.output_json),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorCode: row.error_code,
    errorMessage: row.error_message
  };
}

function stableExecutionPublicId(input: { conversationId: string; messageId: string; messageText: string }) {
  const hash = createHash("sha256");
  hash.update([input.conversationId, input.messageId, input.messageText].join("|"));
  return `exec-${hash.digest("hex").slice(0, 31)}`;
}

function stableDecisionPublicId(executionPublicId: string, action: string, state: string) {
  const hash = createHash("sha256");
  hash.update([executionPublicId, action, state].join("|"));
  return `dec-${hash.digest("hex").slice(0, 32)}`;
}

function stableToolPublicId(executionPublicId: string, toolName: string, idempotencyKey: string) {
  const hash = createHash("sha256");
  hash.update([executionPublicId, toolName, idempotencyKey].join("|"));
  return `tool-${hash.digest("hex").slice(0, 31)}`;
}

export async function listLocalAiSdrConversations(limit = 12): Promise<LocalAiSdrConversationSummary[]> {
  const result = await safeQueryRows<ConversationRow>(
    `
      SELECT
        c.*,
        mc.firstname AS customer_firstname,
        mc.lastname AS customer_lastname,
        mc.email AS customer_email,
        mc.platform_origin AS customer_platform_origin,
        s.state AS state_state,
        s.pending_action AS state_pending_action,
        s.state_data_json AS state_data_json,
        s.updated_at AS state_updated_at,
        (
          SELECT COUNT(*)
          FROM conversation_message cm
          WHERE cm.conversation_id = c.id
        ) AS message_count,
        (
          SELECT cm.body
          FROM conversation_message cm
          WHERE cm.conversation_id = c.id
          ORDER BY cm.created_at DESC, cm.id DESC
          LIMIT 1
        ) AS last_message
      FROM conversation c
      LEFT JOIN master_customer mc ON mc.id = c.customer_id
      LEFT JOIN ai_conversation_state s
        ON s.conversation_id = c.id
       AND s.agent_type = ?
      ORDER BY COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC, c.id DESC
      LIMIT ?
    `,
    [AGENT_TYPE, limit]
  );

  if (!result.ok) return [];
  return result.rows.map((row) => toConversationSummary(row));
}

export async function getConversationByPublicId(publicId: string): Promise<LocalAiSdrDetail | null> {
  const conversationResult = await safeQueryRows<ConversationRow>(
    `
      SELECT
        c.*,
        mc.firstname AS customer_firstname,
        mc.lastname AS customer_lastname,
        mc.email AS customer_email,
        mc.platform_origin AS customer_platform_origin,
        s.state AS state_state,
        s.pending_action AS state_pending_action,
        s.state_data_json AS state_data_json,
        s.updated_at AS state_updated_at,
        (
          SELECT COUNT(*)
          FROM conversation_message cm
          WHERE cm.conversation_id = c.id
        ) AS message_count,
        (
          SELECT cm.body
          FROM conversation_message cm
          WHERE cm.conversation_id = c.id
          ORDER BY cm.created_at DESC, cm.id DESC
          LIMIT 1
        ) AS last_message
      FROM conversation c
      LEFT JOIN master_customer mc ON mc.id = c.customer_id
      LEFT JOIN ai_conversation_state s
        ON s.conversation_id = c.id
       AND s.agent_type = ?
      WHERE c.public_id = ?
      LIMIT 1
    `,
    [AGENT_TYPE, publicId]
  );
  if (!conversationResult.ok) return null;
  const conversationRow = conversationResult.rows[0] ?? null;
  if (!conversationRow) return null;

  const messageResult = await safeQueryRows<ConversationMessageRow>(
    `
      SELECT *
      FROM conversation_message
      WHERE conversation_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    [conversationRow.id]
  );
  const executionResult = await safeQueryRows<ExecutionRow>(
    `
      SELECT *
      FROM ai_agent_execution
      WHERE conversation_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [conversationRow.id]
  );

  const latestExecution = executionResult.ok ? executionResult.rows[0] ?? null : null;
  let latestDecision: ReturnType<typeof mapDecisionRow> | null = null;
  let latestToolExecution: LocalAiSdrToolExecution | null = null;
  if (latestExecution) {
    const decisionResult = await safeQueryRows<DecisionRow>(
      "SELECT * FROM ai_agent_decision WHERE execution_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      [latestExecution.id]
    );
    latestDecision = decisionResult.ok ? decisionResult.rows[0] ? mapDecisionRow(decisionResult.rows[0]) : null : null;

    const toolResult = await safeQueryRows<ToolExecutionRow>(
      "SELECT * FROM ai_tool_execution WHERE execution_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      [latestExecution.id]
    );
    latestToolExecution = toolResult.ok ? toolResult.rows[0] ? mapToolExecutionRow(toolResult.rows[0]) : null : null;
  }

  const state = toConversationState(
    {
      conversation_id: conversationRow.id,
      agent_type: AGENT_TYPE,
      state: conversationRow.state_state ?? "unresolved",
      pending_action: conversationRow.state_pending_action ?? null,
      state_data_json: conversationRow.state_data_json ?? {},
      updated_at: conversationRow.state_updated_at ?? conversationRow.updated_at
    },
    conversationResult.ok ? [] : ["conversation_load_warning"]
  );
  const warnings = [...state.warnings];
  const customer = conversationRow.customer_id
    ? {
        id: String(conversationRow.customer_id),
        firstname: conversationRow.customer_firstname ?? "",
        lastname: conversationRow.customer_lastname ?? "",
        email: conversationRow.customer_email ?? "",
        platformOrigin: normalizePlatformOrigin(conversationRow.customer_platform_origin)
      }
    : null;

  return {
    conversation: toConversationSummary(conversationRow),
    messages: messageResult.ok ? messageResult.rows.map(mapMessageRow) : [],
    state,
    customer,
    latestExecution: latestExecution ? mapExecutionRow(latestExecution) : null,
    latestDecision,
    latestToolExecution,
    dataQuality: {
      status: warnings.length > 0 ? "partial" : "valid",
      warnings,
      source: "conversation_ai_runtime"
    },
    warnings
  };
}

export async function createConversation(input: {
  waId?: string | null;
  externalContactId?: string | null;
  channelAccountId?: string | null;
  customerId?: string | number | null;
  publicId?: string | null;
}) {
  const publicId = input.publicId ?? `conv-${createHash("sha256").update([input.waId ?? "", input.externalContactId ?? "", input.customerId ?? ""].join("|")).digest("hex").slice(0, 24)}`;
  await queryRows(
    `
      INSERT INTO conversation (
        public_id,
        channel,
        provider,
        channel_account_id,
        external_contact_id,
        customer_id,
        status,
        owner_type,
        owner_id,
        ai_enabled,
        last_message_at,
        last_inbound_at,
        last_outbound_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        channel = VALUES(channel),
        provider = VALUES(provider),
        channel_account_id = VALUES(channel_account_id),
        external_contact_id = VALUES(external_contact_id),
        customer_id = VALUES(customer_id),
        status = VALUES(status),
        owner_type = VALUES(owner_type),
        owner_id = VALUES(owner_id),
        ai_enabled = VALUES(ai_enabled),
        updated_at = VALUES(updated_at)
    `,
    [
      publicId,
      "whatsapp",
      "local_ai_sdr",
      input.channelAccountId ?? "local_whatsapp",
      input.externalContactId ?? input.waId ?? publicId,
      input.customerId ?? null,
      "open",
      "ai_sdr",
      "local_ai_sdr",
      1,
      null,
      null,
      null,
      toMysqlDatetime(new Date()),
      toMysqlDatetime(new Date())
    ]
  );

  const detail = await getConversationByPublicId(publicId);
  return { publicId, detail };
}

export async function appendConversationMessage(input: {
  conversationPublicId: string;
  provider: string;
  providerMessageId: string;
  direction: "inbound" | "outbound";
  senderType: string;
  messageType?: string;
  body: string;
  status?: string | null;
  occurredAt?: string | Date | null;
}) {
  const conversationResult = await safeQueryRows<{ id: number }>("SELECT id FROM conversation WHERE public_id = ? LIMIT 1", [input.conversationPublicId]);
  if (!conversationResult.ok) return { ok: false as const, error: conversationResult.error };
  const conversation = conversationResult.rows[0] ?? null;
  if (!conversation) return { ok: false as const, error: "conversation_not_found" };

  await queryRows(
    `
      INSERT INTO conversation_message (
        public_id,
        conversation_id,
        provider,
        provider_message_id,
        direction,
        sender_type,
        message_type,
        body,
        status,
        provider_timestamp,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        body = VALUES(body),
        status = VALUES(status),
        provider_timestamp = VALUES(provider_timestamp),
        updated_at = VALUES(updated_at)
    `,
    [
      `msg-${createHash("sha256").update([input.conversationPublicId, input.providerMessageId, input.direction].join("|")).digest("hex").slice(0, 24)}`,
      conversation.id,
      input.provider,
      input.providerMessageId,
      input.direction,
      input.senderType,
      input.messageType ?? "text",
      input.body,
      input.status ?? (input.direction === "inbound" ? "received" : "sent"),
      toMysqlDatetime(input.occurredAt),
      toMysqlDatetime(new Date()),
      toMysqlDatetime(new Date())
    ]
  );

  return { ok: true as const };
}

export async function loadConversationRuntimeState(conversationPublicId: string): Promise<LocalAiSdrConversationState | null> {
  const result = await safeQueryRows<StateRow & { id: number }>(
    `
      SELECT c.id AS conversation_id, s.*
      FROM conversation c
      LEFT JOIN ai_conversation_state s
        ON s.conversation_id = c.id
       AND s.agent_type = ?
      WHERE c.public_id = ?
      LIMIT 1
    `,
    [AGENT_TYPE, conversationPublicId]
  );
  if (!result.ok) return null;
  const row = result.rows[0] ?? null;
  if (!row || !row.conversation_id) return null;
  return toConversationState(row);
}

export async function saveConversationRuntimeState(input: {
  conversationPublicId: string;
  state: LocalAiSdrConversationState;
}) {
  const conversationResult = await safeQueryRows<{ id: number }>("SELECT id FROM conversation WHERE public_id = ? LIMIT 1", [input.conversationPublicId]);
  if (!conversationResult.ok) return { ok: false as const, error: conversationResult.error };
  const conversation = conversationResult.rows[0] ?? null;
  if (!conversation) return { ok: false as const, error: "conversation_not_found" };

  const stateData = {
    email: input.state.email,
    firstname: input.state.firstname,
    lastname: input.state.lastname,
    customerId: input.state.customerId,
    customerEmail: input.state.customerEmail,
    customerName: input.state.customerName,
    customerPlatformOrigin: input.state.customerPlatformOrigin,
    linkStatus: input.state.linkStatus,
    lastDecisionId: input.state.lastDecisionId,
    lastToolName: input.state.lastToolName,
    lastToolStatus: input.state.lastToolStatus,
    lastToolResult: input.state.lastToolResult,
    lastResponseText: input.state.lastResponseText,
    reason: input.state.reason,
    confidence: input.state.confidence,
    warnings: input.state.warnings,
    context: input.state.context
  };

  await queryRows(
    `
      INSERT INTO ai_conversation_state (
        conversation_id,
        agent_type,
        state,
        pending_action,
        state_data_json,
        version,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        state = VALUES(state),
        pending_action = VALUES(pending_action),
        state_data_json = VALUES(state_data_json),
        version = version + 1,
        updated_at = VALUES(updated_at)
    `,
    [
      conversation.id,
      AGENT_TYPE,
      input.state.state,
      input.state.pendingAction,
      JSON.stringify(stateData),
      1,
      toMysqlDatetime(new Date()),
      toMysqlDatetime(new Date())
    ]
  );

  return { ok: true as const };
}

export async function insertAiAgentExecution(input: {
  conversationPublicId: string;
  triggerMessageId: string | null;
  customerId: string | null;
  agentType?: string;
  triggerType: string;
  executionMode: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  const conversationResult = await safeQueryRows<{ id: number }>("SELECT id FROM conversation WHERE public_id = ? LIMIT 1", [input.conversationPublicId]);
  if (!conversationResult.ok) return { ok: false as const, error: conversationResult.error, execution: null as ExecutionRow | null };
  const conversation = conversationResult.rows[0] ?? null;
  if (!conversation) return { ok: false as const, error: "conversation_not_found", execution: null as ExecutionRow | null };

  const publicId = stableExecutionPublicId({
    conversationId: input.conversationPublicId,
    messageId: input.triggerMessageId ?? "none",
    messageText: `${input.triggerType}:${input.executionMode}:${input.status}`
  });
  const triggerMessageId = toNullableNumericId(input.triggerMessageId);
  await queryRows(
    `
      INSERT INTO ai_agent_execution (
        public_id,
        conversation_id,
        trigger_message_id,
        customer_id,
        agent_type,
        trigger_type,
        execution_mode,
        status,
        started_at,
        completed_at,
        error_code,
        error_message,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        completed_at = VALUES(completed_at),
        error_code = VALUES(error_code),
        error_message = VALUES(error_message)
    `,
    [
      publicId,
      conversation.id,
      triggerMessageId,
      input.customerId,
      input.agentType ?? AGENT_TYPE,
      input.triggerType,
      input.executionMode,
      input.status,
      toMysqlDatetime(input.startedAt),
      input.completedAt ? toMysqlDatetime(input.completedAt) : null,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      toMysqlDatetime(new Date())
    ]
  );

  const loaded = await safeQueryRows<ExecutionRow>("SELECT * FROM ai_agent_execution WHERE public_id = ? LIMIT 1", [publicId]);
  return { ok: loaded.ok, error: loaded.ok ? null : loaded.error, execution: loaded.ok ? loaded.rows[0] ?? null : null };
}

export async function insertAiAgentDecision(input: {
  executionPublicId: string;
  intent: string;
  action: string;
  toolName: string | null;
  confidence: number | null;
  requiresCustomerConfirmation: boolean;
  requiresHumanApproval: boolean;
  policyTags: string[];
  arguments: Record<string, unknown>;
  reasonSummary: string | null;
}) {
  const executionResult = await safeQueryRows<{ id: number }>("SELECT id FROM ai_agent_execution WHERE public_id = ? LIMIT 1", [input.executionPublicId]);
  if (!executionResult.ok) return { ok: false as const, error: executionResult.error, decision: null as DecisionRow | null };
  const execution = executionResult.rows[0] ?? null;
  if (!execution) return { ok: false as const, error: "execution_not_found", decision: null as DecisionRow | null };

  const publicId = stableDecisionPublicId(input.executionPublicId, input.action, input.intent);
  await queryRows(
    `
      INSERT INTO ai_agent_decision (
        public_id,
        execution_id,
        intent,
        action,
        tool_name,
        confidence,
        requires_customer_confirmation,
        requires_human_approval,
        policy_tags_json,
        arguments_json,
        reason_summary,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        intent = VALUES(intent),
        action = VALUES(action),
        tool_name = VALUES(tool_name),
        confidence = VALUES(confidence),
        requires_customer_confirmation = VALUES(requires_customer_confirmation),
        requires_human_approval = VALUES(requires_human_approval),
        policy_tags_json = VALUES(policy_tags_json),
        arguments_json = VALUES(arguments_json),
        reason_summary = VALUES(reason_summary)
    `,
    [
      publicId,
      execution.id,
      input.intent,
      input.action,
      input.toolName,
      input.confidence,
      input.requiresCustomerConfirmation ? 1 : 0,
      input.requiresHumanApproval ? 1 : 0,
      JSON.stringify(input.policyTags),
      JSON.stringify(input.arguments),
      input.reasonSummary,
      toMysqlDatetime(new Date())
    ]
  );

  const loaded = await safeQueryRows<DecisionRow>("SELECT * FROM ai_agent_decision WHERE public_id = ? LIMIT 1", [publicId]);
  return { ok: loaded.ok, error: loaded.ok ? null : loaded.error, decision: loaded.ok ? loaded.rows[0] ?? null : null };
}

export async function insertAiToolExecution(input: {
  executionPublicId: string;
  decisionPublicId: string | null;
  toolName: string;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  status: string;
  idempotencyKey: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt: string;
  completedAt?: string | null;
}) {
  const executionResult = await safeQueryRows<{ id: number }>("SELECT id FROM ai_agent_execution WHERE public_id = ? LIMIT 1", [input.executionPublicId]);
  if (!executionResult.ok) return { ok: false as const, error: executionResult.error, toolExecution: null as ToolExecutionRow | null };
  const execution = executionResult.rows[0] ?? null;
  if (!execution) return { ok: false as const, error: "execution_not_found", toolExecution: null as ToolExecutionRow | null };

  const decisionResult = input.decisionPublicId
    ? await safeQueryRows<{ id: number }>("SELECT id FROM ai_agent_decision WHERE public_id = ? LIMIT 1", [input.decisionPublicId])
    : { ok: true as const, rows: [{ id: null }] as Array<{ id: number | null }> };
  const decision = decisionResult.ok ? decisionResult.rows[0] ?? null : null;

  const publicId = stableToolPublicId(input.executionPublicId, input.toolName, input.idempotencyKey);
  await queryRows(
    `
      INSERT INTO ai_tool_execution (
        public_id,
        execution_id,
        decision_id,
        tool_name,
        input_json,
        output_json,
        status,
        idempotency_key,
        error_code,
        error_message,
        started_at,
        completed_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        output_json = VALUES(output_json),
        status = VALUES(status),
        error_code = VALUES(error_code),
        error_message = VALUES(error_message),
        completed_at = VALUES(completed_at)
    `,
      [
        publicId,
        execution.id,
        decision?.id ?? null,
        input.toolName,
        JSON.stringify(input.inputPayload),
        JSON.stringify(input.outputPayload),
        input.status,
        input.idempotencyKey,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        toMysqlDatetime(input.startedAt),
        input.completedAt ? toMysqlDatetime(input.completedAt) : null,
        toMysqlDatetime(new Date())
      ]
    );

  const loaded = await safeQueryRows<ToolExecutionRow>("SELECT * FROM ai_tool_execution WHERE public_id = ? LIMIT 1", [publicId]);
  return { ok: loaded.ok, error: loaded.ok ? null : loaded.error, toolExecution: loaded.ok ? loaded.rows[0] ?? null : null };
}
