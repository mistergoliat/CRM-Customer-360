import assert from "node:assert/strict";
import test from "node:test";
import { SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT } from "@/lib/brain/commercial/sales-agent-configuration";
import {
  computeFormDirty,
  describeConfigurationSource,
  describeConfigurationStatus,
  isEditingDirtyDraft,
  mapConfigurationApiError,
  mapConfigurationToFormState,
  mapFormStateToPayload,
  normalizeProhibitedPhrasesInput,
  type SalesAgentConfigurationFormState
} from "@/lib/domains/sales-agent-config/form";

const EFFECTIVE_MODEL_WITH_LIMIT = {
  model: "brain-agent-loop",
  temperature: 0.2,
  maxOutputTokens: 512,
  timeoutMs: 15000,
  maxModelRetries: 1
};

const EFFECTIVE_MODEL_NO_LIMIT = {
  model: "brain-agent-loop",
  temperature: 0,
  timeoutMs: 20000,
  maxModelRetries: 0
};

const EFFECTIVE_LOOP = { maxAgentStepsPerTurn: 3, maxToolCallsPerTurn: 2 };

const BASE_PROMPT_CONFIGURATION = {
  agentName: "Valentina",
  companyName: "PesasChile",
  role: "Asesora comercial",
  companyDescription: "Vendemos equipamiento de gimnasio.",
  customInstructions: "",
  prohibitedPhrases: ["garantia de por vida"]
};

// ---------------------------------------------------------------------------
// mapConfigurationToFormState / mapFormStateToPayload
// ---------------------------------------------------------------------------

test("[F1] mapConfigurationToFormState: a v1 document (no model/loop section) resolves to effective values and disabled toggles", () => {
  const form = mapConfigurationToFormState(BASE_PROMPT_CONFIGURATION, EFFECTIVE_MODEL_WITH_LIMIT, EFFECTIVE_LOOP);
  assert.equal(form.modelConfigurationEnabled, false);
  assert.equal(form.loopConfigurationEnabled, false);
  assert.equal(form.model, EFFECTIVE_MODEL_WITH_LIMIT.model);
  assert.equal(form.temperature, EFFECTIVE_MODEL_WITH_LIMIT.temperature);
  assert.equal(form.maxOutputTokens, EFFECTIVE_MODEL_WITH_LIMIT.maxOutputTokens);
  assert.equal(form.maxAgentStepsPerTurn, EFFECTIVE_LOOP.maxAgentStepsPerTurn);
});

test("[F2] mapConfigurationToFormState: absent effective maxOutputTokens seeds the safe default, never blank/NaN", () => {
  const form = mapConfigurationToFormState(BASE_PROMPT_CONFIGURATION, EFFECTIVE_MODEL_NO_LIMIT, EFFECTIVE_LOOP);
  assert.equal(form.maxOutputTokens, SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT.maxOutputTokens);
});

test("[F3] mapConfigurationToFormState: a document WITH modelConfiguration/loopConfiguration enables both toggles and reads its own values", () => {
  const document = {
    ...BASE_PROMPT_CONFIGURATION,
    modelConfiguration: { model: "custom-model", temperature: 0.7, maxOutputTokens: 999, timeoutMs: 9000, maxModelRetries: 3 },
    loopConfiguration: { maxAgentStepsPerTurn: 5, maxToolCallsPerTurn: 4 }
  };
  const form = mapConfigurationToFormState(document, EFFECTIVE_MODEL_WITH_LIMIT, EFFECTIVE_LOOP);
  assert.equal(form.modelConfigurationEnabled, true);
  assert.equal(form.loopConfigurationEnabled, true);
  assert.equal(form.model, "custom-model");
  assert.equal(form.maxAgentStepsPerTurn, 5);
});

test("[F4] mapFormStateToPayload: disabled sections are entirely absent from the payload (never a partially-filled section)", () => {
  const form = mapConfigurationToFormState(BASE_PROMPT_CONFIGURATION, EFFECTIVE_MODEL_WITH_LIMIT, EFFECTIVE_LOOP);
  const payload = mapFormStateToPayload(form);
  assert.equal("modelConfiguration" in payload, false);
  assert.equal("loopConfiguration" in payload, false);
  assert.deepEqual(payload.prohibitedPhrases, BASE_PROMPT_CONFIGURATION.prohibitedPhrases);
});

test("[F5] mapFormStateToPayload: enabling a section persists all of its fields together, never a partial subset", () => {
  const form: SalesAgentConfigurationFormState = {
    ...mapConfigurationToFormState(BASE_PROMPT_CONFIGURATION, EFFECTIVE_MODEL_WITH_LIMIT, EFFECTIVE_LOOP),
    modelConfigurationEnabled: true,
    temperature: 0.9
  };
  const payload = mapFormStateToPayload(form);
  assert.ok(payload.modelConfiguration);
  assert.equal(payload.modelConfiguration?.temperature, 0.9);
  assert.equal(payload.modelConfiguration?.model, EFFECTIVE_MODEL_WITH_LIMIT.model);
  assert.equal(payload.modelConfiguration?.maxOutputTokens, form.maxOutputTokens);
});

// ---------------------------------------------------------------------------
// normalizeProhibitedPhrasesInput
// ---------------------------------------------------------------------------

test("[F6] normalizeProhibitedPhrasesInput: trims, collapses whitespace, drops blanks, dedupes", () => {
  const result = normalizeProhibitedPhrasesInput("  garantia   de por vida \n\nsin costo\ngarantia de por vida\n   \nsin costo");
  assert.deepEqual(result, ["garantia de por vida", "sin costo"]);
});

test("[F7] normalizeProhibitedPhrasesInput: empty input returns an empty array", () => {
  assert.deepEqual(normalizeProhibitedPhrasesInput(""), []);
  assert.deepEqual(normalizeProhibitedPhrasesInput("\n\n  \n"), []);
});

// ---------------------------------------------------------------------------
// computeFormDirty
// ---------------------------------------------------------------------------

test("[F8] computeFormDirty: identical form states are not dirty", () => {
  const form = mapConfigurationToFormState(BASE_PROMPT_CONFIGURATION, EFFECTIVE_MODEL_WITH_LIMIT, EFFECTIVE_LOOP);
  assert.equal(computeFormDirty(form, { ...form }), false);
});

test("[F9] computeFormDirty: any field change makes the form dirty", () => {
  const form = mapConfigurationToFormState(BASE_PROMPT_CONFIGURATION, EFFECTIVE_MODEL_WITH_LIMIT, EFFECTIVE_LOOP);
  assert.equal(computeFormDirty(form, { ...form, agentName: "Otra" }), true);
  assert.equal(computeFormDirty(form, { ...form, prohibitedPhrases: [...form.prohibitedPhrases, "nueva frase"] }), true);
});

// ---------------------------------------------------------------------------
// mapConfigurationApiError
// ---------------------------------------------------------------------------

test("[F10] mapConfigurationApiError: known codes map to a stable, human message", () => {
  assert.equal(mapConfigurationApiError({ error: "not_draft" }, 409), "Solo se puede editar, publicar o archivar un borrador.");
  assert.equal(
    mapConfigurationApiError({ error: "concurrent_edit_conflict" }, 409),
    "Otro cambio se guardo primero. Recarga antes de continuar."
  );
  assert.equal(mapConfigurationApiError({ error: "DB_WRITE_DISABLED" }, 409), "Las escrituras estan deshabilitadas en este entorno.");
});

test("[F11] mapConfigurationApiError: an unknown code with a reason surfaces the reason, never a raw stack/internal string", () => {
  assert.equal(mapConfigurationApiError({ error: "field_too_long", reason: "agentName exceeds 80 characters" }, 400), "agentName exceeds 80 characters");
});

test("[F12] mapConfigurationApiError: 5xx with no known code/reason falls back to a generic internal message", () => {
  assert.equal(mapConfigurationApiError(null, 500), "Error interno al procesar la configuracion.");
});

// ---------------------------------------------------------------------------
// describeConfigurationSource / describeConfigurationStatus
// ---------------------------------------------------------------------------

test("[F13] describeConfigurationSource: covers all three sources with distinct tones", () => {
  assert.deepEqual(describeConfigurationSource("published"), { label: "Publicado", tone: "green" });
  assert.deepEqual(describeConfigurationSource("deployment_default"), { label: "Default de despliegue", tone: "blue" });
  assert.deepEqual(describeConfigurationSource("safe_default"), { label: "Safe default", tone: "gray" });
});

test("[F14] describeConfigurationStatus: covers all three lifecycle statuses with distinct tones", () => {
  assert.deepEqual(describeConfigurationStatus("draft"), { label: "Borrador", tone: "amber" });
  assert.deepEqual(describeConfigurationStatus("published"), { label: "Publicado", tone: "green" });
  assert.deepEqual(describeConfigurationStatus("archived"), { label: "Archivado", tone: "gray" });
});

// ---------------------------------------------------------------------------
// isEditingDirtyDraft (review correction: block publish/archive of the
// currently-edited draft while it has unsaved changes)
// ---------------------------------------------------------------------------

test("[F15] isEditingDirtyDraft: blocks only when the target IS the currently-edited draft AND it is dirty", () => {
  assert.equal(isEditingDirtyDraft(5, 5, true), true, "same draft, dirty -> block");
  assert.equal(isEditingDirtyDraft(5, 5, false), false, "same draft, clean -> allowed");
  assert.equal(isEditingDirtyDraft(5, 7, true), false, "different draft, dirty -> not blocked (caller asks for confirmation instead)");
  assert.equal(isEditingDirtyDraft(5, 7, false), false, "different draft, clean -> allowed");
  assert.equal(isEditingDirtyDraft(null, 7, true), false, "no draft being edited yet -> never blocked");
});
