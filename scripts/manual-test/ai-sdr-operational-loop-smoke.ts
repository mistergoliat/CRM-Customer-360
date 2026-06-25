import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPool, queryRows } from "../../lib/db";
import { runCommercialShadowEvaluation } from "../../lib/brain/commercial/shadow/runCommercialShadowEvaluation";
import { runCommercialOperationalLoop } from "../../lib/brain/commercial/operational-loop/runCommercialOperationalLoop";
import type { CommercialOperationalLoopFeatureFlags, CommercialOperationalLoopInput } from "../../lib/brain/commercial/operational-loop";
import { FIXED_CLOCK, FIXED_TIME, makeCommercialShadowInput, makeNormalizedInboundMessage } from "../../tests/commercial/fixtures";

type Mode = "precheck" | "dry-run" | "persist" | "idempotency";

type CliOptions = {
  mode: Mode;
  confirmPersist: boolean;
  json: boolean;
};

const SMOKE_WA_ID = "56900000001";
const SMOKE_PHONE_NUMBER_ID = "1030337916832905";
const SMOKE_MESSAGE_ID = "smoke-ai-sdr-001";
const SMOKE_MESSAGE_TEXT = "Hola, quiero cotizar una banca para entrenar en casa";
const SMOKE_CONVERSATION_CASE_ID = 99000001;
const SMOKE_CORRELATION_ID = "smoke-ai-sdr-loop-correlation-001";
const SMOKE_PROCESS_INBOUND_RUN_ID = "smoke-ai-sdr-loop-process-001";
const SMOKE_EXECUTION_ID = "smoke-ai-sdr-loop-exec-001";

function parseArgs(argv: string[]): CliOptions {
  const result: CliOptions = {
    mode: "precheck",
    confirmPersist: false,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--json") {
      result.json = true;
      continue;
    }

    if (arg.startsWith("--mode=")) {
      const mode = arg.slice("--mode=".length) as Mode;
      if (mode === "precheck" || mode === "dry-run" || mode === "persist" || mode === "idempotency") {
        result.mode = mode;
      }
      continue;
    }

    if (arg === "--mode" && argv[index + 1]) {
      const mode = argv[index + 1] as Mode;
      if (mode === "precheck" || mode === "dry-run" || mode === "persist" || mode === "idempotency") {
        result.mode = mode;
      }
      index += 1;
      continue;
    }

    if (arg === "--confirm-persist" && argv[index + 1]) {
      result.confirmPersist = argv[index + 1].toUpperCase() === "YES";
      index += 1;
      continue;
    }

    if (arg.startsWith("--confirm-persist=")) {
      result.confirmPersist = arg.slice("--confirm-persist=".length).toUpperCase() === "YES";
      continue;
    }
  }

  return result;
}

function loadEnvFile(relativePath: string) {
  const fullPath = resolve(process.cwd(), relativePath);
  if (!existsSync(fullPath)) return;

  const contents = readFileSync(fullPath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = line.slice(0, eqIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function loadEnv() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");
}

function printSection(title: string) {
  console.log(`\n## ${title}`);
}

async function safeCountRows(tableName: string) {
  try {
    const rows = await queryRows<Record<string, unknown>>(`SELECT COUNT(*) AS count FROM \`${tableName}\``);
    const first = rows[0] ?? {};
    return Number(first.count ?? 0);
  } catch {
    return null;
  }
}

async function tableColumns(tableName: string) {
  try {
    const rows = await queryRows<{ Field: string }>(`DESCRIBE \`${tableName}\``);
    return rows.map((row) => row.Field);
  } catch {
    return [];
  }
}

let poolClosed = false;

async function closePoolOnce() {
  if (poolClosed) return;
  poolClosed = true;
  try {
    await getPool().end();
  } catch {
    // ignore shutdown errors in manual smoke tooling
  }
}

async function printPrecheck() {
  printSection("Precheck SQL");
  console.log(`USE main_management;\n\nSHOW TABLES LIKE 'crm_%';\nDESCRIBE crm_opportunities;\nDESCRIBE crm_agent_decisions;`);

  printSection("Table presence");
  const [opportunitiesColumns, decisionsColumns, opportunitiesCount, decisionsCount, outboxCount] = await Promise.all([
    tableColumns("crm_opportunities"),
    tableColumns("crm_agent_decisions"),
    safeCountRows("crm_opportunities"),
    safeCountRows("crm_agent_decisions"),
    safeCountRows("brain_message_outbox")
  ]);

  console.log(
    JSON.stringify(
      {
        crm_opportunities_exists: opportunitiesColumns.length > 0,
        crm_agent_decisions_exists: decisionsColumns.length > 0,
        opportunities_columns: opportunitiesColumns,
        decisions_columns: decisionsColumns,
        opportunities_count: opportunitiesCount,
        decisions_count: decisionsCount,
        outbox_count: outboxCount
      },
      null,
      2
    )
  );
}

function buildSmokeShadowInput() {
  const inboundMessage = makeNormalizedInboundMessage({
    source: "manual_test",
    waId: SMOKE_WA_ID,
    phoneNumberId: SMOKE_PHONE_NUMBER_ID,
    messageId: SMOKE_MESSAGE_ID,
    messageText: SMOKE_MESSAGE_TEXT,
    conversationCaseId: SMOKE_CONVERSATION_CASE_ID,
    receivedAt: FIXED_TIME,
    metadata: {
      smokeTest: true
    }
  });

  return makeCommercialShadowInput({
    inboundMessage,
    correlationId: SMOKE_CORRELATION_ID,
    executionId: SMOKE_EXECUTION_ID,
    currentTime: FIXED_TIME,
    metadata: {
      smokeTest: true
    }
  });
}

function buildLoopInput(
  shadowResult: Awaited<ReturnType<typeof runCommercialShadowEvaluation>>,
  featureFlags: CommercialOperationalLoopFeatureFlags
): CommercialOperationalLoopInput {
  if (!shadowResult.context) {
    throw new Error("Commercial shadow result is missing operational context.");
  }

  return {
    inboundMessage: shadowResult.context.inboundMessage,
    brainContext: shadowResult.context.brainContext,
    commercialContext: shadowResult.context.commercialContext ?? null,
    salesAgentResult: shadowResult.context.runtimeResult?.result ?? null,
    commercialPolicyResult: shadowResult.context.policyResult ?? null,
    commercialEvaluationResult: null,
    commercialShadowResult: shadowResult,
    currentTime: FIXED_TIME,
    correlationId: SMOKE_CORRELATION_ID,
    processInboundRunId: SMOKE_PROCESS_INBOUND_RUN_ID,
    salesAgentRunId: shadowResult.context.runtimeResult?.result?.runId ?? null,
    featureFlags,
    mode: "shadow",
    contractVersion: shadowResult.versions.contractVersion,
    policyVersion: shadowResult.versions.policyVersion,
    runtimeVersion: shadowResult.versions.runtimeVersion,
    promptVersion: shadowResult.versions.promptVersion,
    evaluationVersion: null,
    metadata: {
      smokeTest: true,
      mode: featureFlags.commercialStatePersistenceEnabled ? "persist" : "dry_run"
    },
    abortSignal: null,
    clock: FIXED_CLOCK
  };
}

async function runLoop(mode: Mode, featureFlags: CommercialOperationalLoopFeatureFlags) {
  const before = await Promise.all([
    safeCountRows("crm_opportunities"),
    safeCountRows("crm_agent_decisions"),
    safeCountRows("brain_message_outbox")
  ]);

  const shadowResult = await runCommercialShadowEvaluation(buildSmokeShadowInput());
  const loopResult = await runCommercialOperationalLoop(buildLoopInput(shadowResult, featureFlags));

  const after = await Promise.all([
    safeCountRows("crm_opportunities"),
    safeCountRows("crm_agent_decisions"),
    safeCountRows("brain_message_outbox")
  ]);

  const summary = {
    mode,
    commercial_shadow_status: shadowResult.status,
    commercial_shadow_policy_status: shadowResult.policySummary?.status ?? null,
    commercial_shadow_runtime_status: shadowResult.runtimeSummary?.status ?? null,
    commercial_operational_result_status: loopResult.status,
    continueLegacyFlow: loopResult.continueLegacyFlow,
    selectedNextAction: loopResult.selectedNextAction?.type ?? null,
    nextActionExecutable: loopResult.selectedNextAction?.executable ?? null,
    persistenceStatus: loopResult.persistenceResult?.status ?? null,
    persistenceWritten: {
      opportunity: loopResult.persistenceResult?.opportunityWritten ?? false,
      decision: loopResult.persistenceResult?.decisionWritten ?? false
    },
    sideEffects: loopResult.sideEffects,
    counts: {
      opportunities_before: before[0],
      opportunities_after: after[0],
      decisions_before: before[1],
      decisions_after: after[1],
      outbox_before: before[2],
      outbox_after: after[2]
    }
  };

  if (!shadowResult.context) {
    throw new Error("Shadow result did not include context.");
  }

  return { shadowResult, loopResult, summary };
}

async function printLoopChecklist(mode: Mode) {
  printSection("Operational checklist");
  console.log(
    [
      `mode=${mode}`,
      `outbound=false`,
      `tools=false`,
      `followup_scheduler=false`,
      `case_mutation=false`,
      `n8n=false`
    ].join("\n")
  );
}

async function main() {
  loadEnv();
  const options = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL && !process.env.DB_HOST && !process.env.DB_NAME) {
    throw new Error("Configura DATABASE_URL o DB_HOST/DB_NAME antes de ejecutar el smoke test.");
  }

  await printLoopChecklist(options.mode);

  if (options.mode === "precheck") {
    await printPrecheck();
    await closePoolOnce();
    return;
  }

  if (options.mode === "dry-run") {
    const disabledResult = await runCommercialOperationalLoop(
      buildLoopInput(await runCommercialShadowEvaluation(buildSmokeShadowInput()), {
        commercialOperationalLoopEnabled: false,
        commercialStatePersistenceEnabled: false
      })
    );
    const dryRunResult = await runLoop("dry-run", {
      commercialOperationalLoopEnabled: true,
      commercialStatePersistenceEnabled: false
    });

    console.log(
      JSON.stringify(
        {
          disabled: {
            status: disabledResult.status,
            continueLegacyFlow: disabledResult.continueLegacyFlow,
            sideEffects: disabledResult.sideEffects
          },
          dryRun: dryRunResult.summary
        },
        null,
        2
      )
    );
    await closePoolOnce();
    return;
  }

  if (!options.confirmPersist) {
    throw new Error("Persistencia bloqueada. Reintenta con --confirm-persist=YES.");
  }

  if (options.mode === "persist") {
    const result = await runLoop("persist", {
      commercialOperationalLoopEnabled: true,
      commercialStatePersistenceEnabled: true
    });
    console.log(JSON.stringify(result.summary, null, 2));
    await closePoolOnce();
    return;
  }

  if (options.mode === "idempotency") {
    const first = await runLoop("persist", {
      commercialOperationalLoopEnabled: true,
      commercialStatePersistenceEnabled: true
    });
    const second = await runLoop("persist", {
      commercialOperationalLoopEnabled: true,
      commercialStatePersistenceEnabled: true
    });
    console.log(
      JSON.stringify(
        {
          first: first.summary,
          second: second.summary,
          duplicateOpportunityKey: first.summary.counts.opportunities_after === second.summary.counts.opportunities_after,
          duplicateDecisionId: first.summary.counts.decisions_after === second.summary.counts.decisions_after
        },
        null,
        2
      )
    );
    await closePoolOnce();
    return;
  }

  throw new Error(`Modo no soportado: ${options.mode}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdr-operational-loop-smoke failed: ${message}`);
  process.exitCode = 1;
}).finally(async () => {
  await closePoolOnce();
});
