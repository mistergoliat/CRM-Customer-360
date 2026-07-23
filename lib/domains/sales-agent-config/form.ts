// Imported from their leaf modules, never the aggregating barrel
// (index.ts) - the barrel re-exports repository.ts/publish.ts, which pull
// in lib/audit.ts -> next/headers. This module is bundled into the Hub's
// client component, so any runtime import from the barrel would drag a
// server-only chain into the browser bundle and fail the build.
import { SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT } from "@/lib/brain/commercial/sales-agent-configuration/defaults";
import type {
  EffectiveSalesAgentModelConfiguration,
  ResolvedSalesAgentConfigurationSource,
  SalesAgentConfigurationDocument,
  SalesAgentConfigurationStatus,
  SalesAgentLoopConfiguration
} from "@/lib/brain/commercial/sales-agent-configuration/types";

/**
 * ACS-R1-05.1-T02.3C. Pure, framework-free mapping between the persisted
 * SalesAgentConfigurationDocument (or its resolved effective values) and
 * the flat shape the Hub form actually edits. No fetch, no React - kept
 * testable with plain node:test.
 */
export type SalesAgentConfigurationFormState = {
  agentName: string;
  companyName: string;
  role: string;
  companyDescription: string;
  customInstructions: string;
  prohibitedPhrases: string[];
  /** Whether the draft owns an explicit modelConfiguration section at all - see mapFormStateToPayload. */
  modelConfigurationEnabled: boolean;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxModelRetries: number;
  /** Whether the draft owns an explicit loopConfiguration section at all. */
  loopConfigurationEnabled: boolean;
  maxAgentStepsPerTurn: number;
  maxToolCallsPerTurn: number;
};

/**
 * Seeds the form when a section is toggled on for the first time (no
 * stored modelConfiguration to read from yet) - the resolver's own safe
 * default, never an invented number, so the starting point always matches
 * what the runtime would already be doing today.
 */
export function mapConfigurationToFormState(
  configuration: SalesAgentConfigurationDocument,
  effectiveModel: EffectiveSalesAgentModelConfiguration,
  effectiveLoop: SalesAgentLoopConfiguration
): SalesAgentConfigurationFormState {
  const model = configuration.modelConfiguration;
  const loop = configuration.loopConfiguration;

  return {
    agentName: configuration.agentName,
    companyName: configuration.companyName,
    role: configuration.role,
    companyDescription: configuration.companyDescription,
    customInstructions: configuration.customInstructions,
    prohibitedPhrases: [...configuration.prohibitedPhrases],
    modelConfigurationEnabled: Boolean(model),
    model: model?.model ?? effectiveModel.model,
    temperature: model?.temperature ?? effectiveModel.temperature,
    // effectiveModel.maxOutputTokens is only absent when nothing published
    // ever configured it ("sin limite configurado") - seed with the safe
    // default only as a starting point for editing, never submitted unless
    // the operator explicitly turns modelConfigurationEnabled on.
    maxOutputTokens: model?.maxOutputTokens ?? effectiveModel.maxOutputTokens ?? SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT.maxOutputTokens,
    timeoutMs: model?.timeoutMs ?? effectiveModel.timeoutMs,
    maxModelRetries: model?.maxModelRetries ?? effectiveModel.maxModelRetries,
    loopConfigurationEnabled: Boolean(loop),
    maxAgentStepsPerTurn: loop?.maxAgentStepsPerTurn ?? effectiveLoop.maxAgentStepsPerTurn,
    maxToolCallsPerTurn: loop?.maxToolCallsPerTurn ?? effectiveLoop.maxToolCallsPerTurn
  };
}

/**
 * Inverse mapping. Deliberately all-or-nothing per section, matching the
 * domain schema (SalesAgentModelConfiguration/SalesAgentLoopConfiguration
 * require every field together, there is no partial-field persistence) -
 * this is what keeps "sin limite configurado" honest: unless the operator
 * explicitly enabled the section, nothing from it is ever persisted, so an
 * unmodified effective default can never silently turn into a stored
 * override.
 */
export function mapFormStateToPayload(form: SalesAgentConfigurationFormState): SalesAgentConfigurationDocument {
  return {
    agentName: form.agentName,
    companyName: form.companyName,
    role: form.role,
    companyDescription: form.companyDescription,
    customInstructions: form.customInstructions,
    prohibitedPhrases: form.prohibitedPhrases,
    ...(form.modelConfigurationEnabled
      ? {
          modelConfiguration: {
            model: form.model,
            temperature: form.temperature,
            maxOutputTokens: form.maxOutputTokens,
            timeoutMs: form.timeoutMs,
            maxModelRetries: form.maxModelRetries
          }
        }
      : {}),
    ...(form.loopConfigurationEnabled
      ? {
          loopConfiguration: {
            maxAgentStepsPerTurn: form.maxAgentStepsPerTurn,
            maxToolCallsPerTurn: form.maxToolCallsPerTurn
          }
        }
      : {})
  };
}

/**
 * ACS-R1-05.1-T02.3C review correction. Publishing or archiving the SAME
 * draft the operator is currently editing, while it has unsaved local
 * changes, must be blocked outright - the API only ever acts on what's
 * already persisted, so proceeding would publish/archive stale content
 * without the operator realizing their on-screen edits were never saved.
 * A different draft (targetId !== currentDraftId) is unaffected by this -
 * the caller still separately prompts for confirmation in that case, since
 * the operator's unsaved edits (elsewhere) aren't at risk of being
 * silently acted on, just easy to forget about.
 */
export function isEditingDirtyDraft(currentDraftId: number | null, targetId: number, dirty: boolean): boolean {
  return dirty && currentDraftId === targetId;
}

/**
 * One line per phrase (textarea input). Same normalization as the domain
 * validator (normalizeConfigurationText: collapse whitespace, trim) plus
 * dedup, so the count/preview the operator sees before saving matches what
 * the backend will actually store - never a second, divergent rule.
 */
export function normalizeProhibitedPhrasesInput(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of raw.split("\n")) {
    const normalized = line.replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/** Plain-data form state constructed the same way on both sides - JSON comparison is safe, no key-order drift. */
export function computeFormDirty(saved: SalesAgentConfigurationFormState, current: SalesAgentConfigurationFormState): boolean {
  return JSON.stringify(saved) !== JSON.stringify(current);
}

export type SalesAgentConfigurationApiErrorBody = {
  error?: string;
  field?: string | null;
  reason?: string;
} | null;

/** Maps a Route Handler error response into a message safe to show an operator - never the raw domain code/stack. */
export function mapConfigurationApiError(body: SalesAgentConfigurationApiErrorBody, status: number): string {
  const code = body?.error;
  switch (code) {
    case "DB_WRITE_DISABLED":
      return "Las escrituras estan deshabilitadas en este entorno.";
    case "invalid_id":
      return "Identificador de configuracion invalido.";
    case "not_found":
      return "La configuracion no existe.";
    case "not_draft":
      return "Solo se puede editar, publicar o archivar un borrador.";
    case "concurrent_edit_conflict":
      return "Otro cambio se guardo primero. Recarga antes de continuar.";
    case "configuration_lock_timeout":
      return "El sistema esta ocupado, intenta de nuevo en unos segundos.";
    case "missing_expected_updated_at":
      return "Falta la referencia de version para guardar.";
    case "missing_name":
      return "El nombre de la configuracion es obligatorio.";
    case "invalid_body":
      return "Solicitud invalida.";
    case "payload_too_large":
      return "La configuracion supera el tamano maximo permitido.";
    case "model_not_allowed":
      return "El modelo seleccionado no esta permitido en este despliegue.";
    default:
      if (body?.reason) return body.reason;
      if (status >= 500) return "Error interno al procesar la configuracion.";
      return code ?? "La operacion no se pudo completar.";
  }
}

export function describeConfigurationSource(source: ResolvedSalesAgentConfigurationSource): { label: string; tone: "green" | "blue" | "gray" } {
  if (source === "published") return { label: "Publicado", tone: "green" };
  if (source === "deployment_default") return { label: "Default de despliegue", tone: "blue" };
  return { label: "Safe default", tone: "gray" };
}

export function describeConfigurationStatus(status: SalesAgentConfigurationStatus): { label: string; tone: "amber" | "green" | "gray" } {
  if (status === "draft") return { label: "Borrador", tone: "amber" };
  if (status === "published") return { label: "Publicado", tone: "green" };
  return { label: "Archivado", tone: "gray" };
}
