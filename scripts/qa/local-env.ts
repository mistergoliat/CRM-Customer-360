import { existsSync } from "node:fs";
import path from "node:path";
import { buildDatabaseUrl } from "../../lib/database-config";
import { loadEnvFile } from "../db-utils";

const WORKTREE_ROOT = process.cwd();
const SIBLING_REPO_ROOT = path.resolve(WORKTREE_ROOT, "..", "CRM-Customer-360");

function unique(values: string[]) {
  return [...new Set(values)];
}

async function loadIfPresent(filePath: string) {
  if (existsSync(filePath)) {
    await loadEnvFile(filePath, true);
  }
}

function copyEnv(sourceKey: string, targetKey: string) {
  const value = process.env[sourceKey];
  if (value !== undefined && value !== "") {
    process.env[targetKey] = value;
  }
}

function buildTestDatabaseUrl() {
  const host = process.env.TEST_DATABASE_HOST ?? process.env.DATABASE_HOST ?? process.env.DB_HOST;
  const port = Number(process.env.TEST_DATABASE_PORT ?? process.env.DATABASE_PORT ?? process.env.DB_PORT ?? 3306);
  const database = process.env.TEST_DATABASE_NAME ?? "crm_test";
  const user = process.env.TEST_DATABASE_USER ?? process.env.DATABASE_USER ?? process.env.DB_USER;
  const password = process.env.TEST_DATABASE_PASSWORD ?? process.env.DATABASE_PASSWORD ?? process.env.DB_PASSWORD;

  if (!host || !user || !password) {
    return null;
  }

  return buildDatabaseUrl({
    host,
    port: Number.isFinite(port) ? port : 3306,
    database,
    user,
    password
  });
}

export async function loadQualityGateEnv() {
  const candidateRoots = unique([WORKTREE_ROOT, SIBLING_REPO_ROOT].filter((value) => existsSync(value)) as string[]);

  for (const root of candidateRoots) {
    await loadIfPresent(path.resolve(root, ".env"));
    await loadIfPresent(path.resolve(root, "infra/.env"));
  }

  copyEnv("TEST_DATABASE_HOST", "DATABASE_HOST");
  copyEnv("TEST_DATABASE_PORT", "DATABASE_PORT");
  copyEnv("TEST_DATABASE_NAME", "DATABASE_NAME");
  copyEnv("TEST_DATABASE_USER", "DATABASE_USER");
  copyEnv("TEST_DATABASE_PASSWORD", "DATABASE_PASSWORD");
  copyEnv("TEST_DATABASE_URL", "DATABASE_URL");

  const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? buildTestDatabaseUrl();
  if (testDatabaseUrl) {
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.DB_URL = testDatabaseUrl;
  }

  Object.assign(process.env, {
    NODE_ENV: "test"
  });
  process.env.RUN_AUTONOMOUS_COMMERCE_QA = "1";
  process.env.DB_WRITE_ENABLED = "true";
  process.env.BRAIN_META_SEND_ENABLED = "false";
  process.env.BRAIN_OUTBOX_WORKER_ENABLED = "false";
  process.env.BRAIN_PERSIST_CANONICAL_OUTBOUND = "true";
  process.env.BRAIN_WHATSAPP_ALLOWED_WA_IDS = "";
  process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS = "";

  if (!process.env.META_WHATSAPP_APP_SECRET) {
    process.env.META_WHATSAPP_APP_SECRET = "qa-meta-app-secret";
  }
  if (!process.env.BRAIN_META_WHATSAPP_APP_SECRET) {
    process.env.BRAIN_META_WHATSAPP_APP_SECRET = process.env.META_WHATSAPP_APP_SECRET;
  }
  if (!process.env.META_WHATSAPP_VERIFY_TOKEN) {
    process.env.META_WHATSAPP_VERIFY_TOKEN = "qa-meta-verify-token";
  }
  if (!process.env.BRAIN_META_WHATSAPP_VERIFY_TOKEN) {
    process.env.BRAIN_META_WHATSAPP_VERIFY_TOKEN = process.env.META_WHATSAPP_VERIFY_TOKEN;
  }
}
