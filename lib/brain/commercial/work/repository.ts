import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { queryRows, sanitizeDbError, withConnection } from "@/lib/db";
import { deriveCommercialWorkMetrics } from "./evaluateCommercialWork";
import {
  COMMERCIAL_WORK_PAYLOAD_VERSION,
  CommercialWorkPersistenceError,
  type CommercialObjectiveStatusTransitionInput,
  type CommercialWorkDatabaseAdapter,
  type CommercialWorkSqlConnection,
  type CommercialWorkStatusTransitionInput,
  type CommercialWorkStepStatusTransitionInput,
  type FindActiveCommercialWorkInput,
  type PersistCommercialWorkProjectionInput,
  type PersistCommercialWorkProjectionResult,
  type PersistedCommercialWork,
  type UpdateCommercialWorkAggregateInput
} from "./persistenceTypes";
import { canTransitionCommercialWorkStatus, canTransitionObjectiveStatus, canTransitionStepStatus } from "./transitions";
import type { CommercialObjective, CommercialWork, CommercialWorkStep } from "./types";

export const COMMERCIAL_WORK_TABLE = "crm_commercial_work";
export const COMMERCIAL_WORK_OBJECTIVES_TABLE = "crm_commercial_work_objectives";
export const COMMERCIAL_WORK_STEPS_TABLE = "crm_commercial_work_steps";

const ACTIVE_WORK_STATUSES = ["ACTIVE", "WAITING_CUSTOMER", "WAITING_SYSTEM", "HANDOFF", "FAILED"] as const;

function defaultAdapter(): Required<CommercialWorkDatabaseAdapter> {
  return {
    withConnection: async <T>(fn: (connection: CommercialWorkSqlConnection) => Promise<T>) => withConnection((connection) => fn(connection)),
    queryRows
  };
}

function adapterOrDefault(adapter?: CommercialWorkDatabaseAdapter | null): Required<CommercialWorkDatabaseAdapter> {
  const defaults = defaultAdapter();
  return {
    withConnection: adapter?.withConnection ?? defaults.withConnection,
    queryRows: adapter?.queryRows ?? defaults.queryRows
  };
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function asText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return asText(value);
}

function toMysqlDateTime(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 23).replace("T", " ");
}

function nowMysql() {
  return new Date().toISOString().slice(0, 23).replace("T", " ");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildCommercialWorkCorrelationKey(work: CommercialWork): string {
  const activeObjectives = work.objectives
    .filter((objective) => objective.status !== "CANCELLED" && objective.status !== "SUPERSEDED")
    .map((objective) => ({ type: objective.type, origin: objective.origin, inputs: objective.inputs }))
    .sort((a, b) => `${a.type}:${stableStringify(a.inputs)}`.localeCompare(`${b.type}:${stableStringify(b.inputs)}`));

  return [
    "commercial-work",
    "v1",
    `opportunity:${work.opportunityId ?? "none"}`,
    `conversation:${work.conversationId}`,
    stableStringify(activeObjectives)
  ].join(":");
}

function duplicateError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate entry/i.test(message);
}

function persistenceError(error: unknown): CommercialWorkPersistenceError {
  if (error instanceof CommercialWorkPersistenceError) return error;
  return new CommercialWorkPersistenceError("PERSISTENCE_FAILURE", sanitizeDbError(error), {});
}

function validateAggregateTransition(previous: PersistedCommercialWork, next: CommercialWork) {
  if (!canTransitionCommercialWorkStatus(previous.status, next.status)) {
    throw new CommercialWorkPersistenceError("INVALID_TRANSITION", `Invalid CommercialWork transition ${previous.status} -> ${next.status}`, {
      publicId: previous.publicId
    });
  }

  const previousObjectives = new Map(previous.objectives.map((objective) => [objective.objectiveId, objective]));
  for (const objective of next.objectives) {
    const old = previousObjectives.get(objective.objectiveId);
    if (old && !canTransitionObjectiveStatus(old.status, objective.status)) {
      throw new CommercialWorkPersistenceError("INVALID_TRANSITION", `Invalid CommercialObjective transition ${old.status} -> ${objective.status}`, {
        objectiveId: objective.objectiveId
      });
    }
  }

  const previousSteps = new Map(previous.steps.map((step) => [step.stepId, step]));
  for (const step of next.steps) {
    const old = previousSteps.get(step.stepId);
    if (old && !canTransitionStepStatus(old.status, step.status)) {
      throw new CommercialWorkPersistenceError("INVALID_TRANSITION", `Invalid CommercialWorkStep transition ${old.status} -> ${step.status}`, {
        stepId: step.stepId
      });
    }
  }
}

async function loadByWhere(
  whereSql: string,
  params: unknown[],
  adapter: Required<CommercialWorkDatabaseAdapter>
): Promise<PersistedCommercialWork | null> {
  const rows = await adapter.queryRows<Record<string, unknown>>(`SELECT * FROM ${COMMERCIAL_WORK_TABLE} WHERE ${whereSql} LIMIT 1`, params);
  const row = rows[0];
  if (!row) return null;
  return hydrateWork(row, adapter);
}

async function hydrateWork(row: Record<string, unknown>, adapter: Required<CommercialWorkDatabaseAdapter>): Promise<PersistedCommercialWork> {
  const rowId = asNumber(row.id);
  if (!rowId) throw new CommercialWorkPersistenceError("PERSISTENCE_FAILURE", "commercial_work_row_missing_id");

  const [objectiveRows, stepRows] = await Promise.all([
    adapter.queryRows<Record<string, unknown>>(`SELECT * FROM ${COMMERCIAL_WORK_OBJECTIVES_TABLE} WHERE commercial_work_id = ? ORDER BY id ASC`, [rowId]),
    adapter.queryRows<Record<string, unknown>>(`SELECT * FROM ${COMMERCIAL_WORK_STEPS_TABLE} WHERE commercial_work_id = ? ORDER BY id ASC`, [rowId])
  ]);

  const objectives: CommercialObjective[] = objectiveRows.map((objectiveRow) => ({
    objectiveId: asText(objectiveRow.public_id) ?? "",
    type: asText(objectiveRow.type) as CommercialObjective["type"],
    origin: asText(objectiveRow.origin) as CommercialObjective["origin"],
    status: asText(objectiveRow.status) as CommercialObjective["status"],
    inputs: parseJson(objectiveRow.inputs_json, {}),
    resolvedInputs: parseJson(objectiveRow.resolved_inputs_json, {}),
    missingRequirements: parseJson(objectiveRow.missing_requirements_json, []),
    supersedesObjectiveIds: parseJson(objectiveRow.supersedes_objective_ids_json, []),
    evidence: parseJson(objectiveRow.evidence_json, []),
    blockers: parseJson(objectiveRow.blockers_json, [])
  }));

  const steps: CommercialWorkStep[] = stepRows.map((stepRow) => ({
    stepId: asText(stepRow.public_id) ?? "",
    objectiveIds: parseJson(stepRow.objective_ids_json, []),
    type: asText(stepRow.step_type) as CommercialWorkStep["type"],
    capabilityName: (asText(stepRow.capability_name) as CommercialWorkStep["capabilityName"]) ?? null,
    status: asText(stepRow.status) as CommercialWorkStep["status"],
    dependencies: parseJson(stepRow.dependencies_json, []),
    input: parseJson(stepRow.input_json, {}),
    evidence: parseJson(stepRow.evidence_json, []),
    blockers: parseJson(stepRow.blockers_json, []),
    retryable: Boolean(asNumber(stepRow.retryable)),
    retryCandidate: Boolean(asNumber(stepRow.retry_candidate)),
    idempotencyKey: asText(stepRow.idempotency_key),
    attemptCount: asNumber(stepRow.attempt_count) ?? 0,
    maxAttempts: asNumber(stepRow.max_attempts),
    nextAttemptAt: asIso(stepRow.next_attempt_at),
    startedAt: asIso(stepRow.started_at),
    lastAttemptAt: asIso(stepRow.last_attempt_at),
    lockOwner: asText(stepRow.lock_owner),
    lockUntil: asIso(stepRow.lock_until)
  }));

  const work: PersistedCommercialWork = {
    id: asText(row.projection_id) ?? asText(row.public_id) ?? "",
    publicId: asText(row.public_id) ?? "",
    correlationKey: asText(row.correlation_key) ?? "",
    version: asNumber(row.version) ?? 1,
    projectionVersion: (asNumber(row.projection_version) ?? 1) as 1,
    opportunityId: asNumber(row.opportunity_id),
    conversationId: asNumber(row.conversation_id) ?? 0,
    sourceMessageId: asNumber(row.source_message_id),
    trigger: parseJson(row.trigger_json, { type: asText(row.trigger_type) ?? "SYSTEM_EVENT" }) as CommercialWork["trigger"],
    status: asText(row.status) as CommercialWork["status"],
    objectives,
    steps,
    blockers: parseJson(row.blockers_json, []),
    derivedAt: asIso(row.derived_at) ?? "",
    metrics: parseJson(row.metrics_json, deriveCommercialWorkMetrics({ objectives, steps, blockers: [] })),
    createdAt: asIso(row.created_at) ?? "",
    updatedAt: asIso(row.updated_at) ?? "",
    completedAt: asIso(row.completed_at),
    cancelledAt: asIso(row.cancelled_at),
    cancelReason: asText(row.cancel_reason)
  };

  return { ...work, metrics: deriveCommercialWorkMetrics(work) };
}

async function insertObjective(connection: CommercialWorkSqlConnection, workRowId: number, objective: CommercialObjective) {
  const timestamp = nowMysql();
  await connection.execute<ResultSetHeader>(
    `INSERT INTO ${COMMERCIAL_WORK_OBJECTIVES_TABLE} (
      public_id, commercial_work_id, type, origin, status,
      inputs_json, resolved_inputs_json, missing_requirements_json,
      supersedes_objective_ids_json, evidence_json, blockers_json,
      payload_version, completed_at, cancelled_at, superseded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      type = VALUES(type),
      origin = VALUES(origin),
      status = VALUES(status),
      inputs_json = VALUES(inputs_json),
      resolved_inputs_json = VALUES(resolved_inputs_json),
      missing_requirements_json = VALUES(missing_requirements_json),
      supersedes_objective_ids_json = VALUES(supersedes_objective_ids_json),
      evidence_json = VALUES(evidence_json),
      blockers_json = VALUES(blockers_json),
      payload_version = VALUES(payload_version),
      completed_at = COALESCE(completed_at, VALUES(completed_at)),
      cancelled_at = COALESCE(cancelled_at, VALUES(cancelled_at)),
      superseded_at = COALESCE(superseded_at, VALUES(superseded_at))`,
    [
      objective.objectiveId,
      workRowId,
      objective.type,
      objective.origin,
      objective.status,
      json(objective.inputs),
      json(objective.resolvedInputs),
      json(objective.missingRequirements),
      json(objective.supersedesObjectiveIds),
      json(objective.evidence),
      json(objective.blockers),
      COMMERCIAL_WORK_PAYLOAD_VERSION,
      objective.status === "COMPLETED" ? timestamp : null,
      objective.status === "CANCELLED" ? timestamp : null,
      objective.status === "SUPERSEDED" ? timestamp : null
    ]
  );
}

async function insertStep(connection: CommercialWorkSqlConnection, workRowId: number, step: CommercialWorkStep) {
  const timestamp = nowMysql();
  const idempotencyKey = step.idempotencyKey ?? (step.capabilityName ? `commercial-work-step:v1:${workRowId}:${step.stepId}`.slice(0, 191) : null);
  await connection.execute<ResultSetHeader>(
    `INSERT INTO ${COMMERCIAL_WORK_STEPS_TABLE} (
      public_id, commercial_work_id, primary_objective_public_id, objective_ids_json,
      step_type, capability_name, status, dependencies_json, input_json,
      evidence_json, blockers_json, retryable, retry_candidate,
      attempt_count, max_attempts, next_attempt_at, started_at, last_attempt_at, lock_owner, lock_until,
      idempotency_key,
      payload_version, completed_at, cancelled_at, superseded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      primary_objective_public_id = VALUES(primary_objective_public_id),
      objective_ids_json = VALUES(objective_ids_json),
      step_type = VALUES(step_type),
      capability_name = VALUES(capability_name),
      status = VALUES(status),
      dependencies_json = VALUES(dependencies_json),
      input_json = VALUES(input_json),
      evidence_json = VALUES(evidence_json),
      blockers_json = VALUES(blockers_json),
      retryable = VALUES(retryable),
      retry_candidate = VALUES(retry_candidate),
      attempt_count = VALUES(attempt_count),
      max_attempts = VALUES(max_attempts),
      next_attempt_at = VALUES(next_attempt_at),
      started_at = VALUES(started_at),
      last_attempt_at = VALUES(last_attempt_at),
      lock_owner = VALUES(lock_owner),
      lock_until = VALUES(lock_until),
      idempotency_key = VALUES(idempotency_key),
      payload_version = VALUES(payload_version),
      completed_at = COALESCE(completed_at, VALUES(completed_at)),
      cancelled_at = COALESCE(cancelled_at, VALUES(cancelled_at)),
      superseded_at = COALESCE(superseded_at, VALUES(superseded_at))`,
    [
      step.stepId,
      workRowId,
      step.objectiveIds[0] ?? null,
      json(step.objectiveIds),
      step.type,
      step.capabilityName,
      step.status,
      json(step.dependencies),
      json(step.input),
      json(step.evidence),
      json(step.blockers),
      step.retryable ? 1 : 0,
      step.retryCandidate ? 1 : 0,
      step.attemptCount,
      step.maxAttempts,
      toMysqlDateTime(step.nextAttemptAt),
      toMysqlDateTime(step.startedAt),
      toMysqlDateTime(step.lastAttemptAt),
      step.lockOwner,
      toMysqlDateTime(step.lockUntil),
      idempotencyKey,
      COMMERCIAL_WORK_PAYLOAD_VERSION,
      step.status === "COMPLETED" ? timestamp : null,
      step.status === "CANCELLED" ? timestamp : null,
      step.status === "SUPERSEDED" ? timestamp : null
    ]
  );
}

async function upsertChildren(connection: CommercialWorkSqlConnection, workRowId: number, work: CommercialWork) {
  for (const objective of work.objectives) await insertObjective(connection, workRowId, objective);
  for (const step of work.steps) await insertStep(connection, workRowId, step);
}

export async function persistCommercialWorkProjection(
  input: PersistCommercialWorkProjectionInput,
  adapterInput?: CommercialWorkDatabaseAdapter | null
): Promise<PersistCommercialWorkProjectionResult> {
  const adapter = adapterOrDefault(adapterInput);
  const publicId = input.publicId ?? `cw-${randomUUID()}`;
  const correlationKey = input.correlationKey ?? buildCommercialWorkCorrelationKey(input.work);
  const derivedAt = toMysqlDateTime(input.work.derivedAt) ?? nowMysql();

  try {
    const result = await adapter.withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [insertResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO ${COMMERCIAL_WORK_TABLE} (
            public_id, correlation_key, projection_id,
            opportunity_id, conversation_id, source_message_id,
            trigger_type, trigger_json, status, version, projection_version,
            payload_version, blockers_json, metrics_json, derived_at,
            completed_at, cancelled_at, cancel_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            publicId,
            correlationKey,
            input.work.id,
            input.work.opportunityId,
            input.work.conversationId,
            input.work.sourceMessageId,
            input.work.trigger.type,
            json(input.work.trigger),
            input.work.status,
            input.work.projectionVersion,
            COMMERCIAL_WORK_PAYLOAD_VERSION,
            json(input.work.blockers),
            json(input.work.metrics),
            derivedAt,
            input.work.status === "COMPLETED" ? derivedAt : null,
            input.work.status === "CANCELLED" ? derivedAt : null,
            null
          ]
        );
        await upsertChildren(connection, Number(insertResult.insertId), input.work);
        await connection.commit();
        return { status: "created" as const, publicId };
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          // keep original error
        }
        if (duplicateError(error)) return { status: "duplicate" as const, publicId: null };
        throw error;
      }
    });

    const work =
      result.status === "created"
        ? await getCommercialWorkByPublicId(result.publicId!, adapter)
        : await getCommercialWorkByCorrelationKey(correlationKey, adapter);
    if (!work) throw new CommercialWorkPersistenceError("PERSISTENCE_FAILURE", "commercial_work_reload_failed", { correlationKey });
    return { status: result.status, work };
  } catch (error) {
    throw persistenceError(error);
  }
}

export async function getCommercialWorkById(id: number, adapterInput?: CommercialWorkDatabaseAdapter | null): Promise<PersistedCommercialWork | null> {
  return loadByWhere("id = ?", [id], adapterOrDefault(adapterInput));
}

export async function getCommercialWorkByPublicId(publicId: string, adapterInput?: CommercialWorkDatabaseAdapter | null): Promise<PersistedCommercialWork | null> {
  return loadByWhere("public_id = ?", [publicId], adapterOrDefault(adapterInput));
}

export async function getCommercialWorkByCorrelationKey(
  correlationKey: string,
  adapterInput?: CommercialWorkDatabaseAdapter | null
): Promise<PersistedCommercialWork | null> {
  return loadByWhere("correlation_key = ?", [correlationKey], adapterOrDefault(adapterInput));
}

export async function findActiveCommercialWorks(
  input: FindActiveCommercialWorkInput,
  adapterInput?: CommercialWorkDatabaseAdapter | null
): Promise<PersistedCommercialWork[]> {
  const adapter = adapterOrDefault(adapterInput);
  const where: string[] = [`status IN (${ACTIVE_WORK_STATUSES.map(() => "?").join(",")})`];
  const params: unknown[] = [...ACTIVE_WORK_STATUSES];
  if (typeof input.opportunityId === "number") {
    where.push("opportunity_id = ?");
    params.push(input.opportunityId);
  }
  if (typeof input.conversationId === "number") {
    where.push("conversation_id = ?");
    params.push(input.conversationId);
  }
  params.push(Math.max(1, Math.min(input.limit ?? 20, 100)));
  const rows = await adapter.queryRows<Record<string, unknown>>(
    `SELECT * FROM ${COMMERCIAL_WORK_TABLE} WHERE ${where.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT ?`,
    params
  );
  const hydrated: PersistedCommercialWork[] = [];
  for (const row of rows) hydrated.push(await hydrateWork(row, adapter));
  return hydrated;
}

export async function updateCommercialWorkAggregate(
  input: UpdateCommercialWorkAggregateInput,
  adapterInput?: CommercialWorkDatabaseAdapter | null
): Promise<PersistedCommercialWork> {
  const adapter = adapterOrDefault(adapterInput);
  const previous = await getCommercialWorkByPublicId(input.publicId, adapter);
  if (!previous) throw new CommercialWorkPersistenceError("NOT_FOUND", `CommercialWork not found: ${input.publicId}`);
  if (previous.version !== input.expectedVersion) {
    throw new CommercialWorkPersistenceError("VERSION_CONFLICT", `CommercialWork version conflict: ${input.publicId}`, {
      expectedVersion: input.expectedVersion,
      actualVersion: previous.version
    });
  }
  validateAggregateTransition(previous, input.nextWork);

  try {
    await adapter.withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [updateResult] = await connection.execute<ResultSetHeader>(
          `UPDATE ${COMMERCIAL_WORK_TABLE}
            SET status = ?,
                version = version + 1,
                projection_id = ?,
                trigger_type = ?,
                trigger_json = ?,
                blockers_json = ?,
                metrics_json = ?,
                derived_at = ?,
                completed_at = CASE WHEN ? = 'COMPLETED' THEN COALESCE(completed_at, CURRENT_TIMESTAMP(3)) ELSE completed_at END,
                cancelled_at = CASE WHEN ? = 'CANCELLED' THEN COALESCE(cancelled_at, CURRENT_TIMESTAMP(3)) ELSE cancelled_at END,
                cancel_reason = CASE WHEN ? = 'CANCELLED' THEN ? ELSE cancel_reason END
            WHERE public_id = ? AND version = ?`,
          [
            input.nextWork.status,
            input.nextWork.id,
            input.nextWork.trigger.type,
            json(input.nextWork.trigger),
            json(input.nextWork.blockers),
            json(input.nextWork.metrics),
            toMysqlDateTime(input.nextWork.derivedAt) ?? nowMysql(),
            input.nextWork.status,
            input.nextWork.status,
            input.nextWork.status,
            input.cancelReason ?? null,
            input.publicId,
            input.expectedVersion
          ]
        );
        if (updateResult.affectedRows <= 0) {
          throw new CommercialWorkPersistenceError("VERSION_CONFLICT", `CommercialWork version conflict: ${input.publicId}`, {
            expectedVersion: input.expectedVersion
          });
        }

        const [rows] = await connection.execute<RowDataPacket[]>(`SELECT id FROM ${COMMERCIAL_WORK_TABLE} WHERE public_id = ? LIMIT 1`, [input.publicId]);
        const rowId = asNumber((rows[0] as Record<string, unknown> | undefined)?.id);
        if (!rowId) throw new CommercialWorkPersistenceError("PERSISTENCE_FAILURE", "commercial_work_reload_failed", { publicId: input.publicId });
        await upsertChildren(connection, rowId, input.nextWork);
        await connection.commit();
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          // keep original error
        }
        throw error;
      }
    });
  } catch (error) {
    throw persistenceError(error);
  }

  const updated = await getCommercialWorkByPublicId(input.publicId, adapter);
  if (!updated) throw new CommercialWorkPersistenceError("PERSISTENCE_FAILURE", "commercial_work_reload_failed", { publicId: input.publicId });
  return updated;
}

export async function transitionCommercialWorkStatus(
  input: CommercialWorkStatusTransitionInput,
  adapterInput?: CommercialWorkDatabaseAdapter | null
): Promise<PersistedCommercialWork> {
  const current = await getCommercialWorkByPublicId(input.publicId, adapterInput);
  if (!current) throw new CommercialWorkPersistenceError("NOT_FOUND", `CommercialWork not found: ${input.publicId}`);
  return updateCommercialWorkAggregate(
    {
      publicId: input.publicId,
      expectedVersion: input.expectedVersion,
      cancelReason: input.cancelReason ?? null,
      nextWork: { ...current, status: input.status, metrics: deriveCommercialWorkMetrics(current) }
    },
    adapterInput
  );
}

export async function transitionCommercialWorkStepStatus(
  input: CommercialWorkStepStatusTransitionInput,
  adapterInput?: CommercialWorkDatabaseAdapter | null
): Promise<PersistedCommercialWork> {
  const current = await getCommercialWorkByPublicId(input.publicId, adapterInput);
  if (!current) throw new CommercialWorkPersistenceError("NOT_FOUND", `CommercialWork not found: ${input.publicId}`);
  const steps = current.steps.map((step) =>
    step.stepId === input.stepId ? { ...step, status: input.status, evidence: input.evidence ?? step.evidence, blockers: input.blockers ?? step.blockers } : step
  );
  if (!steps.some((step) => step.stepId === input.stepId)) throw new CommercialWorkPersistenceError("NOT_FOUND", `CommercialWorkStep not found: ${input.stepId}`);
  return updateCommercialWorkAggregate(
    {
      publicId: input.publicId,
      expectedVersion: input.expectedVersion,
      nextWork: { ...current, steps, metrics: deriveCommercialWorkMetrics({ ...current, steps }) }
    },
    adapterInput
  );
}

export async function transitionCommercialObjectiveStatus(
  input: CommercialObjectiveStatusTransitionInput,
  adapterInput?: CommercialWorkDatabaseAdapter | null
): Promise<PersistedCommercialWork> {
  const current = await getCommercialWorkByPublicId(input.publicId, adapterInput);
  if (!current) throw new CommercialWorkPersistenceError("NOT_FOUND", `CommercialWork not found: ${input.publicId}`);
  const objectives = current.objectives.map((objective) =>
    objective.objectiveId === input.objectiveId
      ? { ...objective, status: input.status, evidence: input.evidence ?? objective.evidence, blockers: input.blockers ?? objective.blockers }
      : objective
  );
  if (!objectives.some((objective) => objective.objectiveId === input.objectiveId)) {
    throw new CommercialWorkPersistenceError("NOT_FOUND", `CommercialObjective not found: ${input.objectiveId}`);
  }
  return updateCommercialWorkAggregate(
    {
      publicId: input.publicId,
      expectedVersion: input.expectedVersion,
      nextWork: { ...current, objectives, metrics: deriveCommercialWorkMetrics({ ...current, objectives }) }
    },
    adapterInput
  );
}
