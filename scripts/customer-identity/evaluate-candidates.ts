import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { getColumns, safeQueryRows } from "../../lib/db";
import { resolveCustomerCandidate } from "../../lib/customer-identity/resolveCustomerCandidate";
import {
  readLegacyConversationCandidate,
  readLegacyInboundCandidate,
  readPrestashopAddressCandidate,
  readPrestashopCustomerCandidate,
  readPrestashopOrderCandidate,
} from "../../lib/customer-identity/sourceReaders";
import type {
  CustomerIdentityEvaluationCase,
  CustomerIdentityEvaluationCaseResult,
  CustomerIdentityEvaluationExpectedResolution,
  CustomerIdentityEvaluationReport,
  CustomerIdentityEvaluationTelemetry,
} from "../../lib/customer-identity/evaluation";
import {
  analyzeEvaluationCase,
  buildEvaluationCaseHash,
  buildExpectedCustomerReferenceHash,
  sanitizeReport,
  summarizeEvaluation,
} from "../../lib/customer-identity/evaluation";
import { normalizeEmail, normalizePhoneChile, normalizeWaId } from "../../lib/customer-identity/normalize";
import type { CustomerIdentitySource } from "../../lib/customer-identity/types";

type CliOptions = {
  demo: boolean;
  json: boolean;
  verbose: boolean;
  prepareReview: boolean;
  casesFile: string | null;
  casesJson: string | null;
  sampleMode: "demo" | "existing";
  limit: number;
};

type AnyRecord = Record<string, unknown>;

type PreparedReviewCase = {
  caseId: string;
  source: CustomerIdentitySource | "unknown";
  sourceCategories: string[];
  signals: {
    waId: boolean;
    email: boolean;
    phone: boolean;
    idCustomer: boolean;
    idOrder: boolean;
    invoiceNumber: boolean;
    conversationCaseId: boolean;
    messageId: boolean;
  };
  inputHash: string;
  reviewedByHuman: false;
  reviewNote: null;
  expectedResolution: null;
  expectedCustomerReference: null;
};

function shortHash(value: string) {
  return buildEvaluationCaseHash({ caseId: value });
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    demo: false,
    json: false,
    verbose: false,
    prepareReview: false,
    casesFile: null,
    casesJson: null,
    sampleMode: "demo",
    limit: 55,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--demo") {
      options.demo = true;
      options.sampleMode = "demo";
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }

    if (arg === "--prepare-review") {
      options.prepareReview = true;
      continue;
    }

    if (arg === "--cases" && argv[index + 1]) {
      options.casesFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--cases-json" && argv[index + 1]) {
      options.casesJson = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--sample-mode" && argv[index + 1]) {
      const value = argv[index + 1];
      options.sampleMode = value === "existing" ? "existing" : "demo";
      index += 1;
      continue;
    }

    if (arg === "--limit" && argv[index + 1]) {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = Math.floor(parsed);
      }
      index += 1;
      continue;
    }
  }

  if (!options.demo && !options.casesFile && !options.casesJson && options.sampleMode !== "existing") {
    options.demo = true;
  }

  return options;
}

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalar(value: unknown): string | number | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text.length > 0 ? text : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function scalarString(value: unknown): string | null {
  const valueOrNull = scalar(value);
  if (typeof valueOrNull === "string") return valueOrNull;
  if (typeof valueOrNull === "number") return String(valueOrNull);
  return null;
}

function buildCaseId(prefix: string, row: AnyRecord) {
  return `${prefix}:${shortHash(JSON.stringify(row))}`;
}

function rowToEvaluationCase(row: AnyRecord, prefix: string, source: CustomerIdentitySource): CustomerIdentityEvaluationCase {
  return {
    caseId: buildCaseId(prefix, row),
    source,
    waId: scalarString(row.wa_id ?? row.waId),
    email: scalarString(row.email),
    phone: scalarString(row.phone ?? row.phone_normalized ?? row.phone_number),
    idCustomer: scalar(row.id_customer ?? row.customer_id),
    idOrder: scalar(row.id_order ?? row.order_id),
    invoiceNumber: scalarString(row.invoice_number ?? row.invoice_no ?? row.invoice),
    conversationCaseId: scalar(row.conversation_case_id ?? row.case_id ?? row.id),
    messageId: scalarString(row.message_id ?? row.provider_message_id ?? row.wa_message_id ?? row.id_message),
  };
}

function buildSyntheticCustomerKey(input: CustomerIdentityEvaluationCase) {
  if (input.idCustomer !== null && input.idCustomer !== undefined && String(input.idCustomer).trim() !== "") {
    return `candidate:prestashop:${String(input.idCustomer).trim()}`;
  }

  const email = normalizeEmail(input.email);
  if (email) return `candidate:email:${email}`;

  const waId = normalizeWaId(input.waId);
  if (waId) return `candidate:wa_id:${waId}`;

  const phone = normalizePhoneChile(input.phone);
  if (phone) return `candidate:phone:${phone}`;

  const idOrder = input.idOrder !== null && input.idOrder !== undefined && String(input.idOrder).trim() !== "" ? String(input.idOrder).trim() : null;
  if (idOrder) return `candidate:order:${idOrder}`;

  const invoiceNumber = input.invoiceNumber ? String(input.invoiceNumber).trim() : null;
  if (invoiceNumber) return `candidate:invoice:${invoiceNumber}`;

  const conversationCaseId =
    input.conversationCaseId !== null && input.conversationCaseId !== undefined && String(input.conversationCaseId).trim() !== ""
      ? String(input.conversationCaseId).trim()
      : null;
  if (conversationCaseId) return `candidate:case:${conversationCaseId}`;

  const messageId = input.messageId ? String(input.messageId).trim() : null;
  if (messageId) return `candidate:message:${messageId}`;

  return null;
}

function buildExpectedSyntheticResolution(input: CustomerIdentityEvaluationCase) {
  const expectedCustomerReference = buildSyntheticCustomerKey(input);
  const matchedBy: CustomerIdentityEvaluationExpectedResolution["matchedBy"] = normalizeEmail(input.email)
    ? "email"
    : input.idCustomer !== null && input.idCustomer !== undefined && String(input.idCustomer).trim() !== ""
      ? "prestashop_customer_id"
      : input.idOrder !== null && input.idOrder !== undefined && String(input.idOrder).trim() !== ""
        ? "order_id"
        : input.invoiceNumber
          ? "invoice_number"
          : normalizePhoneChile(input.phone)
            ? "phone"
            : normalizeWaId(input.waId)
              ? "wa_id"
              : null;

  return {
    status: "created_provisional" as const,
    confidence: "medium" as const,
    matchedBy,
    readOnly: true,
    needsReview: false,
    expectedCustomerReference,
  };
}

function buildDemoCases(): CustomerIdentityEvaluationCase[] {
  const cases: CustomerIdentityEvaluationCase[] = [];

  const pushDemoCase = (fixture: CustomerIdentityEvaluationCase) => {
    const expected = buildExpectedSyntheticResolution(fixture);
    cases.push({
      ...fixture,
      reviewedByHuman: true,
      reviewNote: "Synthetic demo case for validator sanity-check.",
      expectedResolution: {
        status: expected.status,
        confidence: expected.confidence,
        matchedBy: expected.matchedBy,
        readOnly: expected.readOnly,
        needsReview: expected.needsReview,
      },
      expectedCustomerReference: expected.expectedCustomerReference,
    });
  };

  for (let index = 1; index <= 20; index += 1) {
    const number = String(index).padStart(3, "0");
    pushDemoCase({
      caseId: `demo-ecom-${number}`,
      source: "prestashop",
      sourceCategories: ["high-confidence-partial", "transactional"],
      email: `customer-${number}@demo.test`,
      phone: `56910${String(index).padStart(6, "0")}`,
      idCustomer: 10000 + index,
    });
  }

  for (let index = 1; index <= 10; index += 1) {
    const number = String(index).padStart(3, "0");
    pushDemoCase({
      caseId: `demo-wa-match-${number}`,
      source: "whatsapp",
      sourceCategories: ["engagement", "lead"],
      waId: `56922${String(index).padStart(7, "0")}`,
      phone: `+56 9 22 ${String(index).padStart(7, "0").slice(0, 3)} ${String(index).padStart(7, "0").slice(3)}`,
      messageId: `wamid.demo.match.${number}`,
    });
  }

  for (let index = 1; index <= 10; index += 1) {
    const number = String(index).padStart(3, "0");
    pushDemoCase({
      caseId: `demo-wa-no-match-${number}`,
      source: "whatsapp",
      sourceCategories: ["engagement", "lead"],
      waId: `56933${String(index).padStart(7, "0")}`,
      messageId: `wamid.demo.no.${number}`,
    });
  }

  for (let index = 1; index <= 5; index += 1) {
    const number = String(index).padStart(3, "0");
    pushDemoCase({
      caseId: `demo-multi-address-${number}`,
      source: "prestashop",
      sourceCategories: ["high-confidence-partial", "transactional"],
      email: `multi-${number}@demo.test`,
      phone: `56944${String(index).padStart(7, "0")}`,
      idCustomer: 20000 + index,
    });
  }

  for (let index = 1; index <= 5; index += 1) {
    const number = String(index).padStart(3, "0");
    pushDemoCase({
      caseId: `demo-malformed-phone-${number}`,
      source: "whatsapp",
      sourceCategories: ["engagement", "lead"],
      phone: `abc-${number}`,
      waId: `wa-${number}`,
      messageId: `wamid.demo.badphone.${number}`,
    });
  }

  for (let index = 1; index <= 5; index += 1) {
    const number = String(index).padStart(3, "0");
    pushDemoCase({
      caseId: `demo-conflict-${number}`,
      source: "n8n",
      sourceCategories: ["technical", "transitional"],
      waId: `56955${String(index).padStart(7, "0")}`,
      email: `conflict-${number}@demo.test`,
      phone: `56966${String(index).padStart(7, "0")}`,
      idCustomer: 30000 + index,
      idOrder: 40000 + index,
      invoiceNumber: `INV-${number}`,
      conversationCaseId: 50000 + index,
      messageId: `wamid.demo.conflict.${number}`,
    });
  }

  for (let index = 1; index <= 5; index += 1) {
    const number = String(index).padStart(3, "0");
    pushDemoCase({
      caseId: `demo-outside-prestashop-${number}`,
      source: "whatsapp",
      sourceCategories: ["engagement", "lead"],
      waId: `56977${String(index).padStart(7, "0")}`,
      email: `outside-${number}@demo.test`,
      messageId: `wamid.demo.outside.${number}`,
    });
  }

  return cases;
}

async function loadJsonCases(filePath: string): Promise<CustomerIdentityEvaluationCase[]> {
  const resolvedPath = resolvePath(filePath);
  const raw = await readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) return parsed.filter(isRecord) as CustomerIdentityEvaluationCase[];
  if (isRecord(parsed) && Array.isArray(parsed.cases)) return parsed.cases.filter(isRecord) as CustomerIdentityEvaluationCase[];
  throw new Error("JSON input must be an array or an object with a `cases` array.");
}

function getSourceCategories(source: CustomerIdentitySource | "unknown") {
  switch (source) {
    case "prestashop":
      return ["high-confidence-partial", "transactional"];
    case "whatsapp":
      return ["engagement", "lead"];
    case "n8n":
      return ["technical", "transitional"];
    case "hub_operator":
      return ["manual-trusted"];
    case "import":
      return ["manual-import"];
    case "brain":
      return ["system-internal"];
    case "mariadb":
      return ["technical", "transactional"];
    case "appsheet":
      return ["transitional", "contaminating"];
    case "unknown":
    default:
      return ["unknown"];
  }
}

function buildPreparedReviewCase(input: CustomerIdentityEvaluationCase): PreparedReviewCase {
  return {
    caseId: buildCaseId("review", {
      caseId: input.caseId ?? buildEvaluationCaseHash(input),
      source: input.source ?? "unknown",
      waId: input.waId ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      idCustomer: input.idCustomer ?? null,
      idOrder: input.idOrder ?? null,
      invoiceNumber: input.invoiceNumber ?? null,
      conversationCaseId: input.conversationCaseId ?? null,
      messageId: input.messageId ?? null,
    }),
    source: input.source ?? "unknown",
    sourceCategories: input.sourceCategories ?? getSourceCategories(input.source ?? "unknown"),
    signals: {
      waId: Boolean(input.waId),
      email: Boolean(input.email),
      phone: Boolean(input.phone),
      idCustomer: input.idCustomer !== null && input.idCustomer !== undefined && String(input.idCustomer).trim() !== "",
      idOrder: input.idOrder !== null && input.idOrder !== undefined && String(input.idOrder).trim() !== "",
      invoiceNumber: Boolean(input.invoiceNumber),
      conversationCaseId: input.conversationCaseId !== null && input.conversationCaseId !== undefined && String(input.conversationCaseId).trim() !== "",
      messageId: Boolean(input.messageId),
    },
    inputHash: buildEvaluationCaseHash(input),
    reviewedByHuman: false,
    reviewNote: null,
    expectedResolution: null,
    expectedCustomerReference: null,
  };
}

async function loadExistingSourceCases(limit: number): Promise<{ cases: CustomerIdentityEvaluationCase[]; warnings: string[] }> {
  const warnings: string[] = [];
  const perSource = Math.max(1, Math.floor(limit / 5));
  const cases: CustomerIdentityEvaluationCase[] = [];
  const tables = [
    { table: "ps_customer", source: "prestashop" as const, prefix: "ps_customer" },
    { table: "ps_orders", source: "prestashop" as const, prefix: "ps_orders" },
    { table: "n8n_wa_inbound_messages", source: "n8n" as const, prefix: "n8n_inbound" },
    { table: "n8n_conversation_cases", source: "n8n" as const, prefix: "n8n_cases" },
    { table: "n8n_conversation_messages", source: "n8n" as const, prefix: "n8n_messages" },
  ] as const;

  for (const entry of tables) {
    const columns = await getColumns(entry.table);
    if (columns.length === 0) {
      warnings.push(`table_not_found|${entry.source}|error|${entry.table}`);
      continue;
    }

    const result = await safeQueryRows<AnyRecord>(`SELECT * FROM \`${entry.table}\` LIMIT ?`, [perSource]);
    if (!result.ok) {
      warnings.push(`query_failed|${entry.source}|error|${entry.table}`);
      continue;
    }

    for (const row of result.rows) {
      cases.push(rowToEvaluationCase(row, entry.prefix, entry.source));
    }
  }

  return { cases: cases.slice(0, limit), warnings };
}

function measureEstimatedQueryCount(input: CustomerIdentityEvaluationCase) {
  let count = 0;
  if (input.email || input.idCustomer) count += 1; // ps_customer
  if (input.idCustomer || input.phone || input.waId) count += 1; // ps_address
  if (input.idCustomer || input.idOrder || input.invoiceNumber || input.email) count += 1; // ps_orders
  if (input.conversationCaseId || input.idCustomer || input.idOrder || input.invoiceNumber || input.email || input.waId || input.phone) count += 1; // n8n_conversation_cases
  if (input.messageId || input.waId || input.phone || input.idCustomer || input.idOrder || input.invoiceNumber || input.email) count += 2; // inbound + messages
  return count;
}

async function measureReaderTelemetry(input: CustomerIdentityEvaluationCase): Promise<CustomerIdentityEvaluationTelemetry> {
  const readerInput = {
    waId: input.waId ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    idCustomer: input.idCustomer ?? null,
    idOrder: input.idOrder ?? null,
    invoiceNumber: input.invoiceNumber ?? null,
    conversationCaseId: input.conversationCaseId ?? null,
    messageId: input.messageId ?? null,
    source: input.source ?? "unknown",
    options: {
      readOnly: true,
      allowProvisional: true,
      debug: false,
    },
  } satisfies Parameters<typeof resolveCustomerCandidate>[0];

  const readers = [
    ["prestashop_customer", readPrestashopCustomerCandidate],
    ["prestashop_address", readPrestashopAddressCandidate],
    ["prestashop_order", readPrestashopOrderCandidate],
    ["legacy_conversation", readLegacyConversationCandidate],
    ["legacy_inbound", readLegacyInboundCandidate],
  ] as const;

  const timings = await Promise.all(
    readers.map(async ([name, reader]) => {
      const start = Date.now();
      try {
        await reader(readerInput);
      } catch {
        // Reader errors are already surfaced via the main resolver path; telemetry only.
      }
      return [name, Date.now() - start] as const;
    })
  );

  return {
    readerLatencyMsByReader: Object.fromEntries(timings),
    estimatedReaderCount: readers.length,
    estimatedQueryCount: measureEstimatedQueryCount(input),
  };
}

async function evaluateCases(cases: CustomerIdentityEvaluationCase[], sampleMode: string) {
  const caseResults: CustomerIdentityEvaluationCaseResult[] = [];
  const errors: string[] = [];

  for (const input of cases) {
    const start = Date.now();
    try {
      const resolverInput = {
        waId: input.waId ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        idCustomer: input.idCustomer ?? null,
        idOrder: input.idOrder ?? null,
        invoiceNumber: input.invoiceNumber ?? null,
        conversationCaseId: input.conversationCaseId ?? null,
        messageId: input.messageId ?? null,
        source: input.source ?? "unknown",
        options: {
          readOnly: true,
          allowProvisional: true,
          debug: false,
        },
      } satisfies Parameters<typeof resolveCustomerCandidate>[0];

      const [result, telemetry] = await Promise.all([
        resolveCustomerCandidate(resolverInput),
        measureReaderTelemetry(input),
      ]);
      caseResults.push(analyzeEvaluationCase(input, result, Date.now() - start, telemetry));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const report = {
    summary: summarizeEvaluation(caseResults, { sampleMode, errors }),
    cases: caseResults,
  } satisfies CustomerIdentityEvaluationReport;

  return { report, errors };
}

function printSummary(report: CustomerIdentityEvaluationReport, warnings: string[]) {
  const summary = report.summary;
  const lines = [
    `sample_mode=${summary.sampleMode}`,
    `classification=${summary.classification}`,
    `total_cases=${summary.totalCases}`,
    `reviewed_cases=${summary.reviewedCases}`,
    `unreviewed_cases=${summary.unreviewedCases}`,
    `resolved_existing=${summary.resolvedExistingCount} (${(summary.resolvedExistingRate * 100).toFixed(1)}%)`,
    `linked_identity=${summary.linkedIdentityCount} (${(summary.linkedIdentityRate * 100).toFixed(1)}%)`,
    `created_provisional=${summary.createdProvisionalCount} (${(summary.createdProvisionalRate * 100).toFixed(1)}%)`,
    `conflict_needs_review=${summary.conflictNeedsReviewCount} (${(summary.conflictNeedsReviewRate * 100).toFixed(1)}%)`,
    `not_enough_identity=${summary.notEnoughIdentityCount} (${(summary.notEnoughIdentityRate * 100).toFixed(1)}%)`,
    `skipped_read_only=${summary.skippedReadOnlyCount} (${(summary.skippedReadOnlyRate * 100).toFixed(1)}%)`,
    `phone_normalization_success_rate=${(summary.phoneNormalizationSuccessRate * 100).toFixed(1)}%`,
    `average_latency_ms=${summary.averageLatencyMs.toFixed(1)}`,
    `p50_latency_ms=${summary.p50LatencyMs.toFixed(1)}`,
    `p95_latency_ms=${summary.p95LatencyMs.toFixed(1)}`,
    `max_latency_ms=${summary.maxLatencyMs.toFixed(1)}`,
    `average_reader_count=${summary.averageEstimatedReaderCount.toFixed(1)}`,
    `average_query_count=${summary.averageEstimatedQueryCount.toFixed(1)}`,
    `reviewed_exact_match_rate=${(summary.reviewedExactMatchRate * 100).toFixed(1)}%`,
    `reviewed_false_positive_rate=${(summary.reviewedFalsePositiveRate * 100).toFixed(1)}%`,
    `reviewed_false_negative_rate=${(summary.reviewedFalseNegativeRate * 100).toFixed(1)}%`,
    `reviewed_conflict_detection_accuracy=${summary.reviewedConflictDetectionAccuracy === null ? "n/a" : `${(summary.reviewedConflictDetectionAccuracy * 100).toFixed(1)}%`}`,
    `warning_messages=${summary.warningCount}`,
    `informational_messages=${summary.informationalCount}`,
    `error_messages=${summary.errorCount}`,
    `fatal_errors=${summary.fatalErrors}`,
  ];

  console.log(lines.join("\n"));
  if (warnings.length > 0) {
    console.log(`source_warnings=${warnings.length}`);
  }
}

async function buildReviewTemplate(limit: number) {
  let templateCases = buildDemoCases().slice(0, limit);
  const warnings: string[] = [];

  try {
    const sampled = await loadExistingSourceCases(limit);
    if (sampled.cases.length > 0) {
      templateCases = sampled.cases;
    }
    warnings.push(...sampled.warnings);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }

  const cases = templateCases.map(buildPreparedReviewCase);

  return {
    generatedAt: new Date().toISOString(),
    reviewedByHuman: false,
    limit,
    cases,
    warnings,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.prepareReview) {
    const template = await buildReviewTemplate(options.limit);
    console.log(JSON.stringify(template, null, 2));
    process.exitCode = 0;
    return;
  }

  let cases: CustomerIdentityEvaluationCase[] = [];
  const warnings: string[] = [];
  let sampleMode: string = options.sampleMode;

  if (options.casesFile) {
    cases = await loadJsonCases(options.casesFile);
    sampleMode = "file";
  } else if (options.casesJson) {
    const parsed = JSON.parse(options.casesJson) as unknown;
    if (Array.isArray(parsed)) {
      cases = parsed.filter(isRecord) as CustomerIdentityEvaluationCase[];
    } else if (isRecord(parsed) && Array.isArray(parsed.cases)) {
      cases = parsed.cases.filter(isRecord) as CustomerIdentityEvaluationCase[];
    } else {
      throw new Error("cases-json must be an array or an object with `cases`.");
    }
    sampleMode = "inline";
  } else if (options.sampleMode === "existing") {
    const sampled = await loadExistingSourceCases(options.limit);
    cases = sampled.cases;
    warnings.push(...sampled.warnings);
    sampleMode = "existing";
  } else {
    cases = buildDemoCases();
    sampleMode = "demo";
  }

  const { report, errors } = await evaluateCases(cases.slice(0, options.limit), sampleMode);
  const safeReport = sanitizeReport(report);

  if (options.json) {
    console.log(JSON.stringify({ report: safeReport, warnings, errors }, null, 2));
  } else {
    printSummary(report, warnings);
    if (options.verbose) {
      console.log(JSON.stringify({ report: safeReport, warnings, errors }, null, 2));
    }
  }

  process.exitCode = report.summary.classification === "fail" ? 1 : 0;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`customer-identity:evaluate failed: ${message}`);
  process.exitCode = 1;
});
