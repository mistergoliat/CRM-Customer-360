import {
  AUTONOMOUS_LOOP_FIXTURE_NOW,
  aiBlockedFixture,
  closedCaseFixture,
  complaintBlockedFixture,
  duplicateExecutionFixture,
  humanHandoffFixture,
  lowRiskPriceQuestionFixture,
  opportunityWonFixture,
  permanentTransportFailureFixture,
  rateLimitedTransportFixture,
  requestMoreContextFixture,
  temporaryTransportFailureFixture
} from "../autonomous-loop";
import type { AutonomousCommercialLoopInput } from "../autonomous-loop";
import type { ScenarioCatalog, ScenarioDefinition, ScenarioStep } from "./types";
import { SCENARIO_SIMULATOR_VERSION } from "./constants";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function baseConfiguration(input: AutonomousCommercialLoopInput["configuration"]) {
  return {
    sandboxAutonomyEnabled: input.sandboxAutonomyEnabled,
    autonomousReplyEnabled: input.autonomousReplyEnabled,
    whitelistedWaIds: [...input.whitelistedWaIds],
    executionGateEnabled: input.executionGateEnabled,
    outboxBridgeEnabled: input.outboxBridgeEnabled,
    outboxWorkerEnabled: input.outboxWorkerEnabled,
    messageTransportEnabled: input.messageTransportEnabled,
    followUpEnabled: input.followUpEnabled,
    sandboxRequired: input.sandboxRequired
  };
}

function buildStep(
  stepId: string,
  title: string,
  input: AutonomousCommercialLoopInput,
  expectedCheckpointIds: string[],
  notes: string[],
  mode: ScenarioStep["mode"] = input.mode,
  replayFollowUp = false
): ScenarioStep {
  return {
    stepId,
    title,
    now: input.now,
    mode,
    input,
    expectedCheckpointIds,
    notes,
    replayFollowUp
  };
}

function makeActionSeed(seed: {
  actionId: string;
  idempotencyKey: string;
  createdAt: string;
  scheduledFor: string;
  expiresAt: string;
  attemptCount: number;
  maxAttempts: number;
  riskLevel: string;
  approvalRequirement: string;
  status?: string;
  waId: string;
}) {
  return {
    actionId: seed.actionId,
    status: seed.status ?? "planned",
    createdAt: seed.createdAt,
    updatedAt: null,
    source: {
      actionId: seed.actionId,
      idempotencyKey: seed.idempotencyKey,
      actionType: "schedule_followup",
      status: seed.status ?? "planned",
      createdAt: seed.createdAt,
      updatedAt: null,
      scheduledFor: seed.scheduledFor,
      expiresAt: seed.expiresAt,
      attemptCount: seed.attemptCount,
      maxAttempts: seed.maxAttempts,
      riskLevel: seed.riskLevel,
      approvalRequirement: seed.approvalRequirement,
      opportunityId: 202,
      conversationCaseId: 101,
      waId: seed.waId,
      draftMessage: "Seguimiento sintético.",
      finalMessage: null,
      blockReasons: [],
      cancelReason: null,
      parentActionId: null,
      supersededByActionId: null,
      generation: 1,
      lifecycleVersion: "brain.commercial.action-lifecycle.v1",
      policyVersion: "brain.commercial.policy.v1",
      runtimeVersion: "brain.commercial.runtime.v1"
    }
  };
}

function emptySeed(): ScenarioDefinition["initialState"]["runtimeSeed"] {
  return {
    opportunities: [],
    decisions: [],
    actions: [],
    outbox: [],
    deliveryResults: [],
    auditEvents: []
  };
}

function buildBaseScenario(
  scenarioId: string,
  name: string,
  description: string,
  category: ScenarioDefinition["category"],
  input: AutonomousCommercialLoopInput,
  steps: ScenarioStep[],
  expectations: ScenarioDefinition["expectations"],
  runtimeSeed: ScenarioDefinition["initialState"]["runtimeSeed"] = emptySeed()
): ScenarioDefinition {
  return {
    scenarioId,
    name,
    description,
    category,
    tags: [scenarioId, category, "synthetic"],
    initialState: {
      runtimeSeed,
      configuration: baseConfiguration(input.configuration)
    },
    steps,
    expectations,
    metadata: {
      version: SCENARIO_SIMULATOR_VERSION,
      deterministic: true,
      syntheticDataOnly: true
    }
  };
}

function mutateInput(input: AutonomousCommercialLoopInput, overrides: Partial<AutonomousCommercialLoopInput>): AutonomousCommercialLoopInput {
  const next = clone(input);
  for (const [key, value] of Object.entries(overrides) as Array<[keyof AutonomousCommercialLoopInput, unknown]>) {
    if (value === undefined) continue;
    if (key === "inbound" || key === "caseContext" || key === "commercialContext" || key === "configuration" || key === "scenario") {
      next[key] = { ...next[key], ...(value as Record<string, unknown>) } as never;
    } else {
      next[key] = value as never;
    }
  }
  return next;
}

function syntheticInput(input: AutonomousCommercialLoopInput, overrides: Partial<AutonomousCommercialLoopInput> = {}): AutonomousCommercialLoopInput {
  return mutateInput(input, overrides);
}

const lowRisk = lowRiskPriceQuestionFixture();
const requestMore = requestMoreContextFixture();
const humanHandoff = humanHandoffFixture();
const complaintBlocked = complaintBlockedFixture();
const closedCase = closedCaseFixture();
const aiBlocked = aiBlockedFixture();
const tempFailure = temporaryTransportFailureFixture();
const rateLimited = rateLimitedTransportFixture();
const permanentFailure = permanentTransportFailureFixture();
const duplicateExecution = duplicateExecutionFixture();
const opportunityWon = opportunityWonFixture();

const followUpSeed = makeActionSeed({
  actionId: "followup-seed-action",
  idempotencyKey: "followup:seed-action",
  createdAt: "2026-06-17T09:00:00.000Z",
  scheduledFor: "2026-06-17T12:00:00.000Z",
  expiresAt: "2026-06-18T12:00:00.000Z",
  attemptCount: 1,
  maxAttempts: 3,
  riskLevel: "low",
  approvalRequirement: "none",
  waId: lowRisk.input.inbound.waId
});

const followUpFutureSeed = makeActionSeed({
  actionId: "followup-future-seed",
  idempotencyKey: "followup:future-seed",
  createdAt: "2026-06-17T09:00:00.000Z",
  scheduledFor: "2026-06-17T15:00:00.000Z",
  expiresAt: "2026-06-18T12:00:00.000Z",
  attemptCount: 1,
  maxAttempts: 3,
  riskLevel: "low",
  approvalRequirement: "none",
  waId: lowRisk.input.inbound.waId
});

const followUpExpiredSeed = makeActionSeed({
  actionId: "followup-expired-seed",
  idempotencyKey: "followup:expired-seed",
  createdAt: "2026-06-16T09:00:00.000Z",
  scheduledFor: "2026-06-16T12:00:00.000Z",
  expiresAt: "2026-06-16T13:00:00.000Z",
  attemptCount: 3,
  maxAttempts: 3,
  riskLevel: "low",
  approvalRequirement: "none",
  waId: lowRisk.input.inbound.waId,
  status: "planned"
});

export const SCENARIO_CATALOG: ScenarioCatalog = [
  buildBaseScenario(
    "low-risk-autonomous-reply",
    "Low-risk autonomous reply",
    "pregunta comercial simple -> low risk -> eligible -> outbox -> accepted -> delivered -> action executed",
    "sales",
    lowRisk.input,
    [
      buildStep("step-1", "Responder precio", lowRisk.input, ["loop_status:delivered", "action_status:executed"], ["happy-path autonomous reply"])
    ],
    [
      {
        expectationId: "low-risk-loop-status",
        stepId: "step-1",
        type: "loop_status",
        path: "loop.status",
        operator: "equals",
        expected: "delivered"
      },
      {
        expectationId: "low-risk-action-status",
        stepId: "step-1",
        type: "action_status",
        path: "action.status",
        operator: "equals",
        expected: "executed"
      },
      {
        expectationId: "low-risk-outbox-status",
        stepId: "step-1",
        type: "outbox_status",
        path: "outbox.status",
        operator: "equals",
        expected: "delivered"
      }
    ]
  ),
  buildBaseScenario(
    "request-more-context",
    "Request more context",
    "consulta ambigua -> request_more_context -> eligible -> delivered",
    "sales",
    requestMore.input,
    [buildStep("step-1", "Pedir contexto", requestMore.input, ["loop_status:delivered"], ["clarification path"])],
    [
      {
        expectationId: "request-more-status",
        stepId: "step-1",
        type: "loop_status",
        path: "loop.status",
        operator: "equals",
        expected: "delivered"
      },
      {
        expectationId: "request-more-action",
        stepId: "step-1",
        type: "action_status",
        path: "action.status",
        operator: "equals",
        expected: "executed"
      }
    ]
  ),
  buildBaseScenario(
    "recipient-not-whitelisted",
    "Recipient not whitelisted",
    "acción correcta -> whitelist mismatch -> blocked -> no outbox",
    "risk",
    syntheticInput(lowRisk.input, {
      configuration: {
        ...lowRisk.input.configuration,
        whitelistedWaIds: ["56922222222"]
      }
    }),
    [buildStep("step-1", "Bloqueo por whitelist", syntheticInput(lowRisk.input, { configuration: { ...lowRisk.input.configuration, whitelistedWaIds: ["56922222222"] } }), ["loop_status:blocked"], ["whitelist mismatch"])],
    [
      {
        expectationId: "whitelist-blocked",
        stepId: "step-1",
        type: "loop_status",
        path: "loop.status",
        operator: "equals",
        expected: "blocked"
      },
      {
        expectationId: "whitelist-no-outbox",
        stepId: "step-1",
        type: "runtime_count",
        path: "runtime.outbox.count",
        operator: "equals",
        expected: 0
      }
    ]
  ),
  buildBaseScenario(
    "human-handoff",
    "Human handoff",
    "cliente pide humano -> requires_human -> no execution gate -> no outbox",
    "human_handoff",
    humanHandoff.input,
    [buildStep("step-1", "Escalar a humano", humanHandoff.input, ["loop_status:requires_human"], ["handoff path"])],
    [
      {
        expectationId: "handoff-requires-human",
        stepId: "step-1",
        type: "loop_status",
        path: "loop.status",
        operator: "equals",
        expected: "requires_human"
      }
    ]
  ),
  buildBaseScenario(
    "complaint-blocked",
    "Complaint blocked",
    "reclamo/garantía -> risk/policy block -> human required",
    "risk",
    complaintBlocked.input,
    [buildStep("step-1", "Bloqueo por reclamo", complaintBlocked.input, ["loop_status:blocked"], ["complaint safety"])],
    [
      {
        expectationId: "complaint-blocked",
        stepId: "step-1",
        type: "loop_status",
        path: "loop.status",
        operator: "equals",
        expected: "blocked"
      }
    ]
  ),
  buildBaseScenario(
    "closed-case",
    "Closed case",
    "case closed -> action blocked or cancelled -> no send",
    "lifecycle",
    closedCase.input,
    [buildStep("step-1", "Caso cerrado", closedCase.input, ["loop_status:cancelled"], ["closed case no send"])],
    [
      {
        expectationId: "closed-case-status",
        stepId: "step-1",
        type: "loop_status",
        path: "loop.status",
        operator: "equals",
        expected: "cancelled"
      }
    ]
  ),
  buildBaseScenario(
    "ai-blocked",
    "AI blocked",
    "aiBlocked = true -> no autonomous execution",
    "risk",
    aiBlocked.input,
    [buildStep("step-1", "AI bloqueada", aiBlocked.input, ["loop_status:blocked"], ["ai block"])],
    [
      {
        expectationId: "ai-blocked-status",
        stepId: "step-1",
        type: "loop_status",
        path: "loop.status",
        operator: "equals",
        expected: "blocked"
      }
    ]
  ),
  buildBaseScenario(
    "opportunity-won",
    "Opportunity won",
    "opportunityStatus = won -> cancelled",
    "sales",
    opportunityWon.input,
    [buildStep("step-1", "Oportunidad ganada", opportunityWon.input, ["loop_status:cancelled"], ["won opportunity"])],
    [
      {
        expectationId: "opportunity-won-status",
        stepId: "step-1",
        type: "loop_status",
        path: "loop.status",
        operator: "equals",
        expected: "cancelled"
      }
    ]
  ),
  buildBaseScenario(
    "temporary-transport-failure",
    "Temporary transport failure",
    "outbox processed -> temporary_failure -> retry_scheduled -> same outbox row -> action remains planned",
    "transport",
    tempFailure.input,
    [buildStep("step-1", "Falla temporal", tempFailure.input, ["delivery_status:retry_scheduled"], ["retry path"])],
    [
      {
        expectationId: "temp-failure-status",
        stepId: "step-1",
        type: "delivery_status",
        path: "delivery.status",
        operator: "equals",
        expected: "retry_scheduled"
      }
    ]
  ),
  buildBaseScenario(
    "rate-limit",
    "Rate limit",
    "429 -> retry-after -> deterministic retry date",
    "transport",
    rateLimited.input,
    [buildStep("step-1", "Rate limit", rateLimited.input, ["delivery_status:retry_scheduled"], ["retry-after path"])],
    [
      {
        expectationId: "rate-limit-status",
        stepId: "step-1",
        type: "delivery_status",
        path: "delivery.status",
        operator: "equals",
        expected: "retry_scheduled"
      }
    ]
  ),
  buildBaseScenario(
    "permanent-transport-failure",
    "Permanent transport failure",
    "invalid recipient or policy rejection -> dead_letter -> action failed",
    "failure",
    permanentFailure.input,
    [buildStep("step-1", "Falla permanente", permanentFailure.input, ["delivery_status:dead_letter"], ["dead letter"])],
    [
      {
        expectationId: "permanent-failure-status",
        stepId: "step-1",
        type: "delivery_status",
        path: "delivery.status",
        operator: "equals",
        expected: "dead_letter"
      }
    ]
  ),
  buildBaseScenario(
    "duplicate-inbound",
    "Duplicate inbound",
    "same providerMessageId twice -> second run idempotent -> no duplicate action -> no duplicate outbox",
    "idempotency",
    lowRisk.input,
    [
      buildStep("step-1", "Primer inbound", lowRisk.input, ["loop_status:delivered"], ["first delivery"]),
      buildStep(
        "step-2",
        "Inbound duplicado",
        syntheticInput(lowRisk.input, {
          correlationId: "corr-autonomous-loop-duplicate",
          inbound: {
            ...lowRisk.input.inbound,
            messageId: "msg-low-risk-duplicate"
          }
        }),
        ["loop_status:completed"],
        ["duplicate inbound"]
      )
    ],
    [
      {
        expectationId: "duplicate-inbound-step2",
        stepId: "step-2",
        type: "loop_status",
        path: "loop.status",
        operator: "equals",
        expected: "completed"
      }
    ]
  ),
  buildBaseScenario(
    "duplicate-execution",
    "Duplicate execution",
    "same action/idempotency key -> one outbox -> no repeated transport after delivered",
    "idempotency",
    duplicateExecution.input,
    [
      buildStep("step-1", "Primera ejecución", duplicateExecution.input, ["loop_status:delivered"], ["single delivery"]),
      buildStep("step-2", "Reejecución", clone(duplicateExecution.input), ["loop_status:completed"], ["idempotent execution"])
    ],
    [
      {
        expectationId: "duplicate-execution-step2",
        stepId: "step-2",
        type: "runtime_count",
        path: "runtime.outbox.count",
        operator: "equals",
        expected: 1
      }
    ]
  ),
  buildBaseScenario(
    "follow-up-wait",
    "Follow-up waiting",
    "scheduledFor future -> wait -> no outbox",
    "follow_up",
    syntheticInput(lowRisk.input, {
      scenario: {
        ...lowRisk.input.scenario,
        forceDecision: "no_commercial_action",
        forceActionType: "schedule_followup"
      },
      commercialContext: {
        ...lowRisk.input.commercialContext,
        lastInboundAt: null
      }
    }),
    [
      buildStep(
        "step-1",
        "Esperar follow-up",
        syntheticInput(lowRisk.input, {
          scenario: {
            ...lowRisk.input.scenario,
            forceDecision: "no_commercial_action",
            forceActionType: "schedule_followup"
          },
          commercialContext: {
            ...lowRisk.input.commercialContext,
            lastInboundAt: null
          }
        }),
        ["follow_up:wait"],
        ["seeded follow-up wait"],
        "observe",
        true
      )
    ],
    [
      {
        expectationId: "follow-up-wait",
        stepId: "step-1",
        type: "follow_up_decision",
        path: "followUp.schedulingResult.decision",
        operator: "equals",
        expected: "wait"
      }
    ],
    {
      opportunities: [],
      decisions: [],
      actions: [followUpFutureSeed],
      outbox: [],
      deliveryResults: [],
      auditEvents: []
    }
  ),
  buildBaseScenario(
    "follow-up-ready",
    "Follow-up ready",
    "scheduledFor reached -> ready",
    "follow_up",
    syntheticInput(lowRisk.input, {
      scenario: {
        ...lowRisk.input.scenario,
        forceDecision: "no_commercial_action",
        forceActionType: "schedule_followup"
      },
      commercialContext: {
        ...lowRisk.input.commercialContext,
        lastInboundAt: null
      }
    }),
    [
      buildStep(
        "step-1",
        "Listo follow-up",
        syntheticInput(lowRisk.input, {
          scenario: {
            ...lowRisk.input.scenario,
            forceDecision: "no_commercial_action",
            forceActionType: "schedule_followup"
          },
          commercialContext: {
            ...lowRisk.input.commercialContext,
            lastInboundAt: null
          }
        }),
        ["follow_up:ready"],
        ["seeded follow-up ready"],
        "observe",
        true
      )
    ],
    [
      {
        expectationId: "follow-up-ready",
        stepId: "step-1",
        type: "follow_up_decision",
        path: "followUp.schedulingResult.decision",
        operator: "equals",
        expected: "ready"
      }
    ],
    {
      opportunities: [],
      decisions: [],
      actions: [followUpSeed],
      outbox: [],
      deliveryResults: [],
      auditEvents: []
    }
  ),
  buildBaseScenario(
    "customer-reply-cancels-follow-up",
    "Customer reply cancels follow-up",
    "scheduled follow-up + customer inbound after action creation -> cancel_action -> no delivery",
    "follow_up",
    syntheticInput(lowRisk.input, {
      commercialContext: {
        ...lowRisk.input.commercialContext,
        lastInboundAt: null
      }
    }),
    [
      buildStep(
        "step-1",
        "Sembrar follow-up",
        syntheticInput(lowRisk.input, {
          commercialContext: {
            ...lowRisk.input.commercialContext,
            lastInboundAt: null
          }
        }),
        ["follow_up:ready"],
        ["seeded follow-up"]
      ),
      buildStep(
        "step-2",
        "Respuesta del cliente",
        syntheticInput(lowRisk.input, {
          correlationId: "corr-follow-up-reply",
          commercialContext: {
            ...lowRisk.input.commercialContext,
            lastInboundAt: "2026-06-17T14:30:00.000Z"
          }
        }),
        ["follow_up:cancel"],
        ["customer reply cancels"],
        "execute_fake",
        true
      )
    ],
    [
      {
        expectationId: "follow-up-cancel",
        stepId: "step-2",
        type: "follow_up_decision",
        path: "followUp.schedulingResult.decision",
        operator: "equals",
        expected: "cancel"
      }
    ],
    {
      opportunities: [],
      decisions: [],
      actions: [followUpSeed],
      outbox: [],
      deliveryResults: [],
      auditEvents: []
    }
  ),
  buildBaseScenario(
    "human-takeover-cancels-follow-up",
    "Human takeover cancels follow-up",
    "scheduled follow-up + humanOwnerActive -> cancelled",
    "human_handoff",
    syntheticInput(lowRisk.input, {
      commercialContext: {
        ...lowRisk.input.commercialContext,
        lastInboundAt: null
      }
    }),
    [
      buildStep(
        "step-1",
        "Sembrar follow-up",
        syntheticInput(lowRisk.input, {
          commercialContext: {
            ...lowRisk.input.commercialContext,
            lastInboundAt: null
          }
        }),
        ["follow_up:ready"],
        ["seeded follow-up"]
      ),
      buildStep(
        "step-2",
        "Takeover humano",
        syntheticInput(lowRisk.input, {
          correlationId: "corr-follow-up-human",
          caseContext: {
            ...lowRisk.input.caseContext,
            humanOwnerActive: true,
            requiresHuman: true
          },
          commercialContext: {
            ...lowRisk.input.commercialContext,
            lastInboundAt: null
          }
        }),
        ["follow_up:cancel"],
        ["human takeover cancels"],
        "execute_fake",
        true
      )
    ],
    [
      {
        expectationId: "human-takeover-cancel",
        stepId: "step-2",
        type: "follow_up_decision",
        path: "followUp.schedulingResult.decision",
        operator: "equals",
        expected: "cancel"
      }
    ],
    {
      opportunities: [],
      decisions: [],
      actions: [followUpSeed],
      outbox: [],
      deliveryResults: [],
      auditEvents: []
    }
  ),
  buildBaseScenario(
    "opportunity-stage-replacement",
    "Opportunity stage changes",
    "old follow-up context -> stage changed -> supersede -> replacement action with lineage",
    "lifecycle",
    syntheticInput(lowRisk.input, {
      commercialContext: {
        ...lowRisk.input.commercialContext,
        lastInboundAt: null
      }
    }),
    [
      buildStep(
        "step-1",
        "Sembrar follow-up",
        syntheticInput(lowRisk.input, {
          commercialContext: {
            ...lowRisk.input.commercialContext,
            lastInboundAt: null
          }
        }),
        ["follow_up:ready"],
        ["seeded follow-up"]
      ),
      buildStep(
        "step-2",
        "Cambio de etapa",
        syntheticInput(lowRisk.input, {
          correlationId: "corr-follow-up-stage",
          commercialContext: {
            ...lowRisk.input.commercialContext,
            opportunityStage: "negotiation",
            opportunityStageChangedAt: "2026-06-17T14:30:00.000Z",
            lastInboundAt: null
          }
        }),
        ["follow_up:replan"],
        ["stage change triggers replacement"],
        "execute_fake",
        true
      )
    ],
    [
      {
        expectationId: "stage-replacement",
        stepId: "step-2",
        type: "follow_up_decision",
        path: "followUp.schedulingResult.decision",
        operator: "equals",
        expected: "replan"
      }
    ],
    {
      opportunities: [],
      decisions: [],
      actions: [followUpSeed],
      outbox: [],
      deliveryResults: [],
      auditEvents: []
    }
  ),
  buildBaseScenario(
    "follow-up-expired",
    "Follow-up expired",
    "now >= expiresAt -> expired",
    "follow_up",
    syntheticInput(lowRisk.input, {
      commercialContext: {
        ...lowRisk.input.commercialContext,
        lastInboundAt: null
      }
    }),
    [
      buildStep(
        "step-1",
        "Expirar follow-up",
        syntheticInput(lowRisk.input, {
          now: "2026-06-18T13:30:00.000Z",
          commercialContext: {
            ...lowRisk.input.commercialContext,
            lastInboundAt: null
          }
        }),
        ["follow_up:expire"],
        ["expired follow-up"],
        "observe",
        true
      )
    ],
    [
      {
        expectationId: "follow-up-expired",
        stepId: "step-1",
        type: "follow_up_decision",
        path: "followUp.schedulingResult.decision",
        operator: "equals",
        expected: "expire"
      }
    ],
    {
      opportunities: [],
      decisions: [],
      actions: [followUpExpiredSeed],
      outbox: [],
      deliveryResults: [],
      auditEvents: []
    }
  ),
  buildBaseScenario(
    "max-attempts-exhausted",
    "Max attempts exhausted",
    "attemptCount >= maxAttempts -> expired",
    "follow_up",
    syntheticInput(lowRisk.input, {
      commercialContext: {
        ...lowRisk.input.commercialContext,
        lastInboundAt: null
      }
    }),
    [
      buildStep(
        "step-1",
        "Límite de intentos",
        syntheticInput(lowRisk.input, {
          now: "2026-06-17T13:30:00.000Z",
          commercialContext: {
            ...lowRisk.input.commercialContext,
            lastInboundAt: null
          }
        }),
        ["follow_up:expire"],
        ["max attempts"],
        "observe",
        true
      )
    ],
    [
      {
        expectationId: "follow-up-max-attempts",
        stepId: "step-1",
        type: "follow_up_decision",
        path: "followUp.schedulingResult.decision",
        operator: "equals",
        expected: "expire"
      }
    ],
    {
      opportunities: [],
      decisions: [],
      actions: [
        makeActionSeed({
          actionId: "followup-max-attempts-seed",
          idempotencyKey: "followup:max-attempts",
          createdAt: "2026-06-17T09:00:00.000Z",
          scheduledFor: AUTONOMOUS_LOOP_FIXTURE_NOW,
          expiresAt: "2026-06-18T12:00:00.000Z",
          attemptCount: 3,
          maxAttempts: 3,
          riskLevel: "low",
          approvalRequirement: "none",
          waId: lowRisk.input.inbound.waId
        })
      ],
      outbox: [],
      deliveryResults: [],
      auditEvents: []
    }
  ),
  buildBaseScenario(
    "full-rollback",
    "Full rollback",
    "outbox inserted in-memory -> reconciliation failure -> complete rollback -> no orphan outbox",
    "failure",
    lowRisk.input,
    [buildStep("step-1", "Rollback", lowRisk.input, ["loop_status:failed"], ["fault injection"])],
    [
      {
        expectationId: "rollback-status",
        stepId: "step-1",
        type: "loop_status",
        path: "loop.status",
        operator: "equals",
        expected: "failed"
      }
    ]
  )
];

export function getScenarioDefinitionById(scenarioId: string): ScenarioDefinition | null {
  return SCENARIO_CATALOG.find((scenario) => scenario.scenarioId === scenarioId) ?? null;
}
