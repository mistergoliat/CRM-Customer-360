import assert from "node:assert/strict";
import test from "node:test";
import { resolveOpportunityIdentity } from "../../lib/brain/commercial/operational-loop/resolveOpportunityIdentity";
import { validateCommercialTransition } from "../../lib/brain/commercial/operational-loop/validateCommercialTransition";
import type { CommercialOperationalState } from "../../lib/brain/commercial/operational-loop/types";
import { makeBrainContextResolveResponse, makeNormalizedInboundMessage, FIXED_TIME } from "./fixtures";

/**
 * ACS-R1-05.1-T02: Stable Opportunity Continuity.
 *
 * Pure unit-level tests of resolveOpportunityIdentity - no DB, no HTTP. Each
 * test simulates one turn by handing it the candidate rows that would already
 * exist in crm_opportunities (frozen primaryIntent from creation - see
 * reduceCommercialState.ts, primaryIntent never changes after creation) and a
 * fresh per-turn service_code/intent hint, exactly as loadCommercialState /
 * resolveOpportunityIdentity receive them from the native runtime.
 */

function makeOperationalState(overrides: Partial<CommercialOperationalState> = {}): CommercialOperationalState {
  return {
    opportunityId: 1,
    opportunityKey: "opportunity:56912345678:product_inquiry:whatsapp:thread",
    customerCandidateId: null,
    customerMasterId: null,
    leadId: null,
    conversationCaseId: 4821,
    waId: "56912345678",
    channel: "whatsapp",
    primaryIntent: "product_inquiry",
    status: "engaged",
    stage: "discovery",
    temperature: "unknown",
    priority: "normal",
    currentSummary: null,
    requirements: [],
    missingRequirements: [],
    productInterests: [],
    objections: [],
    signals: [],
    lastCustomerMessageId: null,
    lastAgentDecisionId: null,
    waitingFor: null,
    nextActionType: null,
    nextActionDueAt: null,
    humanOwnerActive: false,
    aiBlocked: false,
    version: 1,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    lastActivityAt: FIXED_TIME,
    closedAt: null,
    previousDecision: null,
    ...overrides
  };
}

function buildIdentityInput(overrides: { serviceCode?: string; candidates?: CommercialOperationalState[]; conversationCaseId?: number }) {
  const conversationCaseId = overrides.conversationCaseId ?? 4821;
  const brainContext = makeBrainContextResolveResponse({
    case_context: {
      active_case: {
        conversation_case_id: conversationCaseId,
        active_case_key: "case-001",
        status: "open",
        lifecycle_status: "open",
        department: "ventas",
        service_code: overrides.serviceCode ?? "unknown",
        priority: "medium",
        requires_human: false,
        bot_replied: false,
        final_action: "continue",
        ai_blocked: false,
        wa_id: "56912345678",
        phone_number_id: "phone-001",
        id_order: 20001,
        id_customer: 10045,
        invoice_number: 30001,
        source_table: "n8n_cases",
        source_id: conversationCaseId,
        whatsapp_window_open: true,
        last_message_at: FIXED_TIME,
        created_at: FIXED_TIME,
        updated_at: FIXED_TIME,
        closed_at: null,
        raw_status: "open"
      },
      latest_case: null,
      open_cases: [],
      case_count: 1,
      waiting_human_case: false,
      closed_or_rejected_case: false,
      manual_operator_lock: false,
      last_case_status: "open",
      last_case_final_action: "continue"
    }
  });

  const commercialContext: any = {
    status: "complete",
    sourceSummary: {
      hasLatestCustomerMessage: true,
      hasLatestOutboundMessage: false,
      hasCustomerCandidate: false,
      hasCustomerReference: false,
      hasConversationHistory: false,
      hasCommercialEntity: false,
      orderContextAvailable: false,
      productServiceContextAvailable: false,
      humanOwnershipActive: false,
      aiBlocked: false,
      manualReplyActive: false,
      channel: "whatsapp",
      waId: "56912345678",
      conversationCaseId
    },
    salesAgentInput: null
  };

  return {
    inboundMessage: makeNormalizedInboundMessage({ conversationCaseId }),
    brainContext,
    commercialContext,
    loadResult: {
      status: "loaded" as const,
      candidates: overrides.candidates ?? [],
      activeState: null,
      latestDecision: null,
      warnings: [],
      metadata: {}
    },
    currentTime: FIXED_TIME,
    correlationId: "corr-continuity-001"
  };
}

test("continuity across a normal purchase sequence: product inquiry -> price -> stock -> objection(unknown) -> shipping reuses one opportunity", () => {
  // Turn 1: no candidates yet - a new opportunity is created (frozen at
  // product_inquiry per reduceCommercialState.ts's actual behavior).
  const turn1 = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "product", candidates: [] }));
  assert.equal(turn1.status, "create_new");

  const opportunity = makeOperationalState({ opportunityId: 1, opportunityKey: "opp-jaula-1", primaryIntent: "product_inquiry", status: "engaged" });

  // Turn 2: "cuanto cuesta" -> price_request, single existing candidate whose
  // frozen primaryIntent is still product_inquiry. Must reuse, not fragment.
  const turn2 = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "price", candidates: [opportunity] }));
  assert.equal(turn2.status, "continue_existing", `expected continuity, got ${turn2.status} (${turn2.reason})`);
  assert.equal(turn2.selectedOpportunityId, 1);
  assert.equal(turn2.opportunityKey, "opp-jaula-1");
  assert.equal(turn2.isAmbiguous, false);

  // Turn 3: "tiene stock" -> stock_request.
  const turn3 = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "stock", candidates: [opportunity] }));
  assert.equal(turn3.status, "continue_existing");
  assert.equal(turn3.selectedOpportunityId, 1);
  assert.equal(turn3.opportunityKey, "opp-jaula-1");

  // Turn 4: "esta muy cara" (objection) - no dedicated CommercialIntent value
  // exists for objections (see taxonomy in the audit), so this normalizes to
  // "unknown". Unknown already bypassed the filter before this task; still
  // must reuse.
  const turn4 = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "unknown", candidates: [opportunity] }));
  assert.equal(turn4.status, "continue_existing");
  assert.equal(turn4.selectedOpportunityId, 1);

  // Turn 5: "cuanto sale el despacho" -> delivery_request.
  const turn5 = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "delivery", candidates: [opportunity] }));
  assert.equal(turn5.status, "continue_existing");
  assert.equal(turn5.selectedOpportunityId, 1);
  assert.equal(turn5.opportunityKey, "opp-jaula-1");
});

test("complementary products for the same project stay one opportunity", () => {
  const opportunity = makeOperationalState({ opportunityId: 7, opportunityKey: "opp-jaula-7", primaryIntent: "product_inquiry", status: "engaged" });

  // "Tambien necesito una banca y discos para el mismo espacio" - still a
  // product_inquiry-shaped message, single active candidate for this identity.
  const result = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "product", candidates: [opportunity] }));

  assert.equal(result.status, "continue_existing");
  assert.equal(result.selectedOpportunityId, 7);
  assert.equal(result.opportunityKey, "opp-jaula-7");
});

test("a genuinely independent identity (different conversation) never merges into an unrelated active opportunity", () => {
  // "Ademas necesito equipar un gimnasio comercial en otra comuna" arriving on
  // a different conversation_case_id (a different channel/thread) must not
  // see the unrelated opportunity at all - buildCandidateWhereClause scopes
  // by identity before this function ever runs, so with no candidates passed
  // in (simulating that DB query returning nothing for the new identity) a
  // fresh opportunity is the only possible outcome.
  const result = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "equipment_project", candidates: [], conversationCaseId: 9999 }));

  assert.equal(result.status, "create_new");
  assert.equal(result.isNewOpportunity, true);
});

test("two active opportunities for the same identity: intent narrows to exactly one, unambiguous", () => {
  const quoteOpportunity = makeOperationalState({ opportunityId: 1, opportunityKey: "opp-quote", primaryIntent: "quote_request", status: "engaged" });
  const maintenanceOpportunity = makeOperationalState({ opportunityId: 2, opportunityKey: "opp-maintenance", primaryIntent: "maintenance_request", status: "engaged" });

  const resultForQuote = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "quote_requested", candidates: [quoteOpportunity, maintenanceOpportunity] }));
  assert.equal(resultForQuote.isAmbiguous, false);
  assert.equal(resultForQuote.status, "continue_existing");
  assert.equal(resultForQuote.selectedOpportunityId, 1);
});

test("ambiguity: two active opportunities and intent does not narrow them down - fail closed, no mutation, no third opportunity", () => {
  const first = makeOperationalState({ opportunityId: 1, opportunityKey: "opp-quote-1", primaryIntent: "quote_request", status: "engaged" });
  const second = makeOperationalState({ opportunityId: 2, opportunityKey: "opp-quote-2", primaryIntent: "quote_request", status: "engaged" });

  const result = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "quote_requested", candidates: [first, second] }));

  assert.equal(result.isAmbiguous, true);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.selectedOpportunityId, null);
  assert.equal(result.opportunityId, null);
});

test("ambiguity: unknown intent never silently picks among multiple active opportunities", () => {
  const first = makeOperationalState({ opportunityId: 1, opportunityKey: "opp-a", primaryIntent: "product_inquiry", status: "engaged" });
  const second = makeOperationalState({ opportunityId: 2, opportunityKey: "opp-b", primaryIntent: "maintenance_request", status: "engaged" });

  const result = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "unknown", candidates: [first, second] }));

  assert.equal(result.isAmbiguous, true);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.selectedOpportunityId, null);
});

test("terminal opportunity does not auto-reopen even as the only candidate", () => {
  const terminal = makeOperationalState({ opportunityId: 1, opportunityKey: "opp-old-quote", primaryIntent: "quote_request", status: "won" });

  const result = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "quote_requested", candidates: [terminal] }));

  assert.equal(result.status, "possible_reopen");
  assert.equal(result.isTerminal, true);
  assert.equal(result.selectedState, null);
  assert.equal(result.selectedOpportunityId, null, "a terminal opportunity is never auto-selected as the active state");
});

test("terminal opportunity plus a new unrelated intent: creates a new opportunity, not a reopen", () => {
  const terminal = makeOperationalState({ opportunityId: 1, opportunityKey: "opp-old-maintenance", primaryIntent: "maintenance_request", status: "won" });

  const result = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "quote_requested", candidates: [terminal] }));

  assert.equal(result.status, "create_new");
  assert.equal(result.isAmbiguous, false);
  assert.equal(result.selectedState, null);
});

test("follow-up response: a generic reply reuses the single active opportunity for this identity", () => {
  // No explicit follow-up/action linkage exists in the resolver today (see
  // audit): continuity here comes entirely from identity scoping (wa_id +
  // conversation_case_id) landing on the single active candidate, which this
  // task's fix makes reliable regardless of the reply's own classified
  // intent. Documented limitation: if a customer had two ACTIVE opportunities
  // and a follow-up was scheduled for a specific one, this mechanism alone
  // cannot disambiguate which one the reply is "for" - that would require a
  // new explicit action/opportunity linkage, out of scope for T02 (see
  // "Politica para respuestas a follow-up" in the acceptance evidence).
  const opportunity = makeOperationalState({ opportunityId: 3, opportunityKey: "opp-followup-3", primaryIntent: "quote_request", status: "waiting_customer" });

  // The follow-up asked "seguis interesado en la jaula?" and the customer
  // replies "sí, dale" - generic, no restated topic, classifies as unknown.
  const result = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "unknown", candidates: [opportunity] }));

  assert.equal(result.status, "continue_existing");
  assert.equal(result.selectedOpportunityId, 3);
  assert.equal(result.opportunityKey, "opp-followup-3");
});

test("validateCommercialTransition blocks an ambiguous identity resolution on its own, even when nothing else about the turn is wrong", () => {
  // Audit finding (ACS-R1-05.1-T02): identityResolution.isAmbiguous was only
  // ever appended to blockedReasons AFTER something else already set
  // reasons.length > 0 - a "clean" ambiguous turn (allowed status
  // transition, no policy block, no human/ai flags) fell through to
  // "allowed" and let the operational loop persist a brand new opportunity
  // despite two equally-relevant active candidates. Verified end-to-end
  // against real MariaDB (Caso 5 in tests/e2e/opportunityContinuity.e2e.test.ts).
  const first = makeOperationalState({ opportunityId: 1, opportunityKey: "opp-tv-1", primaryIntent: "quote_request", status: "engaged" });
  const second = makeOperationalState({ opportunityId: 2, opportunityKey: "opp-tv-2", primaryIntent: "quote_request", status: "engaged" });
  const identityResolution = resolveOpportunityIdentity(buildIdentityInput({ serviceCode: "quote_requested", candidates: [first, second] }));
  assert.equal(identityResolution.isAmbiguous, true, "test setup must actually be ambiguous");

  const resultingState = makeOperationalState({ opportunityId: null, opportunityKey: identityResolution.opportunityKey, status: "new", stage: "discovery" });

  const validation = validateCommercialTransition({
    previousState: null,
    resultingState,
    nextAction: {
      type: "respond",
      reason: "test",
      confidence: "medium",
      riskLevel: "low",
      approvalRequirement: "none",
      recommendedChannel: "whatsapp",
      draftMessage: "test",
      requiredInformation: [],
      blockedReasons: [],
      executable: false
    },
    identityResolution,
    commercialPolicyResult: null,
    commercialEvaluationResult: null,
    featureFlags: { commercialOperationalLoopEnabled: true, commercialStatePersistenceEnabled: true }
  });

  assert.equal(validation.status, "blocked", "an ambiguous identity resolution must block the transition by itself");
  assert.ok(validation.blockedReasons.includes("identity_conflict"));
});
