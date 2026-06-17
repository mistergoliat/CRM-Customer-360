import { getColumns, safeQueryRows } from "../db";
import { buildChilePhoneCandidates, normalizeEmail, normalizeIdentityValue, normalizePhoneChile, normalizeWaId } from "./normalize";
import type {
  CustomerIdentityConfidence,
  CustomerIdentityResolutionInput,
  CustomerIdentitySource,
  CustomerIdentityType,
  CustomerTimelineSeed
} from "./types";

export type CustomerSourceObservation = {
  source: CustomerIdentitySource;
  table: string;
  sourceRecordId: string | number | null;
  matchedBy: string;
  identityType: CustomerIdentityType | null;
  identityValue: string | null;
  confidence: CustomerIdentityConfidence;
  customerKey: string | null;
  notes: string[];
  timelineSeed: CustomerTimelineSeed | null;
};

export type CustomerSourceReaderResult = {
  source: CustomerIdentitySource;
  table: string;
  observations: CustomerSourceObservation[];
  warnings: string[];
};

type QueryTerm = {
  value: string | number | null | undefined;
  columns: string[];
  compare?: "exact" | "lowercase";
};

type QueryResult = {
  rows: Record<string, unknown>[];
  warnings: string[];
};

function formatWarning(code: string, source: CustomerIdentitySource, severity: "informational" | "warning" | "error", table: string, detail?: string) {
  return [code, source, severity, table, detail ?? ""].join("|");
}

function cleanText(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function scalarId(value: unknown): string | number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const text = value.trim();
    return text.length > 0 ? text : null;
  }

  return null;
}

function firstNonEmpty(row: Record<string, unknown>, candidates: string[]) {
  for (const candidate of candidates) {
    const value = row[candidate];
    const text = cleanText(value as string | number | null | undefined);
    if (text) return text;
  }
  return null;
}

function firstNumericLike(row: Record<string, unknown>, candidates: string[]) {
  const text = firstNonEmpty(row, candidates);
  return text ? normalizeIdentityValue("prestashop_customer_id", text) : null;
}

function buildPhoneCandidates(value: string | number | null | undefined) {
  return buildChilePhoneCandidates(value);
}

async function queryTableRows(tableName: string, source: CustomerIdentitySource, terms: QueryTerm[], limit = 10): Promise<QueryResult> {
  const columns = await getColumns(tableName);
  if (columns.length === 0) {
    return { rows: [], warnings: [formatWarning("table_not_found", source, "warning", tableName)] };
  }

  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const term of terms) {
    const normalizedValue =
      term.compare === "lowercase" && typeof term.value === "string" ? term.value.trim().toLowerCase() : term.value;
    if (normalizedValue === undefined || normalizedValue === null || normalizedValue === "") continue;

    const availableColumns = term.columns.filter((column) => columns.includes(column));
    if (availableColumns.length === 0) continue;

    const clause = availableColumns
      .map((column) => (term.compare === "lowercase" ? `LOWER(\`${column}\`) = ?` : `\`${column}\` = ?`))
      .join(" OR ");
    clauses.push(`(${clause})`);

    for (let index = 0; index < availableColumns.length; index += 1) {
      params.push(normalizedValue);
    }
  }

  if (clauses.length === 0) {
    return { rows: [], warnings: [formatWarning("source_not_configured", source, "warning", tableName)] };
  }

  const result = await safeQueryRows<Record<string, unknown>>(
    `SELECT * FROM \`${tableName}\` WHERE ${clauses.join(" OR ")} LIMIT ?`,
    [...params, Math.min(Math.max(limit, 1), 50)]
  );

  if (!result.ok) {
    return { rows: [], warnings: [formatWarning("query_failed", source, "error", tableName)] };
  }

  return { rows: result.rows, warnings: [] };
}

function makeObservation(input: {
  source: CustomerIdentitySource;
  table: string;
  sourceRecordId: string | number | null;
  matchedBy: string;
  identityType: CustomerIdentityType | null;
  identityValue: string | null;
  confidence: CustomerIdentityConfidence;
  customerKey: string | null;
  notes?: string[];
  timelineSeed?: CustomerTimelineSeed | null;
}): CustomerSourceObservation {
  return {
    source: input.source,
    table: input.table,
    sourceRecordId: input.sourceRecordId,
    matchedBy: input.matchedBy,
    identityType: input.identityType,
    identityValue: input.identityValue,
    confidence: input.confidence,
    customerKey: input.customerKey,
    notes: input.notes ?? [],
    timelineSeed: input.timelineSeed ?? null
  };
}

function buildPrestaShopTimelineSeed(source: CustomerIdentitySource, refId: string | number | null, matchedBy: string, confidence: CustomerIdentityConfidence): CustomerTimelineSeed | null {
  if (refId === null || refId === undefined) return null;
  return {
    eventType: `${source}_candidate_matched`,
    eventSource: source,
    eventRefType: "identity",
    eventRefId: refId,
    confidence,
    payload: { matchedBy }
  };
}

function buildLegacyTimelineSeed(source: CustomerIdentitySource, refType: CustomerTimelineSeed["eventRefType"], refId: string | number | null, matchedBy: string, confidence: CustomerIdentityConfidence): CustomerTimelineSeed | null {
  if (refId === null || refId === undefined) return null;
  return {
    eventType: `${source}_candidate_matched`,
    eventSource: source,
    eventRefType: refType,
    eventRefId: refId,
    confidence,
    payload: { matchedBy }
  };
}

function buildCustomerKeyFromPrestaShopCustomer(idCustomer: string | number | null | undefined) {
  const normalized = normalizeIdentityValue("prestashop_customer_id", idCustomer);
  return normalized ? `prestashop:${normalized}` : null;
}

function buildCustomerKeyFromOrder(idOrder: string | number | null | undefined) {
  const normalized = normalizeIdentityValue("order_id", idOrder);
  return normalized ? `prestashop:order:${normalized}` : null;
}

function buildCandidateKey(prefix: string, value: string | null) {
  return value ? `${prefix}:${value}` : null;
}

export async function readPrestashopCustomerCandidate(input: CustomerIdentityResolutionInput): Promise<CustomerSourceReaderResult> {
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedIdCustomer = normalizeIdentityValue("prestashop_customer_id", input.idCustomer);
  const terms: QueryTerm[] = [
    { value: normalizedIdCustomer, columns: ["id_customer", "customer_id", "id"] },
    { value: normalizedEmail, columns: ["email"], compare: "lowercase" }
  ];
  const query = await queryTableRows("ps_customer", "prestashop", terms, 10);
  const observations: CustomerSourceObservation[] = [];

  for (const row of query.rows) {
    const rowIdCustomer = firstNumericLike(row, ["id_customer", "customer_id", "id"]);
    const rowEmail = normalizeEmail(firstNonEmpty(row, ["email", "email_address", "customer_email"]));

    const matchByIdCustomer = Boolean(normalizedIdCustomer && rowIdCustomer && normalizedIdCustomer === rowIdCustomer);
    const matchByEmail = Boolean(normalizedEmail && rowEmail && normalizedEmail === rowEmail);
    if (!matchByIdCustomer && !matchByEmail) continue;

    const sourceRecordId: string | number | null =
      scalarId(row.id_customer) ?? scalarId(row.customer_id) ?? scalarId(row.id) ?? rowIdCustomer ?? rowEmail;
    const matchedBy = matchByIdCustomer ? "id_customer" : "email";
    const identityType: CustomerIdentityType = matchByIdCustomer ? "prestashop_customer_id" : "email";
    const identityValue = matchByIdCustomer ? rowIdCustomer : rowEmail;
    const customerKey = buildCustomerKeyFromPrestaShopCustomer(rowIdCustomer ?? normalizedIdCustomer) ?? buildCandidateKey("prestashop:email", rowEmail ?? normalizedEmail);
    const confidence: CustomerIdentityConfidence = "high";

    observations.push(
      makeObservation({
        source: "prestashop",
        table: "ps_customer",
        sourceRecordId,
        matchedBy,
        identityType,
        identityValue,
        confidence,
        customerKey,
        notes: ["High-confidence partial source matched in ps_customer."],
        timelineSeed: buildPrestaShopTimelineSeed("prestashop", sourceRecordId, matchedBy, confidence)
      })
    );
  }

  return {
    source: "prestashop",
    table: "ps_customer",
    observations,
    warnings: query.warnings
  };
}

export async function readPrestashopAddressCandidate(input: CustomerIdentityResolutionInput): Promise<CustomerSourceReaderResult> {
  const normalizedIdCustomer = normalizeIdentityValue("prestashop_customer_id", input.idCustomer);
  const normalizedPhone = normalizePhoneChile(input.phone);
  const normalizedWaId = normalizeWaId(input.waId);
  const phoneCandidates = buildPhoneCandidates(input.phone);
  const waIdPhoneCandidates = buildPhoneCandidates(input.waId);

  const terms: QueryTerm[] = [
    { value: normalizedIdCustomer, columns: ["id_customer", "customer_id"] },
    { value: normalizedPhone, columns: ["phone", "phone_mobile", "mobile"] },
    { value: normalizedWaId, columns: ["phone", "phone_mobile", "mobile"] }
  ];

  for (const candidate of phoneCandidates) {
    terms.push({ value: candidate, columns: ["phone", "phone_mobile", "mobile"] });
  }
  for (const candidate of waIdPhoneCandidates) {
    terms.push({ value: candidate, columns: ["phone", "phone_mobile", "mobile"] });
  }

  const query = await queryTableRows("ps_address", "prestashop", terms, 20);
  const observations: CustomerSourceObservation[] = [];

  for (const row of query.rows) {
    const rowIdCustomer = firstNumericLike(row, ["id_customer", "customer_id"]);
    const rowPhone = normalizePhoneChile(firstNonEmpty(row, ["phone", "phone_mobile", "mobile", "phone_number"]));
    const rowEmail = normalizeEmail(firstNonEmpty(row, ["email"]));
    const matchByIdCustomer = Boolean(normalizedIdCustomer && rowIdCustomer && normalizedIdCustomer === rowIdCustomer);
    const matchByPhone = Boolean(
      rowPhone &&
        (normalizedPhone === rowPhone ||
          normalizedWaId === rowPhone ||
          phoneCandidates.includes(rowPhone) ||
          waIdPhoneCandidates.includes(rowPhone))
    );

    if (!matchByIdCustomer && !matchByPhone) continue;

    const sourceRecordId: string | number | null =
      scalarId(row.id_address) ?? scalarId(row.id) ?? rowIdCustomer ?? rowPhone;
    const matchedBy = matchByIdCustomer ? "id_customer" : "phone_normalized";
    const identityType: CustomerIdentityType = matchByIdCustomer ? "prestashop_customer_id" : "phone";
    const identityValue = matchByIdCustomer ? rowIdCustomer : rowPhone;
    const customerKey = buildCustomerKeyFromPrestaShopCustomer(rowIdCustomer ?? normalizedIdCustomer) ?? buildCandidateKey("candidate:phone", rowPhone ?? normalizedPhone ?? normalizedWaId);
    const confidence: CustomerIdentityConfidence = matchByIdCustomer ? "high" : "medium";

    observations.push(
      makeObservation({
        source: "prestashop",
        table: "ps_address",
        sourceRecordId,
        matchedBy,
        identityType,
        identityValue,
        confidence,
        customerKey,
        notes: [
          "High-confidence partial source through ps_address.",
          rowEmail ? `Address row also exposes email ${rowEmail}.` : "No email in address row."
        ],
        timelineSeed: buildPrestaShopTimelineSeed("prestashop", sourceRecordId, matchedBy, confidence)
      })
    );
  }

  return {
    source: "prestashop",
    table: "ps_address",
    observations,
    warnings: query.warnings
  };
}

export async function readPrestashopOrderCandidate(input: CustomerIdentityResolutionInput): Promise<CustomerSourceReaderResult> {
  const normalizedIdCustomer = normalizeIdentityValue("prestashop_customer_id", input.idCustomer);
  const normalizedIdOrder = normalizeIdentityValue("order_id", input.idOrder);
  const normalizedInvoiceNumber = normalizeIdentityValue("invoice_number", input.invoiceNumber);
  const normalizedEmail = normalizeEmail(input.email);

  const terms: QueryTerm[] = [
    { value: normalizedIdCustomer, columns: ["id_customer", "customer_id"] },
    { value: normalizedIdOrder, columns: ["id_order", "order_id", "reference", "order_reference"] },
    { value: normalizedInvoiceNumber, columns: ["invoice_number", "invoice_no", "invoice", "reference"] },
    { value: normalizedEmail, columns: ["email"], compare: "lowercase" }
  ];

  const query = await queryTableRows("ps_orders", "prestashop", terms, 20);
  const observations: CustomerSourceObservation[] = [];

  for (const row of query.rows) {
    const rowIdCustomer = firstNumericLike(row, ["id_customer", "customer_id"]);
    const rowOrderId = normalizeIdentityValue("order_id", firstNonEmpty(row, ["id_order", "order_id", "reference", "order_reference"]));
    const rowInvoiceNumber = normalizeIdentityValue("invoice_number", firstNonEmpty(row, ["invoice_number", "invoice_no", "invoice"]));
    const rowEmail = normalizeEmail(firstNonEmpty(row, ["email", "customer_email"]));

    const matchByIdCustomer = Boolean(normalizedIdCustomer && rowIdCustomer && normalizedIdCustomer === rowIdCustomer);
    const matchByOrder = Boolean(normalizedIdOrder && rowOrderId && normalizedIdOrder === rowOrderId);
    const matchByInvoice = Boolean(normalizedInvoiceNumber && rowInvoiceNumber && normalizedInvoiceNumber === rowInvoiceNumber);
    const matchByEmail = Boolean(normalizedEmail && rowEmail && normalizedEmail === rowEmail);

    if (!matchByIdCustomer && !matchByOrder && !matchByInvoice && !matchByEmail) continue;

    const sourceRecordId: string | number | null =
      scalarId(row.id_order) ?? scalarId(row.id) ?? rowOrderId ?? rowInvoiceNumber;
    const matchedBy = matchByIdCustomer
      ? "id_customer"
      : matchByOrder
        ? "id_order"
        : matchByInvoice
          ? "invoice_number"
          : "email";
    const identityType: CustomerIdentityType = matchByIdCustomer
      ? "prestashop_customer_id"
      : matchByOrder
        ? "order_id"
        : matchByInvoice
          ? "invoice_number"
          : "email";
    const identityValue = matchByIdCustomer
      ? rowIdCustomer
      : matchByOrder
        ? rowOrderId
        : matchByInvoice
          ? rowInvoiceNumber
          : rowEmail;
    const customerKey = buildCustomerKeyFromPrestaShopCustomer(rowIdCustomer ?? normalizedIdCustomer) ?? buildCustomerKeyFromOrder(rowOrderId ?? normalizedIdOrder) ?? buildCandidateKey("prestashop:invoice", rowInvoiceNumber ?? normalizedInvoiceNumber);
    const confidence: CustomerIdentityConfidence = matchByOrder || matchByInvoice ? "high" : "high";

    observations.push(
      makeObservation({
        source: "prestashop",
        table: "ps_orders",
        sourceRecordId,
        matchedBy,
        identityType,
        identityValue,
        confidence,
        customerKey,
        notes: [
          "Transactional high-confidence source from ps_orders.",
          rowIdCustomer ? `Linked to customer id ${rowIdCustomer}.` : "Order matched without customer id."
        ],
        timelineSeed: buildPrestaShopTimelineSeed("prestashop", sourceRecordId, matchedBy, confidence)
      })
    );
  }

  return {
    source: "prestashop",
    table: "ps_orders",
    observations,
    warnings: query.warnings
  };
}

export async function readLegacyConversationCandidate(input: CustomerIdentityResolutionInput): Promise<CustomerSourceReaderResult> {
  const normalizedConversationCaseId = cleanText(input.conversationCaseId);
  const normalizedIdCustomer = normalizeIdentityValue("prestashop_customer_id", input.idCustomer);
  const normalizedIdOrder = normalizeIdentityValue("order_id", input.idOrder);
  const normalizedInvoiceNumber = normalizeIdentityValue("invoice_number", input.invoiceNumber);
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedWaId = normalizeWaId(input.waId);
  const normalizedPhone = normalizePhoneChile(input.phone);
  const phoneCandidates = buildPhoneCandidates(input.phone);
  const waIdCandidates = buildPhoneCandidates(input.waId);

  const terms: QueryTerm[] = [
    { value: normalizedConversationCaseId, columns: ["conversation_case_id", "case_id", "id"] },
    { value: normalizedIdCustomer, columns: ["id_customer", "customer_id"] },
    { value: normalizedIdOrder, columns: ["id_order", "order_id"] },
    { value: normalizedInvoiceNumber, columns: ["invoice_number", "invoice_no", "invoice"] },
    { value: normalizedEmail, columns: ["email"], compare: "lowercase" },
    { value: normalizedWaId, columns: ["wa_id"] },
    { value: normalizedPhone, columns: ["phone", "phone_normalized"] }
  ];

  for (const candidate of phoneCandidates) {
    terms.push({ value: candidate, columns: ["phone", "phone_normalized"] });
  }
  for (const candidate of waIdCandidates) {
    terms.push({ value: candidate, columns: ["phone", "phone_normalized", "wa_id"] });
  }

  const query = await queryTableRows("n8n_conversation_cases", "n8n", terms, 20);
  const observations: CustomerSourceObservation[] = [];

  for (const row of query.rows) {
    const rowCaseId = cleanText(row.conversation_case_id ?? row.case_id ?? row.id);
    const rowIdCustomer = firstNumericLike(row, ["id_customer", "customer_id"]);
    const rowIdOrder = normalizeIdentityValue("order_id", firstNonEmpty(row, ["id_order", "order_id"]));
    const rowInvoiceNumber = normalizeIdentityValue("invoice_number", firstNonEmpty(row, ["invoice_number", "invoice_no", "invoice"]));
    const rowEmail = normalizeEmail(firstNonEmpty(row, ["email", "customer_email"]));
    const rowWaId = normalizeWaId(firstNonEmpty(row, ["wa_id"]));
    const rowPhone = normalizePhoneChile(firstNonEmpty(row, ["phone", "phone_normalized", "phone_number"]));

    const matchByCase = Boolean(normalizedConversationCaseId && rowCaseId && normalizedConversationCaseId === rowCaseId);
    const matchByCustomer = Boolean(normalizedIdCustomer && rowIdCustomer && normalizedIdCustomer === rowIdCustomer);
    const matchByOrder = Boolean(normalizedIdOrder && rowIdOrder && normalizedIdOrder === rowIdOrder);
    const matchByInvoice = Boolean(normalizedInvoiceNumber && rowInvoiceNumber && normalizedInvoiceNumber === rowInvoiceNumber);
    const matchByEmail = Boolean(normalizedEmail && rowEmail && normalizedEmail === rowEmail);
    const matchByWaId = Boolean(normalizedWaId && rowWaId && normalizedWaId === rowWaId);
    const matchByPhone = Boolean(normalizedPhone && rowPhone && normalizedPhone === rowPhone);

    if (!matchByCase && !matchByCustomer && !matchByOrder && !matchByInvoice && !matchByEmail && !matchByWaId && !matchByPhone) continue;

    const sourceRecordId: string | number | null =
      scalarId(row.id) ?? rowCaseId ?? rowWaId ?? rowPhone;
    const matchedBy = matchByCase
      ? "conversation_case_id"
      : matchByCustomer
        ? "id_customer"
        : matchByOrder
          ? "id_order"
          : matchByInvoice
            ? "invoice_number"
            : matchByEmail
              ? "email"
              : matchByWaId
                ? "wa_id"
                : "phone_normalized";
    const identityType: CustomerIdentityType | null = matchByCustomer
      ? "prestashop_customer_id"
      : matchByOrder
        ? "order_id"
        : matchByInvoice
          ? "invoice_number"
          : matchByEmail
            ? "email"
            : matchByWaId
              ? "wa_id"
              : matchByPhone
                ? "phone"
                : null;
    const identityValue = matchByCustomer
      ? rowIdCustomer
      : matchByOrder
        ? rowIdOrder
        : matchByInvoice
          ? rowInvoiceNumber
          : matchByEmail
            ? rowEmail
            : matchByWaId
              ? rowWaId
              : matchByPhone
                ? rowPhone
                : null;
    const customerKey =
      buildCustomerKeyFromPrestaShopCustomer(rowIdCustomer ?? normalizedIdCustomer) ??
      buildCustomerKeyFromOrder(rowIdOrder ?? normalizedIdOrder) ??
      buildCandidateKey("candidate:legacy-case", rowCaseId ?? normalizedConversationCaseId) ??
      buildCandidateKey("candidate:wa_id", rowWaId ?? normalizedWaId) ??
      buildCandidateKey("candidate:phone", rowPhone ?? normalizedPhone);

    const confidence: CustomerIdentityConfidence = matchByCase || matchByCustomer || matchByOrder || matchByInvoice ? "medium" : "low";

    observations.push(
      makeObservation({
        source: "n8n",
        table: "n8n_conversation_cases",
        sourceRecordId,
        matchedBy,
        identityType,
        identityValue,
        confidence,
        customerKey,
        notes: [
          "Legacy transitional case source.",
          rowEmail ? `Case row exposes email ${rowEmail}.` : "No email in legacy case row."
        ],
        timelineSeed: buildLegacyTimelineSeed("n8n", "conversation_case_id", sourceRecordId, matchedBy, confidence)
      })
    );
  }

  return {
    source: "n8n",
    table: "n8n_conversation_cases",
    observations,
    warnings: query.warnings
  };
}

export async function readLegacyInboundCandidate(input: CustomerIdentityResolutionInput): Promise<CustomerSourceReaderResult> {
  const normalizedMessageId = cleanText(input.messageId);
  const normalizedWaId = normalizeWaId(input.waId);
  const normalizedPhone = normalizePhoneChile(input.phone);
  const normalizedIdCustomer = normalizeIdentityValue("prestashop_customer_id", input.idCustomer);
  const normalizedIdOrder = normalizeIdentityValue("order_id", input.idOrder);
  const normalizedInvoiceNumber = normalizeIdentityValue("invoice_number", input.invoiceNumber);
  const normalizedEmail = normalizeEmail(input.email);
  const phoneCandidates = buildPhoneCandidates(input.phone);
  const waIdCandidates = buildPhoneCandidates(input.waId);

  const messageTerms: QueryTerm[] = [
    { value: normalizedMessageId, columns: ["message_id", "provider_message_id", "wa_message_id"] },
    { value: normalizedWaId, columns: ["wa_id"] },
    { value: normalizedPhone, columns: ["phone", "phone_normalized"] },
    { value: normalizedIdCustomer, columns: ["id_customer", "customer_id"] },
    { value: normalizedIdOrder, columns: ["id_order", "order_id"] },
    { value: normalizedInvoiceNumber, columns: ["invoice_number", "invoice_no", "invoice"] },
    { value: normalizedEmail, columns: ["email"], compare: "lowercase" }
  ];

  for (const candidate of phoneCandidates) {
    messageTerms.push({ value: candidate, columns: ["phone", "phone_normalized"] });
  }
  for (const candidate of waIdCandidates) {
    messageTerms.push({ value: candidate, columns: ["wa_id", "phone", "phone_normalized"] });
  }

  const [inboundQuery, messageQuery] = await Promise.all([
    queryTableRows("n8n_wa_inbound_messages", "n8n", messageTerms, 20),
    queryTableRows("n8n_conversation_messages", "n8n", messageTerms, 20)
  ]);

  const observations: CustomerSourceObservation[] = [];

  for (const [tableName, query] of [
    ["n8n_wa_inbound_messages", inboundQuery],
    ["n8n_conversation_messages", messageQuery]
  ] as const) {
    for (const row of query.rows) {
      const rowMessageId = cleanText(row.message_id ?? row.provider_message_id ?? row.wa_message_id ?? row.id);
      const rowWaId = normalizeWaId(firstNonEmpty(row, ["wa_id"]));
      const rowPhone = normalizePhoneChile(firstNonEmpty(row, ["phone", "phone_normalized", "phone_number"]));
      const rowIdCustomer = firstNumericLike(row, ["id_customer", "customer_id"]);
      const rowIdOrder = normalizeIdentityValue("order_id", firstNonEmpty(row, ["id_order", "order_id"]));
      const rowInvoiceNumber = normalizeIdentityValue("invoice_number", firstNonEmpty(row, ["invoice_number", "invoice_no", "invoice"]));
      const rowEmail = normalizeEmail(firstNonEmpty(row, ["email", "customer_email"]));

      const matchByMessage = Boolean(normalizedMessageId && rowMessageId && normalizedMessageId === rowMessageId);
      const matchByWaId = Boolean(normalizedWaId && rowWaId && normalizedWaId === rowWaId);
      const matchByPhone = Boolean(normalizedPhone && rowPhone && normalizedPhone === rowPhone);
      const matchByCustomer = Boolean(normalizedIdCustomer && rowIdCustomer && normalizedIdCustomer === rowIdCustomer);
      const matchByOrder = Boolean(normalizedIdOrder && rowIdOrder && normalizedIdOrder === rowIdOrder);
      const matchByInvoice = Boolean(normalizedInvoiceNumber && rowInvoiceNumber && normalizedInvoiceNumber === rowInvoiceNumber);
      const matchByEmail = Boolean(normalizedEmail && rowEmail && normalizedEmail === rowEmail);

      if (!matchByMessage && !matchByWaId && !matchByPhone && !matchByCustomer && !matchByOrder && !matchByInvoice && !matchByEmail) {
        continue;
      }

      const sourceRecordId: string | number | null =
        scalarId(row.id) ?? rowMessageId ?? rowWaId ?? rowPhone;
      const matchedBy = matchByMessage
        ? "message_id"
        : matchByWaId
          ? "wa_id"
          : matchByPhone
            ? "phone_normalized"
            : matchByCustomer
              ? "id_customer"
              : matchByOrder
                ? "id_order"
                : matchByInvoice
                  ? "invoice_number"
                  : "email";
      const identityType: CustomerIdentityType | null = matchByWaId
        ? "wa_id"
        : matchByPhone
          ? "phone"
          : matchByCustomer
            ? "prestashop_customer_id"
            : matchByOrder
              ? "order_id"
              : matchByInvoice
                ? "invoice_number"
                : matchByEmail
                  ? "email"
                  : null;
      const identityValue = matchByWaId
        ? rowWaId
        : matchByPhone
          ? rowPhone
          : matchByCustomer
            ? rowIdCustomer
            : matchByOrder
              ? rowIdOrder
              : matchByInvoice
                ? rowInvoiceNumber
                : matchByEmail
                  ? rowEmail
                  : null;
      const customerKey =
        buildCustomerKeyFromPrestaShopCustomer(rowIdCustomer ?? normalizedIdCustomer) ??
        buildCustomerKeyFromOrder(rowIdOrder ?? normalizedIdOrder) ??
        buildCandidateKey("candidate:n8n:message", rowMessageId ?? normalizedMessageId) ??
        buildCandidateKey("candidate:n8n:wa_id", rowWaId ?? normalizedWaId) ??
        buildCandidateKey("candidate:n8n:phone", rowPhone ?? normalizedPhone);
      const confidence: CustomerIdentityConfidence = matchByMessage || matchByCustomer || matchByOrder || matchByInvoice ? "medium" : "low";

      observations.push(
        makeObservation({
          source: "n8n",
          table: tableName,
          sourceRecordId,
          matchedBy,
          identityType,
          identityValue,
          confidence,
          customerKey,
          notes: [`Legacy inbound source from ${tableName}.`],
          timelineSeed: buildLegacyTimelineSeed("n8n", "message_id", sourceRecordId, matchedBy, confidence)
        })
      );
    }
  }

  return {
    source: "n8n",
    table: "n8n_wa_inbound_messages",
    observations,
    warnings: [...inboundQuery.warnings, ...messageQuery.warnings]
  };
}
