import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { hasTable, queryRows, safeQueryRows, withConnection, type DbRow } from "@/lib/db";
import { isDbWriteEnabled } from "@/lib/write-access";
import type { CustomerIdentityResolutionStatus } from "@/lib/domains/customer-identity-onboarding";
import type {
  CustomerConversationLinkRecord,
  CustomerOnboardingStateRecord,
  CustomerOnboardingToolName,
  CustomerOnboardingState,
} from "./types";

const STATE_TABLE = "crm_customer_onboarding";
const LINK_TABLE = "customer_conversation_link";

function asText(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asBoolean(value: unknown) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function safeJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toRecord(row: DbRow): CustomerOnboardingStateRecord {
  return {
    id: typeof row.id === "number" ? row.id : Number(row.id ?? null) || null,
    conversationCaseId: asText(row.conversation_case_id) ?? "",
    waId: asText(row.wa_id),
    state: (asText(row.state) ?? "unresolved") as CustomerOnboardingState,
    identityResolutionStatus: (asText(row.identity_resolution_status) as CustomerIdentityResolutionStatus) ?? null,
    identityProvider: asText(row.identity_provider),
    identityType: asText(row.identity_type),
    identityExternalId: asText(row.identity_external_id),
    identityNormalizedValue: asText(row.identity_normalized_value),
    pendingAction: (asText(row.pending_action) as CustomerOnboardingStateRecord["pendingAction"]) ?? null,
    pendingCustomerConfirmation: asBoolean(row.pending_customer_confirmation),
    email: asText(row.email),
    firstname: asText(row.firstname),
    lastname: asText(row.lastname),
    customerId: asText(row.customer_id),
    customerPlatformOrigin: (asText(row.customer_platform_origin) as CustomerOnboardingStateRecord["customerPlatformOrigin"]) ?? null,
    linkStatus: asText(row.link_status),
    customerCreationConsentEmail: asText(row.customer_creation_consent_email),
    customerCreationConsentSourceMessageId: asText(row.customer_creation_consent_source_message_id),
    customerCreationConsentChannel: asText(row.customer_creation_consent_channel),
    customerCreationConsentGrantedAt: asText(row.customer_creation_consent_granted_at),
    customerCreationConsentGranted: row.customer_creation_consent_granted === null || row.customer_creation_consent_granted === undefined ? null : asBoolean(row.customer_creation_consent_granted),
    lastDecisionId: asText(row.last_decision_id),
    lastToolName: (asText(row.last_tool_name) as CustomerOnboardingToolName) ?? null,
    lastToolStatus: asText(row.last_tool_status),
    lastToolResult: safeJson<Record<string, unknown>>(row.last_tool_result_json, {}),
    lastResponseText: asText(row.last_response_text),
    reason: asText(row.reason),
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    warnings: safeJson<string[]>(row.warnings_json, []),
    context: safeJson<Record<string, unknown>>(row.context_json, {}),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at)
  };
}

function toLinkRecord(row: DbRow): CustomerConversationLinkRecord {
  return {
    id: typeof row.id === "number" ? row.id : Number(row.id ?? null) || null,
    customerId: asText(row.customer_id) ?? "",
    conversationCaseId: asText(row.conversation_case_id) ?? "",
    linkStatus: (asText(row.link_status) as CustomerConversationLinkRecord["linkStatus"]) ?? "confirmed",
    linkSource: (asText(row.link_source) as CustomerConversationLinkRecord["linkSource"]) ?? "ai_sdr",
    confidence: (asText(row.confidence) as CustomerConversationLinkRecord["confidence"]) ?? "high",
    linkedAt: asText(row.linked_at),
    createdAt: asText(row.created_at),
    updatedAt: asText(row.updated_at)
  };
}

export async function loadCustomerOnboardingState(conversationCaseId: string | number | null) {
  if (!conversationCaseId) {
    return { ok: true as const, state: null as CustomerOnboardingStateRecord | null, warnings: [] as string[] };
  }

  const result = await safeQueryRows<DbRow>(
    `SELECT * FROM \`${STATE_TABLE}\` WHERE conversation_case_id = ? LIMIT 1`,
    [conversationCaseId]
  );
  if (!result.ok) {
    return { ok: false as const, state: null as CustomerOnboardingStateRecord | null, warnings: [result.error] };
  }
  return { ok: true as const, state: result.rows[0] ? toRecord(result.rows[0]) : null, warnings: [] };
}

export async function loadCustomerConversationLink(conversationCaseId: string | number | null) {
  if (!conversationCaseId) {
    return { ok: true as const, link: null as CustomerConversationLinkRecord | null, warnings: [] as string[] };
  }

  const result = await safeQueryRows<DbRow>(
    `SELECT * FROM \`${LINK_TABLE}\` WHERE conversation_case_id = ? LIMIT 1`,
    [conversationCaseId]
  );
  if (!result.ok) {
    return { ok: false as const, link: null as CustomerConversationLinkRecord | null, warnings: [result.error] };
  }
  return { ok: true as const, link: result.rows[0] ? toLinkRecord(result.rows[0]) : null, warnings: [] };
}

export async function loadCustomerOnboardingSnapshot(conversationCaseId: string | number | null) {
  const [stateResult, linkResult] = await Promise.all([
    loadCustomerOnboardingState(conversationCaseId),
    loadCustomerConversationLink(conversationCaseId)
  ]);

  return {
    ok: stateResult.ok && linkResult.ok,
    state: stateResult.state,
    link: linkResult.link,
    warnings: [...stateResult.warnings, ...linkResult.warnings]
  };
}

export async function persistCustomerConversationLink(input: {
  customerId: string;
  conversationCaseId: string | number;
  linkStatus?: CustomerConversationLinkRecord["linkStatus"];
  linkSource?: CustomerConversationLinkRecord["linkSource"];
  confidence?: CustomerConversationLinkRecord["confidence"];
  linkedAt?: string;
}) {
  if (!isDbWriteEnabled()) {
    return { ok: false as const, status: "disabled" as const, warnings: ["db_write_disabled"], link: null as CustomerConversationLinkRecord | null };
  }

  if (!(await hasTable(LINK_TABLE))) {
    return { ok: false as const, status: "unavailable" as const, warnings: ["customer_conversation_link_unavailable"], link: null as CustomerConversationLinkRecord | null };
  }

  try {
    await withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        await connection.execute(
          `INSERT INTO \`${LINK_TABLE}\`
            (customer_id, conversation_case_id, link_status, link_source, confidence, linked_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             customer_id = VALUES(customer_id),
             link_status = VALUES(link_status),
             link_source = VALUES(link_source),
             confidence = VALUES(confidence),
             linked_at = VALUES(linked_at),
             updated_at = VALUES(updated_at)`,
          [
            input.customerId,
            String(input.conversationCaseId),
            input.linkStatus ?? "confirmed",
            input.linkSource ?? "ai_sdr",
            input.confidence ?? "high",
            input.linkedAt ?? new Date().toISOString(),
            input.linkedAt ?? new Date().toISOString(),
            input.linkedAt ?? new Date().toISOString()
          ]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });

    const loaded = await loadCustomerConversationLink(input.conversationCaseId);
    return {
      ok: true as const,
      status: loaded.link ? "confirmed" : "unavailable",
      warnings: loaded.warnings,
      link: loaded.link
    };
  } catch (error) {
    return {
      ok: false as const,
      status: "unavailable" as const,
      warnings: [error instanceof Error ? error.message : String(error)],
      link: null as CustomerConversationLinkRecord | null
    };
  }
}

export async function persistCustomerOnboardingState(input: {
  conversationCaseId: string | number;
  waId?: string | null;
  state: CustomerOnboardingState;
  identityResolutionStatus?: CustomerIdentityResolutionStatus | null;
  identityProvider?: string | null;
  identityType?: string | null;
  identityExternalId?: string | null;
  identityNormalizedValue?: string | null;
  pendingAction?: string | null;
  pendingCustomerConfirmation?: boolean;
  email?: string | null;
  firstname?: string | null;
  lastname?: string | null;
  customerId?: string | null;
  customerPlatformOrigin?: string | null;
  linkStatus?: string | null;
  customerCreationConsentEmail?: string | null;
  customerCreationConsentSourceMessageId?: string | null;
  customerCreationConsentChannel?: string | null;
  customerCreationConsentGrantedAt?: string | null;
  customerCreationConsentGranted?: boolean | null;
  lastDecisionId?: string | null;
  lastToolName?: string | null;
  lastToolStatus?: string | null;
  lastToolResult?: Record<string, unknown> | null;
  lastResponseText?: string | null;
  reason?: string | null;
  confidence?: number | null;
  warnings?: string[];
  context?: Record<string, unknown>;
  currentTime: string;
  connection?: PoolConnection;
}) {
  if (!isDbWriteEnabled()) {
    return { ok: false as const, status: "disabled" as const, warnings: ["db_write_disabled"], state: null as CustomerOnboardingStateRecord | null };
  }

  if (!(await hasTable(STATE_TABLE))) {
    return { ok: false as const, status: "unavailable" as const, warnings: ["customer_onboarding_unavailable"], state: null as CustomerOnboardingStateRecord | null };
  }

  const now = input.currentTime;
  const warningsJson = JSON.stringify(input.warnings ?? []);
  const contextJson = JSON.stringify(input.context ?? {});
  try {
    const params = [
      String(input.conversationCaseId),
      input.waId ?? null,
      input.state,
      input.identityResolutionStatus ?? null,
      input.identityProvider ?? null,
      input.identityType ?? null,
      input.identityExternalId ?? null,
      input.identityNormalizedValue ?? null,
      input.pendingAction ?? null,
      input.pendingCustomerConfirmation ? 1 : 0,
      input.email ?? null,
      input.firstname ?? null,
      input.lastname ?? null,
      input.customerId ?? null,
      input.customerPlatformOrigin ?? null,
      input.linkStatus ?? null,
      input.customerCreationConsentEmail ?? null,
      input.customerCreationConsentSourceMessageId ?? null,
      input.customerCreationConsentChannel ?? null,
      input.customerCreationConsentGrantedAt ?? null,
      input.customerCreationConsentGranted === null || input.customerCreationConsentGranted === undefined ? null : input.customerCreationConsentGranted ? 1 : 0,
      input.lastDecisionId ?? null,
      input.lastToolName ?? null,
      input.lastToolStatus ?? null,
      input.lastToolResult ? JSON.stringify(input.lastToolResult) : null,
      input.lastResponseText ?? null,
      input.reason ?? null,
      input.confidence ?? null,
      warningsJson,
      contextJson,
      now,
      now
    ];
    if (input.connection) {
      await input.connection.execute(
        `INSERT INTO \`${STATE_TABLE}\`
          (conversation_case_id, wa_id, state, identity_resolution_status, identity_provider, identity_type, identity_external_id, identity_normalized_value, pending_action, pending_customer_confirmation, email, firstname, lastname, customer_id, customer_platform_origin, link_status, customer_creation_consent_email, customer_creation_consent_source_message_id, customer_creation_consent_channel, customer_creation_consent_granted_at, customer_creation_consent_granted, last_decision_id, last_tool_name, last_tool_status, last_tool_result_json, last_response_text, reason, confidence, warnings_json, context_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           wa_id = VALUES(wa_id),
           state = VALUES(state),
           identity_resolution_status = VALUES(identity_resolution_status),
           identity_provider = VALUES(identity_provider),
           identity_type = VALUES(identity_type),
           identity_external_id = VALUES(identity_external_id),
           identity_normalized_value = VALUES(identity_normalized_value),
           pending_action = VALUES(pending_action),
           pending_customer_confirmation = VALUES(pending_customer_confirmation),
           email = VALUES(email),
           firstname = VALUES(firstname),
           lastname = VALUES(lastname),
           customer_id = VALUES(customer_id),
           customer_platform_origin = VALUES(customer_platform_origin),
           link_status = VALUES(link_status),
           customer_creation_consent_email = VALUES(customer_creation_consent_email),
           customer_creation_consent_source_message_id = VALUES(customer_creation_consent_source_message_id),
           customer_creation_consent_channel = VALUES(customer_creation_consent_channel),
           customer_creation_consent_granted_at = VALUES(customer_creation_consent_granted_at),
           customer_creation_consent_granted = VALUES(customer_creation_consent_granted),
           last_decision_id = VALUES(last_decision_id),
           last_tool_name = VALUES(last_tool_name),
           last_tool_status = VALUES(last_tool_status),
           last_tool_result_json = VALUES(last_tool_result_json),
           last_response_text = VALUES(last_response_text),
           reason = VALUES(reason),
           confidence = VALUES(confidence),
           warnings_json = VALUES(warnings_json),
           context_json = VALUES(context_json),
           updated_at = VALUES(updated_at)`,
        params
      );
    } else {
      await queryRows(
        `INSERT INTO \`${STATE_TABLE}\`
          (conversation_case_id, wa_id, state, identity_resolution_status, identity_provider, identity_type, identity_external_id, identity_normalized_value, pending_action, pending_customer_confirmation, email, firstname, lastname, customer_id, customer_platform_origin, link_status, customer_creation_consent_email, customer_creation_consent_source_message_id, customer_creation_consent_channel, customer_creation_consent_granted_at, customer_creation_consent_granted, last_decision_id, last_tool_name, last_tool_status, last_tool_result_json, last_response_text, reason, confidence, warnings_json, context_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         wa_id = VALUES(wa_id),
         state = VALUES(state),
         identity_resolution_status = VALUES(identity_resolution_status),
         identity_provider = VALUES(identity_provider),
         identity_type = VALUES(identity_type),
         identity_external_id = VALUES(identity_external_id),
         identity_normalized_value = VALUES(identity_normalized_value),
         pending_action = VALUES(pending_action),
         pending_customer_confirmation = VALUES(pending_customer_confirmation),
         email = VALUES(email),
         firstname = VALUES(firstname),
         lastname = VALUES(lastname),
         customer_id = VALUES(customer_id),
         customer_platform_origin = VALUES(customer_platform_origin),
         link_status = VALUES(link_status),
         customer_creation_consent_email = VALUES(customer_creation_consent_email),
         customer_creation_consent_source_message_id = VALUES(customer_creation_consent_source_message_id),
         customer_creation_consent_channel = VALUES(customer_creation_consent_channel),
         customer_creation_consent_granted_at = VALUES(customer_creation_consent_granted_at),
         customer_creation_consent_granted = VALUES(customer_creation_consent_granted),
         last_decision_id = VALUES(last_decision_id),
         last_tool_name = VALUES(last_tool_name),
         last_tool_status = VALUES(last_tool_status),
         last_tool_result_json = VALUES(last_tool_result_json),
         last_response_text = VALUES(last_response_text),
         reason = VALUES(reason),
         confidence = VALUES(confidence),
         warnings_json = VALUES(warnings_json),
         context_json = VALUES(context_json),
         updated_at = VALUES(updated_at)`,
        params
      );
    }

    if (input.connection) {
      const [rows] = await input.connection.execute<RowDataPacket[]>(
        `SELECT * FROM \`${STATE_TABLE}\` WHERE conversation_case_id = ? LIMIT 1`,
        [String(input.conversationCaseId)]
      );
      return {
        ok: true as const,
        status: "persisted" as const,
        warnings: [],
        state: rows[0] ? toRecord(rows[0] as DbRow) : null
      };
    }

    const loaded = await loadCustomerOnboardingState(input.conversationCaseId);
    return {
      ok: true as const,
      status: "persisted" as const,
      warnings: loaded.warnings,
      state: loaded.state
    };
  } catch (error) {
    return {
      ok: false as const,
      status: "failed" as const,
      warnings: [error instanceof Error ? error.message : String(error)],
      state: null as CustomerOnboardingStateRecord | null
    };
  }
}
