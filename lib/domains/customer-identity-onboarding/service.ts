import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { auditLog } from "@/lib/audit";
import { safeQueryRows, withTransaction } from "@/lib/db";
import { normalizeCustomerEmail, isArtificialCustomerEmail, isRealCustomerEmail } from "@/lib/domains/customers/email";
import { normalizePlatformOrigin, type PlatformOrigin } from "@/lib/domains/customers/platform-origin";
import type { CustomerRecord } from "@/lib/domains/customers/types";
import { upsertExternalIdentity } from "@/lib/integrations/customer-external-identity";
import { loadCustomerOnboardingState, persistCustomerOnboardingState } from "@/lib/brain/commercial/customer-onboarding/state";
import type { CustomerOnboardingState } from "@/lib/brain/commercial/customer-onboarding/types";
import type {
  ContactIdentity,
  CustomerCreationConsent,
  CustomerIdentityMutationResult,
  CustomerIdentityOnboardingSnapshot,
  CustomerIdentityResolutionStatus,
  CustomerMatchResult
} from "./types";

type MasterCustomerRow = {
  id: number;
  firstname: string;
  lastname: string;
  email: string;
  platform_origin: string | null;
};

function asText(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asDateTimeIso(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return asText(value);
}

function mapCustomer(row: MasterCustomerRow): CustomerRecord {
  return {
    id: String(row.id),
    firstname: row.firstname,
    lastname: row.lastname,
    email: normalizeCustomerEmail(row.email) ?? row.email,
    platformOrigin: normalizePlatformOrigin(row.platform_origin)
  };
}

function isValidEmailSyntax(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function loadMasterCustomersByEmail(email: string, connection?: PoolConnection) {
  const sql = "SELECT id, firstname, lastname, email, platform_origin FROM master_customer WHERE LOWER(TRIM(email)) = ? ORDER BY id ASC";
  if (connection) {
    const [rows] = await connection.execute<RowDataPacket[]>(sql, [email]);
    return (rows as MasterCustomerRow[]) ?? [];
  }
  const result = await safeQueryRows<MasterCustomerRow>(sql, [email]);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.rows;
}

function createContactIdentity(row: {
  id: number | string;
  provider: string;
  identity_type: string;
  external_id: string;
  normalized_value: string;
  customer_id: number | null;
  is_verified: number | string;
  created_at: string | Date;
  updated_at: string | Date;
}): ContactIdentity {
  return {
    identityId: String(row.id),
    provider: row.provider,
    identityType: row.identity_type,
    externalId: row.external_id,
    normalizedValue: row.normalized_value,
    customerId: row.customer_id === null || row.customer_id === undefined ? null : Number(row.customer_id),
    verificationStatus: row.customer_id === null
      ? "unverified"
      : Number(row.is_verified) > 0
        ? "verified"
        : "pending",
    createdAt: asDateTimeIso(row.created_at) ?? "",
    updatedAt: asDateTimeIso(row.updated_at) ?? ""
  };
}

function mapLegacyOnboardingState(status: CustomerIdentityResolutionStatus): CustomerOnboardingState {
  switch (status) {
    case "email_requested":
      return "email_requested";
    case "email_provided":
    case "matching":
      return "email_received";
    case "matched":
      return "customer_found";
    case "creation_permission_requested":
      return "creation_offered";
    case "creation_authorized":
      return "creation_confirmed";
    case "created":
      return "customer_created";
    case "conflict":
    case "human_review_required":
      return "handoff";
    case "unresolved":
    default:
      return "unresolved";
  }
}

async function updateConversationCustomerLink(connection: PoolConnection, conversationId: number, customerId: number) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT customer_id FROM conversation WHERE id = ? LIMIT 1 FOR UPDATE",
    [conversationId]
  );
  const current = rows[0] ? asNumber((rows[0] as Record<string, unknown>).customer_id) : null;
  if (current !== null && current !== customerId) {
    throw new Error("conversation_customer_conflict");
  }
  await connection.execute(
    "UPDATE conversation SET customer_id = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
    [customerId, conversationId]
  );
}

async function updateOpportunityCustomerLink(connection: PoolConnection, opportunityId: number, customerId: number) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT customer_master_id FROM crm_opportunities WHERE id = ? LIMIT 1 FOR UPDATE",
    [opportunityId]
  );
  const current = rows[0] ? asNumber((rows[0] as Record<string, unknown>).customer_master_id) : null;
  if (current !== null && current !== customerId) {
    throw new Error("opportunity_customer_conflict");
  }
  await connection.execute(
    "UPDATE crm_opportunities SET customer_master_id = ? WHERE id = ?",
    [customerId, opportunityId]
  );
}

async function upsertConversationLink(connection: PoolConnection, input: { conversationCaseId: string | number; customerId: number }) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT customer_id FROM customer_conversation_link WHERE conversation_case_id = ? LIMIT 1 FOR UPDATE",
    [String(input.conversationCaseId)]
  );
  const current = rows[0] ? asText((rows[0] as Record<string, unknown>).customer_id) : null;
  if (current && current !== String(input.customerId)) {
    throw new Error("conversation_case_already_linked");
  }
  await connection.execute(
    `INSERT INTO customer_conversation_link
      (customer_id, conversation_case_id, link_status, link_source, confidence, linked_at, created_at, updated_at)
     VALUES (?, ?, 'confirmed', 'system', 'high', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       customer_id = VALUES(customer_id),
       link_status = VALUES(link_status),
       link_source = VALUES(link_source),
       confidence = VALUES(confidence),
       linked_at = VALUES(linked_at),
       updated_at = VALUES(updated_at)`,
    [String(input.customerId), String(input.conversationCaseId)]
  );
}

async function persistIdentityState(input: {
  conversationCaseId: string | number;
  state: CustomerIdentityResolutionStatus;
  email?: string | null;
  provider?: string | null;
  identityType?: string | null;
  externalId?: string | null;
  normalizedValue?: string | null;
  customerId?: string | null;
  consent?: CustomerCreationConsent | null;
  customerPlatformOrigin?: PlatformOrigin | null;
  warning?: string | null;
  currentTime: string;
  connection?: PoolConnection;
}) {
  await persistCustomerOnboardingState({
    conversationCaseId: input.conversationCaseId,
    state: mapLegacyOnboardingState(input.state),
    identityResolutionStatus: input.state,
    identityProvider: input.provider ?? null,
    identityType: input.identityType ?? null,
    identityExternalId: input.externalId ?? null,
    identityNormalizedValue: input.normalizedValue ?? null,
    email: input.email ?? null,
    customerId: input.customerId ?? null,
    customerPlatformOrigin: input.customerPlatformOrigin ?? null,
    customerCreationConsentEmail: input.consent?.email ?? null,
    customerCreationConsentSourceMessageId: input.consent?.sourceMessageId ?? null,
    customerCreationConsentChannel: input.consent?.channel ?? null,
    customerCreationConsentGrantedAt: input.consent?.grantedAt ?? null,
    customerCreationConsentGranted: input.consent?.granted ?? null,
    warnings: input.warning ? [input.warning] : [],
    context: {
      identityResolutionStatus: input.state,
      customerCreationConsent: input.consent ?? null
    },
    currentTime: input.currentTime,
    connection: input.connection
  });
}

function buildMatchResult(rows: CustomerRecord[]): CustomerMatchResult {
  if (rows.length === 0) return { status: "not_found", customers: [] };
  if (rows.length === 1) return { status: "matched", customers: [rows[0]] };
  return { status: "conflict", customers: rows };
}

export async function findMasterCustomerByEmail(email: string): Promise<CustomerMatchResult> {
  const normalized = normalizeCustomerEmail(email);
  if (!normalized || !isValidEmailSyntax(normalized) || !isRealCustomerEmail(normalized) || isArtificialCustomerEmail(normalized)) {
    return { status: "error", customers: [] };
  }

  try {
    const rows = await loadMasterCustomersByEmail(normalized);
    return buildMatchResult(rows.map(mapCustomer));
  } catch {
    return { status: "error", customers: [] };
  }
}

export async function getIdentityStatus(conversationCaseId: string | number | null): Promise<CustomerIdentityOnboardingSnapshot> {
  const snapshot = await loadCustomerOnboardingState(conversationCaseId);
  const state = snapshot.state;
  const consent = state
    ? {
        granted: state.customerCreationConsentGranted ?? false,
        email: state.customerCreationConsentEmail ?? "",
        sourceMessageId: state.customerCreationConsentSourceMessageId ?? "",
        grantedAt: state.customerCreationConsentGrantedAt ?? "",
        channel: state.customerCreationConsentChannel ?? "unknown"
      }
    : null;
  const customer = state?.customerId
    ? {
        id: state.customerId,
        firstname: state.firstname ?? "",
        lastname: state.lastname ?? "",
        email: state.email ?? "",
        platformOrigin: state.customerPlatformOrigin ?? "unknown"
      }
    : null;
  return {
    conversationCaseId,
    identityResolutionStatus: state?.identityResolutionStatus ?? "unresolved",
    contactIdentity: state?.identityExternalId
      ? {
          identityId: String(state.id ?? state.conversationCaseId),
          provider: state.identityProvider ?? "whatsapp",
          identityType: state.identityType ?? "phone",
          externalId: state.identityExternalId,
          normalizedValue: state.identityNormalizedValue ?? state.waId ?? "",
          customerId: state.customerId ? Number(state.customerId) : null,
          verificationStatus: state.customerId ? "verified" : "unverified",
          createdAt: state.createdAt ?? "",
          updatedAt: state.updatedAt ?? state.createdAt ?? ""
        }
      : null,
    customer,
    customerCreationConsent: consent,
    warnings: snapshot.warnings,
    platformOrigin: state?.customerPlatformOrigin ?? "unknown"
  };
}

export async function linkExternalIdentity(input: {
  provider: string;
  identityType: string;
  externalId: string;
  normalizedValue: string;
  customerId: number | null;
  conversationCaseId?: string | number | null;
  email?: string | null;
  customerPlatformOrigin?: PlatformOrigin | null;
  sourceMessageId?: string | null;
  channel?: string | null;
  currentTime?: string | Date;
}) {
  const currentTime = asDateTimeIso(input.currentTime ?? new Date()) ?? new Date().toISOString();
  const result = await upsertExternalIdentity({
    customerId: input.customerId,
    provider: input.provider,
    identityType: input.identityType,
    externalId: input.externalId,
    normalizedValue: input.normalizedValue,
    isVerified: Boolean(input.customerId)
  });

  if (!result.ok || !result.row) {
    return { ok: false as const, status: "error" as const, identity: null as ContactIdentity | null, warning: result.error };
  }

  if (input.conversationCaseId !== undefined && input.conversationCaseId !== null) {
    await persistIdentityState({
      conversationCaseId: input.conversationCaseId,
      state: input.customerId ? "matched" : "unresolved",
      email: input.email ?? null,
      provider: input.provider,
      identityType: input.identityType,
      externalId: input.externalId,
      normalizedValue: input.normalizedValue,
      customerId: input.customerId === null ? null : String(input.customerId),
      customerPlatformOrigin: input.customerPlatformOrigin ?? null,
      currentTime
    });
  }

  return {
    ok: true as const,
    status: input.customerId ? ("linked" as const) : ("unresolved" as const),
    identity: createContactIdentity(result.row),
    warning: null as string | null
  };
}

export async function recordCustomerCreationConsent(input: {
  conversationCaseId: string | number;
  email: string;
  granted: boolean;
  sourceMessageId: string;
  occurredAt: string | Date;
  channel: string;
}) {
  const email = normalizeCustomerEmail(input.email);
  if (!email || !isValidEmailSyntax(email) || !isRealCustomerEmail(email) || isArtificialCustomerEmail(email)) {
    return { ok: false as const, status: "error" as const, warning: "invalid_email" };
  }
  if (!input.sourceMessageId.trim()) {
    return { ok: false as const, status: "error" as const, warning: "source_message_id_required" };
  }
  const occurredAt = asDateTimeIso(input.occurredAt);
  if (!occurredAt) {
    return { ok: false as const, status: "error" as const, warning: "invalid_timestamp" };
  }

  await persistIdentityState({
    conversationCaseId: input.conversationCaseId,
    state: input.granted ? "creation_authorized" : "creation_permission_requested",
    email,
    consent: {
      granted: input.granted,
      email,
      sourceMessageId: input.sourceMessageId,
      grantedAt: occurredAt,
      channel: input.channel
    },
    currentTime: occurredAt
  });

  await auditLog({
    action: input.granted ? "customer.creation_authorized" : "customer.creation_rejected",
    entityType: "customer_onboarding",
    entityId: input.conversationCaseId,
    after: {
      email,
      granted: input.granted,
      sourceMessageId: input.sourceMessageId,
      channel: input.channel,
      grantedAt: occurredAt
    }
  });

  return {
    ok: true as const,
    status: input.granted ? ("authorized" as const) : ("rejected" as const),
    warning: null as string | null
  };
}

async function createMasterCustomerRow(connection: PoolConnection, input: { firstname: string; lastname: string; email: string; platformOrigin: PlatformOrigin }) {
  await connection.execute(
    "INSERT INTO master_customer (firstname, lastname, email, platform_origin) VALUES (?, ?, ?, ?)",
    [input.firstname.trim(), input.lastname.trim(), input.email, input.platformOrigin]
  );
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT id, firstname, lastname, email, platform_origin FROM master_customer WHERE LOWER(TRIM(email)) = ? ORDER BY id DESC LIMIT 1",
    [input.email]
  );
  const row = rows[0] as MasterCustomerRow | undefined;
  if (!row) {
    throw new Error("customer_create_failed");
  }
  return mapCustomer(row);
}

export async function createCustomerFromAuthorizedOnboarding(input: {
  conversationCaseId: string | number;
  conversationId?: number | null;
  opportunityId?: number | null;
  email: string;
  firstname: string;
  lastname: string;
  platformOrigin: PlatformOrigin;
  sourceMessageId: string;
  occurredAt: string | Date;
  channel: string;
  provider?: string;
  externalId?: string | null;
  normalizedExternalId?: string | null;
}): Promise<CustomerIdentityMutationResult> {
  const email = normalizeCustomerEmail(input.email);
  if (!email || !isValidEmailSyntax(email) || !isRealCustomerEmail(email) || isArtificialCustomerEmail(email)) {
    return {
      status: "error",
      customer: null,
      customers: [],
      contactIdentity: null,
      identityResolutionStatus: "human_review_required",
      warnings: ["invalid_email"]
    };
  }

  if (!input.sourceMessageId.trim()) {
    return {
      status: "error",
      customer: null,
      customers: [],
      contactIdentity: null,
      identityResolutionStatus: "human_review_required",
      warnings: ["source_message_id_required"]
    };
  }

  const onboarding = await loadCustomerOnboardingState(input.conversationCaseId);
  const current = onboarding.state;
  if (!current || current.customerCreationConsentGranted !== true || current.customerCreationConsentEmail?.toLowerCase() !== email.toLowerCase()) {
    return {
      status: "error",
      customer: null,
      customers: [],
      contactIdentity: null,
      identityResolutionStatus: "human_review_required",
      warnings: ["customer_creation_not_authorized"]
    };
  }

  const currentTime = asDateTimeIso(input.occurredAt) ?? new Date().toISOString();

  try {
    const result = await withTransaction(async (connection) => {
      const existingRows = await loadMasterCustomersByEmail(email, connection);
      if (existingRows.length > 1) {
        const customers = existingRows.map(mapCustomer);
        await persistIdentityState({
          conversationCaseId: input.conversationCaseId,
          state: "conflict",
          email,
          provider: input.provider ?? current?.identityProvider ?? "whatsapp",
          identityType: current?.identityType ?? "email",
          externalId: input.externalId ?? current?.identityExternalId ?? null,
          normalizedValue: input.normalizedExternalId ?? current?.identityNormalizedValue ?? null,
          customerId: null,
          customerPlatformOrigin: input.platformOrigin,
          currentTime,
          warning: "customer_email_conflict"
        });
        return {
          status: "conflict" as const,
          customer: null,
          customers,
          contactIdentity: null,
          identityResolutionStatus: "conflict" as const,
          warnings: ["customer_email_conflict"]
        };
      }

      let customer: CustomerRecord | null = null;
      if (existingRows.length === 1) {
        customer = mapCustomer(existingRows[0]);
      } else {
        try {
          customer = await createMasterCustomerRow(connection, {
            firstname: input.firstname,
            lastname: input.lastname,
            email,
            platformOrigin: input.platformOrigin
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.toLowerCase().includes("duplicate")) {
            const retryRows = await loadMasterCustomersByEmail(email, connection);
            if (retryRows.length === 1) {
              customer = mapCustomer(retryRows[0]);
            } else if (retryRows.length > 1) {
              return {
                status: "conflict" as const,
                customer: null,
                customers: retryRows.map(mapCustomer),
                contactIdentity: null,
                identityResolutionStatus: "conflict" as const,
                warnings: ["customer_email_conflict"]
              };
            } else {
              throw error;
            }
          } else {
            throw error;
          }
        }
      }

      if (!customer) {
        throw new Error("customer_create_failed");
      }

      const externalId = input.externalId ?? current?.identityExternalId ?? null;
      const normalizedExternalId = input.normalizedExternalId ?? current?.identityNormalizedValue ?? email;
      const externalIdentity = externalId
        ? await upsertExternalIdentity({
            customerId: Number(customer.id),
            provider: input.provider ?? current?.identityProvider ?? "whatsapp",
            identityType: current?.identityType ?? "email",
            externalId,
            normalizedValue: normalizedExternalId,
            isVerified: true
          }, connection)
        : null;

      if (input.conversationId !== undefined && input.conversationId !== null) {
        await updateConversationCustomerLink(connection, input.conversationId, Number(customer.id));
      }

      if (input.opportunityId !== undefined && input.opportunityId !== null) {
        await updateOpportunityCustomerLink(connection, input.opportunityId, Number(customer.id));
      }

      await upsertConversationLink(connection, {
        conversationCaseId: input.conversationCaseId,
        customerId: Number(customer.id)
      });

      await persistIdentityState({
        conversationCaseId: input.conversationCaseId,
        state: existingRows.length === 1 ? "matched" : "created",
        email,
        provider: input.provider ?? current?.identityProvider ?? "whatsapp",
        identityType: current?.identityType ?? "email",
        externalId,
        normalizedValue: normalizedExternalId,
        customerId: customer.id,
        customerPlatformOrigin: customer.platformOrigin,
        consent: {
          granted: true,
          email,
          sourceMessageId: input.sourceMessageId,
          grantedAt: currentTime,
          channel: input.channel
        },
        currentTime,
        connection
      });

      await auditLog({
        action: existingRows.length === 1 ? "customer.identity_matched" : "customer.created",
        entityType: "customer_onboarding",
        entityId: input.conversationCaseId,
        after: {
          customerId: customer.id,
          email,
          conversationId: input.conversationId ?? null,
          opportunityId: input.opportunityId ?? null,
          sourceMessageId: input.sourceMessageId
        }
      });

      const contactIdentity = externalIdentity?.ok && externalIdentity.row ? createContactIdentity(externalIdentity.row) : null;
      return {
        status: existingRows.length === 1 ? ("matched" as const) : ("created" as const),
        customer,
        customers: [customer] as [CustomerRecord],
        contactIdentity,
        identityResolutionStatus: existingRows.length === 1 ? ("matched" as const) : ("created" as const),
        warnings: externalIdentity && !externalIdentity.ok ? [externalIdentity.error] : []
      };
    });

    return result;
  } catch (error) {
    return {
      status: "error",
      customer: null,
      customers: [],
      contactIdentity: null,
      identityResolutionStatus: "human_review_required",
      warnings: [error instanceof Error ? error.message : String(error)]
    };
  }
}
