/**
 * autonomous-runtime-backlog-report
 *
 * SALES-AGENT-R2-A11, Part 3/59/60/61. Read-only report of the CURRENT due
 * CommercialWork retry backlog and due follow-up backlog, before an operator
 * flips BRAIN_COMMERCIAL_WORK_WORKER_ENABLED / BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ENABLED
 * for the first time - so a stale historical backlog is never blindly
 * executed the moment either worker turns on. NO MUTATIONS: never claims,
 * never sends, never writes - reuses the exact same due-selection queries
 * the real workers use (selectDueCommercialWorkSteps / selectDueFollowUps),
 * then classifies each row's eligibility with the exact same gate functions
 * runCommercialWorkTick/runFollowupTick apply, without ever calling either
 * tick function itself.
 *
 * Usage:
 *   npm run backlog:report
 *   npm run backlog:report -- --limit=500
 */

import path from "node:path";
import { loadLocalEnv, loadEnvFile, PROJECT_ROOT } from "./db-utils";
import {
  loadAutonomousResponsesEnabled,
  loadWhatsAppAccessGateConfig,
  isWaIdAllowedByAccessGate,
  loadCommercialWorkWorkerEnabled,
  loadCommercialWorkFollowUpEnabled,
  loadCommercialWorkWorkerActivationCutoff,
  loadCommercialWorkFollowUpActivationCutoff,
  isBeforeActivationCutoff
} from "../lib/brain/runtime/autonomousRuntimeConfig";
import { shouldRouteToCommercialWork } from "../lib/brain/commercial/config/commercialCycleConfig";

const DEFAULT_LIMIT = 1000;

function readIntArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(2).find((v) => v.startsWith(prefix));
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw.slice(prefix.length), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function loadRuntimeEnv() {
  await loadLocalEnv();
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env.local"), false);
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env"), false);
}

function ageMs(createdAt: string | null | undefined, now: number): number | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  return Number.isNaN(t) ? null : now - t;
}

function formatAge(ms: number | null): string {
  if (ms === null) return "unknown";
  const days = ms / 86_400_000;
  if (days >= 1) return `${days.toFixed(1)}d`;
  const hours = ms / 3_600_000;
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

async function main() {
  await loadRuntimeEnv();
  const limit = readIntArg("limit", DEFAULT_LIMIT);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const autonomyEnabled = loadAutonomousResponsesEnabled();
  const accessGate = loadWhatsAppAccessGateConfig();
  const workerEnabled = loadCommercialWorkWorkerEnabled();
  const followUpEnabled = loadCommercialWorkFollowUpEnabled();
  const workerCutoff = loadCommercialWorkWorkerActivationCutoff();
  const followUpCutoff = loadCommercialWorkFollowUpActivationCutoff();

  const { selectDueCommercialWorkSteps } = await import("../lib/brain/commercial/work/worker/commercialWorkWorker");
  const { selectDueFollowUps, isObjectiveAwareFollowUpPayload } = await import("../lib/brain/commercial/followup/runFollowupTick");

  const dueSteps = await selectDueCommercialWorkSteps({ limit, now: nowIso });
  const dueFollowUps = await selectDueFollowUps(limit);

  const stepAges = dueSteps.map((s) => ageMs(s.work_created_at, now)).filter((a): a is number => a !== null);
  const stepEligible = dueSteps.filter((s) => {
    if (!autonomyEnabled) return false;
    if (!isWaIdAllowedByAccessGate(s.wa_id, accessGate)) return false;
    if (!shouldRouteToCommercialWork(s.wa_id)) return false;
    if (isBeforeActivationCutoff(s.work_created_at, workerCutoff)) return false;
    return true;
  });

  const legacyFollowUps = dueFollowUps.filter((f) => !isObjectiveAwareFollowUpPayload(f.draft_payload_json));
  const r2FollowUps = dueFollowUps.filter((f) => isObjectiveAwareFollowUpPayload(f.draft_payload_json));
  const followUpAges = dueFollowUps.map((f) => ageMs(f.created_at, now)).filter((a): a is number => a !== null);
  const r2FollowUpEligible = r2FollowUps.filter((f) => {
    if (!autonomyEnabled) return false;
    if (!isWaIdAllowedByAccessGate(f.wa_id, accessGate)) return false;
    if (!followUpEnabled) return false;
    if (!shouldRouteToCommercialWork(f.wa_id)) return false;
    if (isBeforeActivationCutoff(f.created_at, followUpCutoff)) return false;
    return true;
  });
  const legacyFollowUpEligible = legacyFollowUps.filter((f) => isWaIdAllowedByAccessGate(f.wa_id, accessGate) && autonomyEnabled);

  const report = {
    generatedAt: nowIso,
    config: {
      autonomousResponsesEnabled: autonomyEnabled,
      whatsAppTestModeEnabled: accessGate.testModeEnabled,
      whatsAppTestWaIdCount: accessGate.testWaIds.length,
      commercialWorkWorkerEnabled: workerEnabled,
      commercialWorkFollowUpEnabled: followUpEnabled,
      commercialWorkWorkerActivationCutoff: workerCutoff,
      commercialWorkFollowUpActivationCutoff: followUpCutoff
    },
    commercialWorkRetryBacklog: {
      dueCount: dueSteps.length,
      // Note: limited to `limit` rows - a count at the cap means the real
      // backlog may be larger; re-run with --limit raised to see the rest.
      limitReached: dueSteps.length >= limit,
      oldestAge: formatAge(stepAges.length ? Math.max(...stepAges) : null),
      newestAge: formatAge(stepAges.length ? Math.min(...stepAges) : null),
      currentlyEligibleIfWorkerEnabled: stepEligible.length,
      wouldBeBlockedByGates: dueSteps.length - stepEligible.length
    },
    followUpBacklog: {
      dueCount: dueFollowUps.length,
      limitReached: dueFollowUps.length >= limit,
      oldestAge: formatAge(followUpAges.length ? Math.max(...followUpAges) : null),
      newestAge: formatAge(followUpAges.length ? Math.min(...followUpAges) : null),
      legacy: { dueCount: legacyFollowUps.length, currentlyEligible: legacyFollowUpEligible.length },
      objectiveAware: { dueCount: r2FollowUps.length, currentlyEligibleIfFollowUpEnabled: r2FollowUpEligible.length }
    },
    recommendation:
      stepAges.some((a) => a > 24 * 3_600_000) || followUpAges.some((a) => a > 24 * 3_600_000)
        ? "Backlog contains rows older than 24h - review before enabling the worker/follow-up flags, or set an activation cutoff (BRAIN_COMMERCIAL_WORK_WORKER_ACTIVATION_CUTOFF / BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ACTIVATION_CUTOFF) to skip everything created before now."
        : "No row older than 24h found in the sampled backlog."
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    // Always close the pool, success or failure - otherwise an open
    // keep-alive connection leaves the process hanging after a caught error.
    try {
      const { getPool } = await import("../lib/db");
      await getPool().end();
    } catch {
      // ignore
    }
  });
