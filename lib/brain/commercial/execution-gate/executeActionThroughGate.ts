import { buildOutboxCommand } from "./buildOutboxCommand";
import { evaluateExecutionGate } from "./evaluateExecutionGate";
import type { ExecutionGateDependencies, ExecutionGateInput, ExecutionGateResult, ExecutionGateStatus, ExecutionGateBlockReason, ExecutionGateRepositoryResult } from "./types";
import type { CanonicalOutboxCommand } from "./types";
import type { ExecutionGateEvaluationResult } from "./types";
import { EXECUTION_GATE_ALLOWED_ACTION_STATUSES } from "./constants";

function zeroRepositoryResult(): ExecutionGateRepositoryResult {
  return {
    actionUpdated: false,
    outboxInserted: false,
    duplicateDetected: false,
    actionRowId: null,
    outboxRowId: null
  };
}

function buildResult(
  evaluatedAt: string,
  actionId: string,
  evaluation: ExecutionGateEvaluationResult,
  outboxCommand: CanonicalOutboxCommand | null,
  repositoryResult: ExecutionGateRepositoryResult,
  status: ExecutionGateStatus = evaluation.status,
  blockReasons: ExecutionGateBlockReason[] = evaluation.blockReasons,
  warnings: string[] = evaluation.warnings
): ExecutionGateResult {
  return {
    status,
    allowed: status === "allowed",
    actionId,
    outboxCommand,
    blockReasons: [...blockReasons],
    warnings: [...warnings],
    repositoryResult,
    sideEffects: {
      messageSent: false,
      metaCalled: false,
      workerTriggered: false
    },
    evaluatedAt
  };
}

function asText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isReadyToPlan(status: string | null | undefined) {
  return status === "approved" || status === "planned" || status === "proposed";
}

function mapRepositoryFailure(evaluatedAt: string, actionId: string, evaluation: ExecutionGateEvaluationResult, error: unknown): ExecutionGateResult {
  const message = error instanceof Error ? error.message : String(error);
  const transactionFailure = /commit|rollback|transaction/i.test(message);
  return buildResult(
    evaluatedAt,
    actionId,
    evaluation,
    null,
    zeroRepositoryResult(),
    "failed",
    [transactionFailure ? "transaction_failure" : "repository_failure"],
    [...evaluation.warnings, message]
  );
}

export async function executeActionThroughGate(
  input: ExecutionGateInput,
  dependencies: ExecutionGateDependencies
): Promise<ExecutionGateResult> {
  const evaluation = evaluateExecutionGate(input);
  const evaluatedAt = input.now;
  const actionId = asText(input.action.actionId) ?? input.action.actionId;

  if (evaluation.status !== "allowed") {
    const status = evaluation.status;
    const outboxCommand = status === "duplicate" ? buildOutboxCommand({ action: input.action, evaluatedAt }) : null;
    return buildResult(evaluatedAt, actionId, evaluation, outboxCommand, zeroRepositoryResult(), status, evaluation.blockReasons, evaluation.warnings);
  }

  try {
    return await dependencies.unitOfWork.run(async ({ agentActions, outbox }) => {
      const [byActionId, byIdempotencyKey] = await Promise.all([
        agentActions.findByActionId(input.action.actionId),
        agentActions.findByIdempotencyKey(input.action.idempotencyKey)
      ]);

      const persistedAction = byActionId ?? byIdempotencyKey;
      if (!persistedAction) {
        return buildResult(
          evaluatedAt,
          actionId,
          evaluation,
          null,
          zeroRepositoryResult(),
          "invalid",
          ["action_not_found"],
          evaluation.warnings
        );
      }

      if (byIdempotencyKey && byActionId && byIdempotencyKey.actionId !== byActionId.actionId) {
        return buildResult(
          evaluatedAt,
          actionId,
          evaluation,
          null,
          {
            actionUpdated: false,
            outboxInserted: false,
            duplicateDetected: true,
            actionRowId: byActionId.id ?? null,
            outboxRowId: null
          },
          "duplicate",
          ["duplicate_execution"],
          evaluation.warnings
        );
      }

      if (byIdempotencyKey && !byActionId && byIdempotencyKey.actionId !== input.action.actionId) {
        return buildResult(
          evaluatedAt,
          actionId,
          evaluation,
          null,
          {
            actionUpdated: false,
            outboxInserted: false,
            duplicateDetected: true,
            actionRowId: byIdempotencyKey.id ?? null,
            outboxRowId: null
          },
          "duplicate",
          ["duplicate_execution"],
          evaluation.warnings
        );
      }

      if (!isReadyToPlan(persistedAction.status)) {
        return buildResult(
          evaluatedAt,
          actionId,
          evaluation,
          null,
          zeroRepositoryResult(),
          "blocked",
          ["invalid_lifecycle_transition"],
          evaluation.warnings
        );
      }

      const outboxCommand = buildOutboxCommand({
        action: persistedAction,
        evaluatedAt
      });

      const existingOutbox = await outbox.findByIdempotencyKey(outboxCommand.idempotencyKey);
      const duplicateDetected = Boolean(existingOutbox) || persistedAction.outboxMessageId !== null;
      const repositoryResult: ExecutionGateRepositoryResult = {
        actionUpdated: false,
        outboxInserted: false,
        duplicateDetected,
        actionRowId: persistedAction.id ?? null,
        outboxRowId: existingOutbox?.id ?? persistedAction.outboxMessageId ?? null
      };

      if (persistedAction.outboxMessageId !== null) {
        return buildResult(
          evaluatedAt,
          actionId,
          evaluation,
          outboxCommand,
          repositoryResult,
          "duplicate",
          ["duplicate_execution"],
          evaluation.warnings
        );
      }

      if (existingOutbox) {
        const update = await agentActions.markPlanned({
          actionId: persistedAction.actionId,
          expectedCurrentStatuses: [...EXECUTION_GATE_ALLOWED_ACTION_STATUSES],
          outboxMessageId: existingOutbox.id,
          updatedAt: evaluatedAt
        });

        if (update.conflict) {
          return buildResult(
            evaluatedAt,
            actionId,
            evaluation,
            outboxCommand,
            repositoryResult,
            "blocked",
            ["conflicting_action"],
            evaluation.warnings
          );
        }

        repositoryResult.actionUpdated = update.updated;
        repositoryResult.actionRowId = update.rowId ?? repositoryResult.actionRowId;
        repositoryResult.outboxRowId = existingOutbox.id;
        return buildResult(evaluatedAt, actionId, evaluation, outboxCommand, repositoryResult, "duplicate", ["duplicate_execution"], evaluation.warnings);
      }

      const insert = await outbox.insertCommand(outboxCommand);
      repositoryResult.outboxInserted = insert.inserted;
      repositoryResult.duplicateDetected = insert.duplicate;
      repositoryResult.outboxRowId = insert.rowId ?? repositoryResult.outboxRowId;

      const update = await agentActions.markPlanned({
        actionId: persistedAction.actionId,
        expectedCurrentStatuses: [...EXECUTION_GATE_ALLOWED_ACTION_STATUSES],
        outboxMessageId: insert.rowId,
        updatedAt: evaluatedAt
      });

      if (update.conflict) {
        return buildResult(
          evaluatedAt,
          actionId,
          evaluation,
          outboxCommand,
          repositoryResult,
          "blocked",
          ["conflicting_action"],
          evaluation.warnings
        );
      }

      repositoryResult.actionUpdated = update.updated;
      repositoryResult.actionRowId = update.rowId ?? repositoryResult.actionRowId;

      const status = insert.duplicate ? "duplicate" : "allowed";
      const blockReasons: ExecutionGateBlockReason[] = insert.duplicate ? ["duplicate_execution"] : [];
      return buildResult(evaluatedAt, actionId, evaluation, outboxCommand, repositoryResult, status, blockReasons, evaluation.warnings);
    });
  } catch (error) {
    return mapRepositoryFailure(evaluatedAt, actionId, evaluation, error);
  }
}
