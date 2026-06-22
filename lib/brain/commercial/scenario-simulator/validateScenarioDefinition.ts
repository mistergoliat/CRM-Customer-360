import {
  SCENARIO_ALLOWED_CATEGORIES,
  SCENARIO_ALLOWED_PATHS,
  containsForbiddenScenarioText,
  isScenarioRecipientAllowed
} from "./constants";
import type { ScenarioDefinition, ScenarioValidationError, ScenarioValidationResult } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return !Number.isNaN(new Date(value).getTime());
}

function pushError(errors: ScenarioValidationError[], code: string, messageSafe: string, path: string): void {
  errors.push({ code, messageSafe, path });
}

function scanForUnsafeStrings(value: unknown, path: string, errors: ScenarioValidationError[]): void {
  if (typeof value === "string") {
    if (containsForbiddenScenarioText(value)) {
      pushError(errors, "unsafe_string", "Scenario contains forbidden live-looking text.", path);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForUnsafeStrings(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    scanForUnsafeStrings(nested, `${path}.${key}`, errors);
  }
}

function validateStepInput(step: ScenarioDefinition["steps"][number], index: number, errors: ScenarioValidationError[], tenantId: string | null): string | null {
  const input = step.input;
  if (!isRecord(input)) {
    pushError(errors, "invalid_step_input", "Step input must be an object.", `steps[${index}].input`);
    return null;
  }

  if (!isIsoTimestamp(input.now)) pushError(errors, "invalid_timestamp", "Step timestamp must be valid ISO.", `steps[${index}].input.now`);
  if (!asText(input.correlationId)) pushError(errors, "missing_correlation_id", "Correlation id is required.", `steps[${index}].input.correlationId`);
  if (!asText(input.tenantId)) pushError(errors, "missing_tenant_id", "Tenant id is required.", `steps[${index}].input.tenantId`);
  if (!isIsoTimestamp(input.inbound?.receivedAt)) pushError(errors, "invalid_timestamp", "Inbound timestamp must be valid ISO.", `steps[${index}].input.inbound.receivedAt`);

  const waId = asText(input.inbound?.waId);
  if (!waId) {
    pushError(errors, "missing_recipient", "Inbound recipient is required.", `steps[${index}].input.inbound.waId`);
  } else if (!isScenarioRecipientAllowed(waId)) {
    pushError(errors, "real_looking_recipient", "Only reserved synthetic recipients are allowed.", `steps[${index}].input.inbound.waId`);
  }

  const whitelistedWaIds = Array.isArray(input.configuration?.whitelistedWaIds) ? input.configuration.whitelistedWaIds : [];
  if (whitelistedWaIds.length === 0) {
    pushError(errors, "missing_whitelist", "Synthetic whitelist cannot be empty.", `steps[${index}].input.configuration.whitelistedWaIds`);
  }
  for (const [whitelistIndex, recipient] of whitelistedWaIds.entries()) {
    if (!isScenarioRecipientAllowed(recipient)) {
      pushError(errors, "real_looking_recipient", "Synthetic whitelist contains a non-reserved recipient.", `steps[${index}].input.configuration.whitelistedWaIds[${whitelistIndex}]`);
    }
  }

  if (tenantId && asText(input.tenantId) && input.tenantId !== tenantId) {
    pushError(errors, "tenant_mismatch", "All steps must share the same synthetic tenant.", `steps[${index}].input.tenantId`);
  }

  scanForUnsafeStrings(step, `steps[${index}]`, errors);
  return asText(input.tenantId) ?? tenantId;
}

export function validateScenarioDefinition(value: ScenarioDefinition): ScenarioValidationResult {
  const errors: ScenarioValidationError[] = [];
  const warnings: string[] = [];

  if (!isRecord(value)) {
    pushError(errors, "invalid_root", "Scenario definition must be an object.", "scenario");
    return { ok: false, value: null, warnings, errors };
  }

  const scenarioId = asText(value.scenarioId);
  const name = asText(value.name);
  const description = asText(value.description);
  const category = asText(value.category);
  if (!scenarioId) pushError(errors, "missing_scenario_id", "Scenario id is required.", "scenarioId");
  if (!name) pushError(errors, "missing_name", "Scenario name is required.", "name");
  if (!description) pushError(errors, "missing_description", "Scenario description is required.", "description");
  if (!category || !(SCENARIO_ALLOWED_CATEGORIES as readonly string[]).includes(category)) {
    pushError(errors, "invalid_category", "Scenario category is not supported.", "category");
  }
  if (!isRecord(value.metadata)) {
    pushError(errors, "invalid_metadata", "Scenario metadata is required.", "metadata");
  } else {
    if (value.metadata.version !== "brain.commercial.scenario-simulator.v1") {
      warnings.push("Scenario metadata version does not match the simulator version.");
    }
    if (value.metadata.deterministic !== true) pushError(errors, "invalid_metadata", "Scenario metadata must declare deterministic=true.", "metadata.deterministic");
    if (value.metadata.syntheticDataOnly !== true) {
      pushError(errors, "invalid_metadata", "Scenario metadata must declare syntheticDataOnly=true.", "metadata.syntheticDataOnly");
    }
  }

  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    pushError(errors, "empty_steps", "Scenario must include at least one step.", "steps");
  }
  if (!Array.isArray(value.expectations)) {
    pushError(errors, "invalid_expectations", "Scenario expectations must be an array.", "expectations");
  }
  if (!isRecord(value.initialState)) {
    pushError(errors, "invalid_initial_state", "Scenario initial state is required.", "initialState");
  } else {
    if (!isRecord(value.initialState.runtimeSeed)) {
      pushError(errors, "invalid_initial_state", "Scenario runtime seed is required.", "initialState.runtimeSeed");
    }
    if (!isRecord(value.initialState.configuration)) {
      pushError(errors, "invalid_initial_state", "Scenario configuration is required.", "initialState.configuration");
    }
  }

  const stepIds = new Set<string>();
  let tenantId: string | null = null;
  const steps = Array.isArray(value.steps) ? value.steps : [];
  for (const [index, step] of steps.entries()) {
    if (!isRecord(step)) {
      pushError(errors, "invalid_step", "Step must be an object.", `steps[${index}]`);
      continue;
    }
    const stepId = asText(step.stepId);
    const title = asText(step.title);
    if (!stepId) {
      pushError(errors, "missing_step_id", "Step id is required.", `steps[${index}].stepId`);
    } else if (stepIds.has(stepId)) {
      pushError(errors, "duplicate_step_id", "Step ids must be unique.", `steps[${index}].stepId`);
    } else {
      stepIds.add(stepId);
    }
    if (!title) pushError(errors, "missing_step_title", "Step title is required.", `steps[${index}].title`);
    if (!isIsoTimestamp(step.now)) pushError(errors, "invalid_timestamp", "Step now must be valid ISO.", `steps[${index}].now`);

    const mode = asText(step.mode);
    if (!mode || !["observe", "simulate", "execute_fake"].includes(mode)) {
      pushError(errors, "invalid_mode", "Step mode is invalid.", `steps[${index}].mode`);
    }

    if (!Array.isArray(step.expectedCheckpointIds)) {
      pushError(errors, "invalid_checkpoints", "Expected checkpoint ids must be an array.", `steps[${index}].expectedCheckpointIds`);
    }

    tenantId = validateStepInput(step as ScenarioDefinition["steps"][number], index, errors, tenantId);
  }

  const expectations = Array.isArray(value.expectations) ? value.expectations : [];
  for (const [index, expectation] of expectations.entries()) {
    if (!isRecord(expectation)) {
      pushError(errors, "invalid_expectation", "Expectation must be an object.", `expectations[${index}]`);
      continue;
    }
    if (!asText(expectation.expectationId)) pushError(errors, "missing_expectation_id", "Expectation id is required.", `expectations[${index}].expectationId`);
    const stepId = expectation.stepId === null ? null : asText(expectation.stepId);
    if (expectation.stepId !== null && !stepId) {
      pushError(errors, "invalid_expectation_step", "Expectation step id must be valid or null.", `expectations[${index}].stepId`);
    }
    if (!asText(expectation.type)) pushError(errors, "invalid_expectation_type", "Expectation type is required.", `expectations[${index}].type`);
    const path = asText(expectation.path);
    if (!path || !(SCENARIO_ALLOWED_PATHS as readonly string[]).includes(path)) {
      pushError(errors, "invalid_expectation_path", "Expectation path is not supported.", `expectations[${index}].path`);
    }
    if (!asText(expectation.operator) || !["equals", "not_equals", "contains", "exists", "not_exists", "greater_than", "less_than"].includes(expectation.operator)) {
      pushError(errors, "invalid_expectation_operator", "Expectation operator is not supported.", `expectations[${index}].operator`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, value: null, warnings, errors };
  }

  const normalizedTenant = tenantId ?? "tenant-scenario-simulator";
  if (steps.some((step) => asText(step.input?.tenantId) !== normalizedTenant)) {
    pushError(errors, "tenant_mismatch", "All steps must share the same synthetic tenant.", "steps");
    return { ok: false, value: null, warnings, errors };
  }

  return {
    ok: true,
    value,
    warnings
  };
}
