import { resolveLiveBenchmarkProviderConfig } from "../liveProvider";
import type { LiveBenchmarkProviderConfig } from "../liveProvider";
import { applyBenchmarkE2EOverridesToLiveConfig, readBenchmarkE2EOverrides } from "../r3CommercialE2E/benchmarkOverrides";
import { resolveBenchmarkE2EFlags } from "../r3CommercialE2E/runCommercialE2ECase";
import type { BenchmarkE2EFlagsConfig } from "../r3CommercialE2E/types";
import { checkEnvironmentHealth } from "../r3CommercialE2E/environmentHealthPrecheck";
import type { BenchmarkE2EEnvironmentHealth } from "../r3CommercialE2E/types";
import { createContinuitySession, runContinuityTurn, teardownContinuitySession } from "./continuitySession";
import type { ContinuityConversationSession } from "./continuitySession";
import { buildContinuityStressPlans } from "./stressPlans/index";
import { buildCompactionEvents, buildFactLineage, checkCrossConversationIsolation, classifyTurnFailures, computeTurnInvariants } from "./continuityAnalysis";
import { buildProviderPayloadSnapshot } from "./toolSurfaceHash";
import type {
  ContinuityCompactionEvent,
  ContinuityConversationLabel,
  ContinuityFactLineageEntry,
  ContinuityFailureRecord,
  ContinuityProviderPayloadSnapshot,
  ContinuityTurnTrace,
  ContinuityPlannedTurn
} from "./types";
import { CONTINUITY_CONVERSATION_LABELS, CONTINUITY_CONVERSATION_PERSONAS } from "./types";

/**
 * P7.13 orchestration - the interleaved 5-conversation driver (task sections
 * 10-11/44-45). Round-robin A,B,C,D,E, never one conversation fully before
 * another starts. Stops early only on a HARD invariant failure (cross-
 * conversation leak, structural selection corruption) or when maxTurns/
 * maxWallClockMs is hit (smoke mode) - never on a behavioral finding
 * (re-question, false-success, etc.), per task section 45.
 */

export type ContinuityAuditRunInput = {
  mode: "smoke" | "main";
  maxTurnsPerConversation?: number;
  maxWallClockMs: number;
  onTurnFinished?: (input: { turn: ContinuityTurnTrace; plan: ContinuityPlannedTurn; index: number; total: number }) => void;
};

export type ContinuityAuditRunResult = {
  ok: true;
  benchmarkRunId: string;
  wallClockMs: number;
  flags: BenchmarkE2EFlagsConfig;
  liveConfig: LiveBenchmarkProviderConfig;
  environmentHealth: BenchmarkE2EEnvironmentHealth;
  plans: Record<ContinuityConversationLabel, ContinuityPlannedTurn[]>;
  turnsByConversation: Record<ContinuityConversationLabel, ContinuityTurnTrace[]>;
  allTurns: ContinuityTurnTrace[];
  factLineage: ContinuityFactLineageEntry[];
  compactionEvents: ContinuityCompactionEvent[];
  failures: ContinuityFailureRecord[];
  providerPayloadSnapshots: ContinuityProviderPayloadSnapshot[];
  planExhausted: boolean;
};

export type ContinuityAuditBlockedResult = { ok: false; environmentHealth: BenchmarkE2EEnvironmentHealth };

const PROVIDER_PAYLOAD_SNAPSHOT_DEPTHS = [10, 25, 50, 100, 150, 200];

export async function runContinuityAudit(input: ContinuityAuditRunInput): Promise<ContinuityAuditRunResult | ContinuityAuditBlockedResult> {
  // corpusRequiresQuote=false: this sandbox has no reachable Quote Service
  // (QUOTE_SERVICE_BASE_URL/QUOTE_SERVICE_AUTH_TOKEN unset - see
  // docs/audits/r3-p7-13-continuity-vulnerability-degradation.md readiness
  // report). Quote-related turns still run: get_quote/create_quote will hit
  // a real, bounded Gateway rejection (executeGovernedCapability's own
  // retry/timeout, never a hang) instead of being pre-blocked - that
  // rejection is itself valid continuity data, not a reason to refuse the
  // whole run.
  const environmentHealth = await checkEnvironmentHealth({ mode: "live", corpusRequiresQuote: false });
  if (environmentHealth.status === "BLOCKED") return { ok: false, environmentHealth };

  const liveResolution = resolveLiveBenchmarkProviderConfig();
  if (!liveResolution.ok) throw new Error(`live provider config unresolved: ${liveResolution.reason}`);
  const liveConfig = applyBenchmarkE2EOverridesToLiveConfig(liveResolution.config, readBenchmarkE2EOverrides());
  const flags = resolveBenchmarkE2EFlags();

  const benchmarkRunId = `p7-13-${new Date().toISOString().replace(/[:.]/g, "-")}-${input.mode}`;
  const plans = buildContinuityStressPlans();
  const maxLocalIndex = input.maxTurnsPerConversation ?? Math.max(...Object.values(plans).map((plan) => plan.length));

  const sessions: Record<ContinuityConversationLabel, ContinuityConversationSession> = {} as Record<ContinuityConversationLabel, ContinuityConversationSession>;
  for (const label of CONTINUITY_CONVERSATION_LABELS) {
    sessions[label] = await createContinuitySession({ label, benchmarkRunId, flags, liveConfig });
  }

  const isolationCheck = checkCrossConversationIsolation(
    CONTINUITY_CONVERSATION_LABELS.map((label) => ({ label, opportunityId: sessions[label].env.opportunityId, conversationId: sessions[label].env.conversationId, waId: sessions[label].env.waId }))
  );
  if (!isolationCheck.ok) throw new Error(`HARD_FAILURE crossConversationIsolation at setup: ${isolationCheck.detail}`);

  const turnsByConversation: Record<ContinuityConversationLabel, ContinuityTurnTrace[]> = { A: [], B: [], C: [], D: [], E: [] };
  const allTurns: ContinuityTurnTrace[] = [];
  const providerPayloadSnapshots: ContinuityProviderPayloadSnapshot[] = [];
  const startedAt = Date.now();
  let planExhausted = true;
  let globalTurnIndex = 0;

  outer: for (let localIndex = 0; localIndex < maxLocalIndex; localIndex += 1) {
    for (const label of CONTINUITY_CONVERSATION_LABELS) {
      const plan = plans[label];
      if (localIndex >= plan.length) continue;
      if (Date.now() - startedAt > input.maxWallClockMs) {
        planExhausted = false;
        break outer;
      }
      const plannedTurn = plan[localIndex];
      const session = sessions[label];
      const turn = await runContinuityTurn(session, plannedTurn, globalTurnIndex, liveConfig);

      const isolation = checkCrossConversationIsolation(
        CONTINUITY_CONVERSATION_LABELS.map((otherLabel) => ({ label: otherLabel, opportunityId: sessions[otherLabel].env.opportunityId, conversationId: sessions[otherLabel].env.conversationId, waId: sessions[otherLabel].env.waId }))
      );
      const invariants = [...computeTurnInvariants(turn), isolation];
      const mutatedTurn: ContinuityTurnTrace = { ...turn, invariantChecks: invariants };
      const hardFailure = invariants.find((check) => check.hard && !check.ok);
      if (hardFailure) {
        turnsByConversation[label].push(mutatedTurn);
        allTurns.push(mutatedTurn);
        throw new Error(`HARD_FAILURE ${hardFailure.name} at turn ${globalTurnIndex} (${label}${plannedTurn.localIndex}): ${hardFailure.detail}`);
      }

      turnsByConversation[label].push(mutatedTurn);
      allTurns.push(mutatedTurn);

      if (PROVIDER_PAYLOAD_SNAPSHOT_DEPTHS.includes(plannedTurn.localIndex) || turn.compactionHappenedThisTurn || turn.falseSuccessClaim || turn.regreeted) {
        const reason = turn.compactionHappenedThisTurn ? "compaction" : turn.falseSuccessClaim ? "false_success" : turn.regreeted ? "regreeting" : "scheduled_probe";
        providerPayloadSnapshots.push(buildProviderPayloadSnapshot({ turnIndex: globalTurnIndex, conversation: label, reason, providerCalls: turn.providerCalls, eligibleCapabilityNames: turn.eligibleCapabilityNames }));
      }

      input.onTurnFinished?.({ turn: mutatedTurn, plan: plannedTurn, index: globalTurnIndex, total: Object.values(plans).reduce((sum, p) => sum + Math.min(p.length, maxLocalIndex), 0) });
      globalTurnIndex += 1;
    }
  }

  for (const label of CONTINUITY_CONVERSATION_LABELS) await teardownContinuitySession(sessions[label]);

  const factLineage = CONTINUITY_CONVERSATION_LABELS.flatMap((label) => buildFactLineage(label, turnsByConversation[label]));
  const compactionEvents = CONTINUITY_CONVERSATION_LABELS.flatMap((label) => buildCompactionEvents(label, turnsByConversation[label]));
  const failures = allTurns.flatMap((turn) => {
    const plan = plans[turn.conversation][turn.localIndex];
    return classifyTurnFailures(turn, plan);
  });

  return {
    ok: true,
    benchmarkRunId,
    wallClockMs: Date.now() - startedAt,
    flags,
    liveConfig,
    environmentHealth,
    plans,
    turnsByConversation,
    allTurns,
    factLineage,
    compactionEvents,
    failures,
    providerPayloadSnapshots,
    planExhausted
  };
}

export { CONTINUITY_CONVERSATION_PERSONAS };
