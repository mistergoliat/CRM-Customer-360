import type {
  ContinuityCompactionEvent,
  ContinuityConversationLabel,
  ContinuityFactKey,
  ContinuityFactLineageEntry,
  ContinuityFailureRecord,
  ContinuityInvariantCheck,
  ContinuityPlannedTurn,
  ContinuityTurnTrace
} from "./types";
import { CONTINUITY_FACT_KEYS } from "./types";
import { extractProviderVisibleCommercialContext } from "./toolSurfaceHash";

/**
 * P7.13 post-hoc analysis over the captured ContinuityTurnTrace sequence -
 * never inline during capture (task section 47: "analysis order" runs after
 * completeness/invariants, capture stays a pure recorder). Every
 * classification here is deterministic/rule-based - no LLM judge as primary
 * signal (task section 9/28). Where the underlying signal is a text-keyword
 * heuristic (summary mention checks), that is stated explicitly in the
 * field/comment and such heuristics never alone produce a CRITICAL severity.
 */

// ---------------------------------------------------------------------------
// Fact lineage (task section 8)
// ---------------------------------------------------------------------------

const FACT_KEYWORDS: Record<ContinuityFactKey, readonly string[]> = {
  selection: ["classic", "pro", "unidad", "barra"],
  destination: ["ñuñoa", "nunoa", "las condes", "providencia"],
  shipping: ["envío", "envio", "despacho", "flete", "carrier"],
  quote: ["cotiz"],
  objective: []
};

function summaryMentionsFact(summaryText: string | null, factKey: ContinuityFactKey): boolean | null {
  if (factKey === "objective") return null;
  if (summaryText === null) return null;
  const normalized = summaryText.toLowerCase();
  return FACT_KEYWORDS[factKey].some((keyword) => normalized.includes(keyword));
}

function factPresent(value: unknown): boolean {
  return value !== null && value !== undefined;
}

function drmValueForFact(turn: ContinuityTurnTrace, factKey: ContinuityFactKey): unknown {
  const state = turn.durableStateAfterTurn;
  if (!state) return null;
  switch (factKey) {
    case "selection":
      return state.selection;
    case "destination":
      return state.destination;
    case "shipping":
      return state.shipping;
    case "quote":
      return state.quote;
    case "objective":
      return { workId: state.workId, workVersion: state.workVersion, workStatus: state.workStatus, objectiveType: state.objectiveType, objectiveStatus: state.objectiveStatus };
  }
}

function agentInputValueForFact(commercialContextJson: unknown, factKey: ContinuityFactKey): unknown {
  if (typeof commercialContextJson !== "object" || commercialContextJson === null) return undefined;
  const context = commercialContextJson as Record<string, unknown>;
  switch (factKey) {
    case "selection":
      return context.commercialLineItems ?? undefined;
    case "destination":
      return context.shippingDestination ?? undefined;
    case "shipping":
      // Confirmed absent from commercialContextSummary (audit section 1.6/3) - always undefined here by construction, not a capture bug.
      return undefined;
    case "quote":
      // Same as shipping - confirmed absent from the base snapshot payload.
      return undefined;
    case "objective":
      return { opportunityStatus: context.opportunityStatus, opportunityStage: context.opportunityStage, needProfile: context.needProfile };
  }
}

/**
 * P7.13-A section 5/7. Was a legacy-only ("last user message") extractor -
 * the exact bug that produced 26 false AGENT_INPUT_LOSS classifications
 * under harnessAlignedMessageModelEnabled=true (the readiness report's
 * section 7 finding). Now delegates to the shared, dual-mode extractor
 * (toolSurfaceHash.ts) instead of duplicating extraction logic here.
 */
function extractCommercialContext(turn: ContinuityTurnTrace): unknown {
  return extractProviderVisibleCommercialContext(turn.providerCalls).commercialContextJson;
}

export function buildFactLineage(conversation: ContinuityConversationLabel, turns: readonly ContinuityTurnTrace[]): ContinuityFactLineageEntry[] {
  const entries: ContinuityFactLineageEntry[] = [];
  const originTurn: Partial<Record<ContinuityFactKey, number>> = {};
  for (const turn of turns) {
    const commercialContextJson = extractCommercialContext(turn);
    for (const factKey of CONTINUITY_FACT_KEYS) {
      const currentTruth = turn.durableFactsAfter[factKey];
      if (originTurn[factKey] === undefined && factPresent(currentTruth)) originTurn[factKey] = turn.turnIndex;
      entries.push({
        turnIndex: turn.turnIndex,
        conversation,
        factKey,
        originTurn: originTurn[factKey] ?? null,
        currentTruth,
        durableFactId: null,
        drmValue: drmValueForFact(turn, factKey),
        agentInputValue: agentInputValueForFact(commercialContextJson, factKey),
        providerVisibleValue: agentInputValueForFact(commercialContextJson, factKey),
        summaryMentionsFact: summaryMentionsFact(turn.sessionAfter.compactedPrefixText, factKey)
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Compaction events (task sections 19-21)
// ---------------------------------------------------------------------------

export function buildCompactionEvents(conversation: ContinuityConversationLabel, turns: readonly ContinuityTurnTrace[]): ContinuityCompactionEvent[] {
  const events: ContinuityCompactionEvent[] = [];
  let compactionIndex = 0;
  for (const turn of turns) {
    if (!turn.compactionHappenedThisTurn) continue;
    const factsKnownBefore: Record<ContinuityFactKey, unknown> = {} as Record<ContinuityFactKey, unknown>;
    const factsKnownAfter: Record<ContinuityFactKey, unknown> = {} as Record<ContinuityFactKey, unknown>;
    const factLost: ContinuityFactKey[] = [];
    const factChanged: ContinuityFactKey[] = [];
    for (const factKey of CONTINUITY_FACT_KEYS) {
      const before = summaryMentionsFact(turn.sessionBefore.compactedPrefixText, factKey);
      const after = summaryMentionsFact(turn.sessionAfter.compactedPrefixText, factKey);
      factsKnownBefore[factKey] = before;
      factsKnownAfter[factKey] = after;
      const factCurrentlyDurable = factPresent(turn.durableFactsAfter[factKey]);
      if (factCurrentlyDurable && before === true && after === false) factLost.push(factKey);
    }
    events.push({
      turnIndex: turn.turnIndex,
      conversation,
      compactionIndex,
      preCompactedThroughSeq: turn.sessionBefore.compactedThroughSeq,
      postCompactedThroughSeq: turn.sessionAfter.compactedThroughSeq,
      summaryTextLengthBefore: turn.sessionBefore.compactedPrefixTextLength,
      summaryTextLengthAfter: turn.sessionAfter.compactedPrefixTextLength,
      factsKnownBefore,
      factsKnownAfter,
      factLost,
      factChanged
    });
    compactionIndex += 1;
  }
  return events;
}

// ---------------------------------------------------------------------------
// Invariants (task section 36) + cross-conversation isolation
// ---------------------------------------------------------------------------

const KNOWN_PRODUCT_IDS = new Set(["31", "32"]);

export function computeTurnInvariants(turn: ContinuityTurnTrace): ContinuityInvariantCheck[] {
  const checks: ContinuityInvariantCheck[] = [];

  const items = turn.durableStateAfterTurn?.selection?.items ?? [];
  const seen = new Set<string>();
  let structurallyValid = true;
  let detail: string | null = null;
  for (const item of items) {
    if (!KNOWN_PRODUCT_IDS.has(item.productId) || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      structurallyValid = false;
      detail = `invalid line item: ${JSON.stringify(item)}`;
      break;
    }
    if (seen.has(item.productId)) {
      structurallyValid = false;
      detail = `duplicate productId ${item.productId}`;
      break;
    }
    seen.add(item.productId);
  }
  checks.push({ name: "validSelectionStructure", ok: structurallyValid, hard: true, detail });

  const drmDestination = turn.durableStateAfterTurn?.destination ?? null;
  const sourceDestination = turn.durableFactsAfter.destination as { communeId?: number } | null;
  const destinationConsistent =
    !drmDestination?.present || !sourceDestination ? true : drmDestination.communeId === (sourceDestination.communeId ?? null);
  checks.push({
    name: "durableToDrmDestinationConsistency",
    ok: destinationConsistent,
    hard: false,
    detail: destinationConsistent ? null : `DRM communeId=${drmDestination?.communeId} vs source=${sourceDestination?.communeId}`
  });

  return checks;
}

export function checkCrossConversationIsolation(
  sessions: readonly { label: ContinuityConversationLabel; opportunityId: number; conversationId: number; waId: string }[]
): ContinuityInvariantCheck {
  const opportunityIds = sessions.map((session) => session.opportunityId);
  const conversationIds = sessions.map((session) => session.conversationId);
  const waIds = sessions.map((session) => session.waId);
  const unique = (values: readonly (string | number)[]) => new Set(values).size === values.length;
  const ok = unique(opportunityIds) && unique(conversationIds) && unique(waIds);
  return { name: "crossConversationIsolation", ok, hard: true, detail: ok ? null : "duplicate fixture id across conversations" };
}

// ---------------------------------------------------------------------------
// Failure taxonomy + root-cause attribution (task sections 9/39)
// ---------------------------------------------------------------------------

function pushFailure(
  failures: ContinuityFailureRecord[],
  turn: ContinuityTurnTrace,
  category: ContinuityFailureRecord["category"],
  rootCauseLayer: ContinuityFailureRecord["rootCauseLayer"],
  severity: ContinuityFailureRecord["severity"],
  detail: string,
  factKey: ContinuityFactKey | null = null
): void {
  failures.push({ turnIndex: turn.turnIndex, conversation: turn.conversation, category, rootCauseLayer, severity, detail, factKey, compactionIndexAtFailure: turn.compactionGenerationBefore });
}

export function classifyTurnFailures(turn: ContinuityTurnTrace, plannedTurn: ContinuityPlannedTurn): ContinuityFailureRecord[] {
  const failures: ContinuityFailureRecord[] = [];

  if (turn.falseSuccessClaim) {
    pushFailure(failures, turn, "FALSE_SUCCESS_CLAIM", "MODEL_POLICY", "CRITICAL", "Response claims a durable mutation with no backing tool call this turn.");
  }

  if (turn.regreeted) {
    pushFailure(failures, turn, "REGREETING", "PROMPT_ASSEMBLY", "IMPORTANT", "Assistant re-opened with a greeting mid-conversation.");
  }

  if (plannedTurn.expectedMutation !== "NONE" && plannedTurn.expectedMutation !== "KEEP" && turn.toolCalls.length === 0 && !plannedTurn.allowClarification) {
    pushFailure(failures, turn, "TOOL_POLICY_FAILURE", "MODEL_POLICY", "IMPORTANT", `Expected mutation ${plannedTurn.expectedMutation} produced no tool call.`);
  }

  for (const factKey of plannedTurn.factsThatMustSurvive) {
    const truth = turn.durableFactsAfter[factKey];
    if (!factPresent(truth)) {
      pushFailure(failures, turn, "SOURCE_FACT_MISSING", "DATA_SOURCE", "CRITICAL", `Fact "${factKey}" expected to survive but is absent from durable truth.`, factKey);
      continue;
    }
    const providerValue = agentInputValueForFact(extractCommercialContext(turn), factKey);
    if (factKey === "selection" || factKey === "destination") {
      if (providerValue === undefined || providerValue === null) {
        pushFailure(failures, turn, "AGENT_INPUT_LOSS", "AGENT_INPUT", "IMPORTANT", `Fact "${factKey}" is durable but absent from the provider-visible commercialContext this turn.`, factKey);
      }
    }
  }

  if (plannedTurn.probe?.probeType === "RE_QUESTION" && turn.missingFactKind !== null) {
    pushFailure(
      failures,
      turn,
      "MODEL_REASKED_VISIBLE_FACT",
      "MODEL_POLICY",
      "IMPORTANT",
      `Model re-asked for a fact ("${turn.missingFactKind}") that was already current per the probe setup.`,
      plannedTurn.probe.targetFactKey ?? null
    );
  }

  if (plannedTurn.probe?.probeType === "OBJECTIVE_SURVIVAL" && turn.durableStateAfterTurn?.objectiveType === null) {
    pushFailure(failures, turn, "OBJECTIVE_RESET", "COMMERCIAL_WORK", "IMPORTANT", "No active objective survived the casual-detour probe sequence.");
  }

  return failures;
}
