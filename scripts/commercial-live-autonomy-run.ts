import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { processInbound } from "../lib/brain/processInbound";
import { maskWaId } from "../lib/brain/commercial/autonomy-sandbox";
import { loadEnvFile, loadLocalEnv, PROJECT_ROOT } from "./db-utils";

type CliOptions = {
  message: string;
  waId: string;
  phoneNumberId: string;
  caseId: string;
  runs: number;
  concurrency: number;
  timeoutMs: number;
  source: "manual_test" | "system_job";
};

const DEFAULT_MESSAGE = "Hola, quiero una recomendacion para armar un home gym y necesito saber que conviene comprar primero.";
const DEFAULT_WA_ID = "56912345678";
const DEFAULT_PHONE_NUMBER_ID = "phone-live-autonomy";
const DEFAULT_CASE_ID = "4821";

function readArg(name: string) {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : null;
}

function readIntArg(name: string, fallback: number) {
  const raw = readArg(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptions(): CliOptions {
  const source = readArg("source");
  return {
    message: readArg("message") ?? DEFAULT_MESSAGE,
    waId: readArg("wa-id") ?? DEFAULT_WA_ID,
    phoneNumberId: readArg("phone-number-id") ?? DEFAULT_PHONE_NUMBER_ID,
    caseId: readArg("case-id") ?? DEFAULT_CASE_ID,
    runs: readIntArg("runs", 1),
    concurrency: Math.min(readIntArg("concurrency", 1), 10),
    timeoutMs: Math.max(readIntArg("timeout-ms", 45000), 1000),
    source: source === "system_job" ? "system_job" : "manual_test"
  };
}

async function loadRuntimeEnv() {
  await loadLocalEnv();
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env.local"), false);
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env"), false);

  const defaults: Record<string, string> = {
    BRAIN_ENABLE_REAL_MODEL: "true",
    BRAIN_SALES_AGENT_ENABLED: "true",
    BRAIN_SALES_AGENT_DRY_RUN: "false",
    BRAIN_COMMERCIAL_SHADOW_ENABLED: "true",
    BRAIN_COMMERCIAL_RUNTIME_ENABLED: "true",
    BRAIN_COMMERCIAL_POLICY_ENABLED: "true",
    BRAIN_COMMERCIAL_SHADOW_TIMEOUT_MS: "60000",
    BRAIN_COMMERCIAL_CONTEXT_TIMEOUT_MS: "5000",
    BRAIN_COMMERCIAL_RUNTIME_TIMEOUT_MS: "45000",
    BRAIN_COMMERCIAL_POLICY_TIMEOUT_MS: "5000",
    BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER: "true",
    BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "true",
    BRAIN_COMMERCIAL_AUTONOMY_AFTER_CONSULTATIVE_ENABLED: "true",
    BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED: "true",
    BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
    BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true",
    BRAIN_AUTONOMOUS_SANDBOX_ENABLED: "true",
    BRAIN_AUTONOMOUS_REPLY_ENABLED: "true",
    BRAIN_EXECUTION_GATE_ENABLED: "true",
    BRAIN_OUTBOX_BRIDGE_ENABLED: "true",
    BRAIN_EXECUTION_GATE_SANDBOX_REQUIRED: "false"
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

function buildInboundRequest(options: CliOptions, index: number) {
  const now = new Date().toISOString();
  const suffix = `${Date.now()}-${index}-${randomUUID().slice(0, 8)}`;
  return {
    channel: "whatsapp",
    source: options.source,
    contextMode: "standard",
    waId: options.waId,
    phoneNumberId: options.phoneNumberId,
    messageId: `live-autonomy-${suffix}`,
    messageText: options.message,
    conversationCaseId: options.caseId,
    customerRef: {
      waId: options.waId,
      phoneNumberId: options.phoneNumberId
    },
    options: {
      dryRun: false,
      executeActions: false,
      returnInstructionsForN8n: true,
      debug: false,
      runAgentDryRun: false,
      buildExecutionPlanDryRun: false
    },
    receivedAt: now,
    sourceWorkflow: "commercial-live-autonomy-run",
    sourceNode: "cli",
    metadata: {
      runner: "commercial-live-autonomy-run",
      runIndex: index
    }
  };
}

function compactWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).slice(0, 10);
}

function summarizeResult(index: number, result: Awaited<ReturnType<typeof processInbound>>, durationMs: number) {
  const shadow = result.adapters.commercialShadow;
  const loop = result.adapters.commercialOperationalLoop;
  const bridge = result.adapters.commercialExecutionBridge;

  return {
    index,
    ok: result.ok,
    requestId: result.requestId,
    durationMs,
    waIdMasked: maskWaId(result.context?.waId ?? null),
    suggestedNextStep: result.suggested_next_step,
    commercial: {
      shadowStatus: shadow?.status ?? null,
      shadowDisposition: shadow?.executionDisposition ?? null,
      shadowErrorCode: shadow?.error?.code ?? null,
      shadowErrorMessage: shadow?.error?.message ?? null,
      shadowWarnings: shadow?.warnings?.slice(0, 10) ?? [],
      operationalLoopStatus: loop?.status ?? null,
      operationalLoopWarnings: loop?.warnings?.slice(0, 10) ?? [],
      persistenceStatus: loop?.persistenceResult?.status ?? null,
      persistenceReason: loop?.persistenceResult?.reason ?? null,
      opportunityWritten: loop?.sideEffects.commercialOpportunityWritten ?? false,
      decisionWritten: loop?.sideEffects.commercialDecisionWritten ?? false,
      nextActionType: loop?.selectedNextAction?.type ?? null,
      decisionStatus: loop?.decisionRecord?.decisionStatus ?? null,
      bridgeStatus: bridge?.status ?? null,
      bridgeWarnings: bridge?.warnings?.slice(0, 10) ?? [],
      bridgeError: bridge?.error ?? null,
      actionPersistenceStatus: bridge?.actionPersistence?.status ?? null,
      actionPersistenceError: bridge?.actionPersistence?.error ?? null,
      queuedActionType: bridge?.action?.actionType ?? null,
      actionStatus: bridge?.action?.status ?? null,
      outboxWritten: bridge?.sideEffects.outboxWritten ?? false,
      messageSent: bridge?.sideEffects.messageSent ?? false
    },
    warnings: compactWarnings(result.warnings),
    errors: result.errors.map((error) => ({
      code: error.code,
      retryable: error.retryable,
      message: error.message
    }))
  };
}

async function runOne(options: CliOptions, index: number) {
  const started = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(`Runner timeout after ${options.timeoutMs}ms.`));
    }, options.timeoutMs);
  });
  try {
    const result = await Promise.race([
      processInbound(buildInboundRequest(options, index), started, {
        abortSignal: controller.signal
      }),
      timeout
    ]);
    return summarizeResult(index, result, Date.now() - started);
  } catch (error) {
    return {
      index,
      ok: false,
      requestId: null,
      durationMs: Date.now() - started,
      waIdMasked: maskWaId(options.waId),
      suggestedNextStep: null,
      commercial: {
        shadowStatus: timedOut || controller.signal.aborted ? "aborted_by_runner_timeout" : "runner_failed",
        shadowDisposition: null,
        shadowErrorCode: error instanceof Error ? error.name : "unknown_error",
        shadowErrorMessage: error instanceof Error ? error.message : String(error),
        shadowWarnings: [],
        operationalLoopStatus: null,
        operationalLoopWarnings: [],
        persistenceStatus: null,
        persistenceReason: null,
        opportunityWritten: false,
        decisionWritten: false,
        nextActionType: null,
        decisionStatus: null,
        bridgeStatus: null,
        bridgeWarnings: [],
        bridgeError: null,
        actionPersistenceStatus: null,
        actionPersistenceError: null,
        queuedActionType: null,
        actionStatus: null,
        outboxWritten: false,
        messageSent: false
      },
      warnings: timedOut || controller.signal.aborted ? ["runner_timeout"] : [],
      errors: [
        {
          code: "UNHANDLED_ERROR",
          retryable: true,
          message: error instanceof Error ? error.message : String(error)
        }
      ]
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function runPool<T>(items: number[], concurrency: number, worker: (item: number) => Promise<T>) {
  const results: T[] = [];
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      results.push(await worker(item));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
  return results;
}

export async function main() {
  await loadRuntimeEnv();
  const options = parseOptions();

  if (!process.env.BRAIN_MODEL_API_KEY) {
    throw new Error("Missing BRAIN_MODEL_API_KEY. Add it to .env before running live autonomy.");
  }
  if (!process.env.BRAIN_MODEL_API_URL) {
    throw new Error("Missing BRAIN_MODEL_API_URL. Add the OpenAI-compatible endpoint to .env.");
  }
  if (!process.env.BRAIN_MODEL_NAME) {
    throw new Error("Missing BRAIN_MODEL_NAME. Add the model name to .env.");
  }

  const indexes = Array.from({ length: options.runs }, (_, index) => index + 1);
  const started = Date.now();
  const results = await runPool(indexes, options.concurrency, (index) => runOne(options, index));
  const failed = results.filter((result) => !result.ok || result.errors.length > 0).length;

  console.log(
    JSON.stringify(
      {
        runner: "commercial-live-autonomy-run",
        runs: options.runs,
        concurrency: options.concurrency,
        timeoutMs: options.timeoutMs,
        elapsedMs: Date.now() - started,
        model: process.env.BRAIN_MODEL_NAME,
        endpointConfigured: Boolean(process.env.BRAIN_MODEL_API_URL),
        waIdMasked: maskWaId(options.waId),
        failed,
        results
      },
      null,
      2
    )
  );

  if (failed > 0) process.exitCode = 1;
}

const isDirectRun = process.argv[1] ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) : false;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => {
      process.exit(process.exitCode ?? 0);
    });
}
