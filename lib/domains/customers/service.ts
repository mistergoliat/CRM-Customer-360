import { hasTable, getColumns, safeQueryRows } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { isDbWriteEnabled, dbWriteDisabledResponse } from "@/lib/write-access";
import { resolveCustomerCandidate } from "@/lib/customer-identity";
import { listChats } from "@/lib/chats";
import { createMysqlCustomerRepository } from "./repository";
import { buildCustomerDetailReadModel } from "./read-model";
import type { CustomerRepository } from "./contracts";
import type { CreateCustomerInput, CreateCustomerResult, CustomerListInput, CustomerListReadModel, CustomerRecord } from "./types";

export type CustomerServiceDependencies = {
  repository?: CustomerRepository;
  writeEnabled?: boolean;
  hasTable?: typeof hasTable;
  auditLog?: typeof auditLog;
};

async function findRelatedCaseRows(customer: CustomerRecord) {
  const columns = await getColumns("n8n_vw_hub_cases");
  if (columns.length === 0) {
    return { rows: [] as Array<{ id: string; label: string; href: string; meta: string }>, warnings: ["legacy_cases_unavailable"] };
  }

  const clauses: string[] = [];
  const params: unknown[] = [];
  const email = customer.email.toLowerCase();
  if (columns.includes("email")) {
    clauses.push("LOWER(email) = ?");
    params.push(email);
  }
  if (columns.includes("contact_name")) {
    clauses.push("LOWER(contact_name) LIKE ?");
    params.push(`%${customer.firstname.toLowerCase()}%`);
  }

  if (clauses.length === 0) {
    return { rows: [], warnings: ["legacy_cases_no_matchable_columns"] };
  }

  const result = await safeQueryRows<Record<string, unknown>>(
    `SELECT * FROM n8n_vw_hub_cases WHERE ${clauses.join(" OR ")} ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC LIMIT 8`,
    params
  );
  if (!result.ok) return { rows: [], warnings: [result.error] };

  return {
    rows: result.rows.map((row) => ({
      id: String(row.conversation_case_id ?? row.id ?? row.case_id ?? ""),
      label: String(row.contact_name ?? row.wa_id ?? row.id_order ?? row.invoice_number ?? "Caso"),
      href: row.conversation_case_id ? `/cases/${row.conversation_case_id}` : "#",
      meta: String(row.status ?? row.priority ?? "")
    })),
    warnings: []
  };
}

async function findRelatedConversationRows(customer: CustomerRecord) {
  const result = await listChats({ q: customer.email, page: 1 });
  if (result.error) return { rows: [], warnings: [result.error] };

  return {
    rows: result.rows.slice(0, 8).map((row) => ({
      id: String(row.conversation_case_id),
      label: String(row.contact_name ?? row.wa_id ?? "Conversacion"),
      href: `/conversations/${row.conversation_case_id}`,
      meta: String(row.status ?? row.priority ?? "")
    })),
    warnings: []
  };
}

async function buildCustomerDetailReadModelFromRecord(customer: CustomerRecord, warnings: string[], source: string) {
  const [identityResult, relatedConversationRows, relatedCaseRows] = await Promise.all([
    resolveCustomerCandidate({ email: customer.email, options: { readOnly: true, allowProvisional: true } }),
    findRelatedConversationRows(customer),
    findRelatedCaseRows(customer)
  ]);

  const mergedWarnings = Array.from(
    new Set([
      ...warnings,
      ...(identityResult?.warnings ?? []),
      ...relatedConversationRows.warnings,
      ...relatedCaseRows.warnings
    ])
  );

  return buildCustomerDetailReadModel({
    customer,
    identityResult,
    relatedConversationRows: relatedConversationRows.rows,
    relatedCaseRows: relatedCaseRows.rows,
    warnings: mergedWarnings,
    mode: "real",
    source
  });
}

export function createCustomerService(dependencies: CustomerServiceDependencies = {}) {
  const repository = dependencies.repository ?? createMysqlCustomerRepository();
  const writeEnabled = dependencies.writeEnabled ?? isDbWriteEnabled();
  const hasTableFn = dependencies.hasTable ?? hasTable;
  const auditLogFn = dependencies.auditLog ?? auditLog;

  return {
    async list(input: CustomerListInput): Promise<CustomerListReadModel> {
      return repository.list(input);
    },
    async findByEmail(email: string) {
      const customerResult = await repository.findByEmail(email);
      const customer = customerResult.customer;
      if (!customer) return null;
      return buildCustomerDetailReadModelFromRecord(customer, customerResult.warnings, "master_customer");
    },
    async getById(id: string) {
      const customerResult = await repository.getById(id);
      if (!customerResult.customer) return null;
      return buildCustomerDetailReadModelFromRecord(customerResult.customer, customerResult.warnings, "master_customer");
    },
    async create(input: CreateCustomerInput): Promise<CreateCustomerResult> {
      if (!writeEnabled) {
        throw new Error("DB_WRITE_DISABLED");
      }
      const createdResult = await repository.create(input);
      const created = createdResult.customer;
      if (!created) {
        throw new Error("customer_create_failed");
      }
      const warnings: string[] = [...createdResult.warnings];

      const auditTableExists = await hasTableFn("hub_audit_log");
      if (auditTableExists) {
        await auditLogFn({
          action: "customer.created",
          entityType: "customer_master",
          entityId: created.id,
          after: {
            customerId: String(created.id),
            source: "hub_webapp",
            changedFields: ["firstname", "lastname", "email", "platform_origin"],
            platformOrigin: created.platformOrigin
          }
        });
      } else {
        warnings.push("hub_audit_log_unavailable");
      }

      return {
        customer: created,
        warnings,
        meta: {
          mode: "real",
          source: "master_customer",
          warnings
        }
      };
    }
  };
}

const defaultService = createCustomerService();

export async function listCustomers(input: CustomerListInput): Promise<CustomerListReadModel> {
  return defaultService.list(input);
}

export async function findCustomerByEmail(email: string) {
  return defaultService.findByEmail(email);
}

export async function getCustomerById(id: string) {
  return defaultService.getById(id);
}

export async function createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult> {
  return defaultService.create(input);
}

export async function createCustomerWithWrites(input: CreateCustomerInput) {
  if (!isDbWriteEnabled()) {
    return dbWriteDisabledResponse();
  }
  return createCustomer(input);
}
