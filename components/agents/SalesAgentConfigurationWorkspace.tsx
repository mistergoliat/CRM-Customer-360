"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DB_WRITE_DISABLED_MESSAGE } from "@/lib/action-policy";
import { Icon } from "@/components/ui/Icon";
import { StatusChip } from "@/components/ui/StatusChip";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { TabStrip } from "@/components/p1m/TabStrip";
// Leaf-module imports only, never the aggregating barrel (index.ts) - the
// barrel re-exports repository.ts/publish.ts, which pull in lib/audit.ts ->
// next/headers, which cannot be bundled into this client component.
import {
  SALES_AGENT_CONFIGURATION_LIMITS,
  SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS,
  SALES_AGENT_LOOP_CONFIGURATION_LIMITS,
  SALES_AGENT_MODEL_CONFIGURATION_LIMITS
} from "@/lib/brain/commercial/sales-agent-configuration/constants";
import type { ResolvedSalesAgentConfiguration, SalesAgentConfigurationRecord } from "@/lib/brain/commercial/sales-agent-configuration/types";
import {
  computeFormDirty,
  describeConfigurationSource,
  formatAttemptDelaysMinutesInput,
  isEditingDirtyDraft,
  mapConfigurationApiError,
  mapConfigurationToFormState,
  mapFormStateToPayload,
  normalizeProhibitedPhrasesInput,
  parseAttemptDelaysMinutesInput,
  type SalesAgentConfigurationFormState
} from "@/lib/domains/sales-agent-config/form";
import { SalesAgentConfigurationVersionsTable } from "./SalesAgentConfigurationVersionsTable";

type Tab = "identidad" | "modelo" | "ejecucion" | "seguimiento" | "versiones";

const FOLLOW_UP_WEEKDAYS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mie" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sab" },
  { value: 0, label: "Dom" }
] as const;

type Props = {
  effective: ResolvedSalesAgentConfiguration;
  versions: SalesAgentConfigurationRecord[];
  selectedDraft: SalesAgentConfigurationRecord | null;
  allowedModels: string[];
  writeEnabled: boolean;
};

const API_BASE = "/api/brain/agents/sales/configuration";

type ApiErrorBody = { error?: string; field?: string | null; reason?: string } | null;

export function SalesAgentConfigurationWorkspace({ effective, versions, selectedDraft, allowedModels, writeEnabled }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("identidad");
  const [draft, setDraft] = useState(selectedDraft);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(selectedDraft?.updatedAt ?? null);
  const [recordName, setRecordName] = useState(selectedDraft?.name ?? "Sales Agent - PesasChile");

  const initialForm = mapConfigurationToFormState(
    draft?.configuration ?? effective.configuration,
    effective.effectiveModelConfiguration,
    effective.effectiveLoopConfiguration,
    effective.effectiveFollowUpConfiguration
  );
  const [form, setForm] = useState<SalesAgentConfigurationFormState>(initialForm);
  const [savedForm, setSavedForm] = useState<SalesAgentConfigurationFormState>(initialForm);
  const [savedRecordName, setSavedRecordName] = useState(recordName);
  const [phrasesText, setPhrasesText] = useState(initialForm.prohibitedPhrases.join("\n"));
  const [delaysText, setDelaysText] = useState(formatAttemptDelaysMinutesInput(initialForm.followUpAttemptDelaysMinutes));

  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string | null; reason: string } | null>(null);
  const [conflict, setConflict] = useState(false);

  const currentPhrases = normalizeProhibitedPhrasesInput(phrasesText);
  const currentDelays = parseAttemptDelaysMinutesInput(delaysText);
  const currentForm: SalesAgentConfigurationFormState = {
    ...form,
    prohibitedPhrases: currentPhrases,
    followUpAttemptDelaysMinutes: currentDelays
  };
  const dirty = computeFormDirty(savedForm, currentForm) || recordName !== savedRecordName;

  const sourceInfo = describeConfigurationSource(effective.source);

  function handleApiError(data: ApiErrorBody, status: number) {
    if (data?.error === "concurrent_edit_conflict") setConflict(true);
    if (data?.field || data?.reason) setFieldError({ field: data.field ?? null, reason: data.reason ?? data.error ?? "" });
    setFeedback(mapConfigurationApiError(data, status));
  }

  function confirmDiscardIfDirty(message: string) {
    if (!dirty) return true;
    return window.confirm(message);
  }

  async function handleSave() {
    if (!writeEnabled) {
      setFeedback(DB_WRITE_DISABLED_MESSAGE);
      return;
    }
    setPending("save");
    setFeedback(null);
    setFieldError(null);
    setConflict(false);

    const configuration = mapFormStateToPayload(currentForm);

    try {
      if (!draft) {
        const response = await fetch(API_BASE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: recordName, configuration })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          handleApiError(data, response.status);
          return;
        }
        setFeedback("Borrador creado.");
        router.push(`/agents/sales/configuration?draft=${data.id}`);
        return;
      }

      const response = await fetch(`${API_BASE}/${draft.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: recordName, configuration, expectedUpdatedAt })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        handleApiError(data, response.status);
        return;
      }
      setDraft(data as SalesAgentConfigurationRecord);
      // decision 3: refresh expectedUpdatedAt after every successful save.
      setExpectedUpdatedAt((data as SalesAgentConfigurationRecord).updatedAt);
      setSavedForm(currentForm);
      setSavedRecordName(recordName);
      setFeedback("Borrador guardado.");
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  async function handleValidate() {
    setPending("validate");
    setFeedback(null);
    setFieldError(null);
    try {
      const configuration = mapFormStateToPayload(currentForm);
      const response = await fetch(`${API_BASE}/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ configuration })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.valid) {
        if (data?.field || data?.reason) setFieldError({ field: data.field ?? null, reason: data.reason ?? "Validacion fallida" });
        setFeedback("La configuracion tiene errores.");
        return;
      }
      setFeedback("La configuracion es valida.");
    } finally {
      setPending(null);
    }
  }

  async function handlePublish() {
    if (!draft) return;
    if (dirty) {
      setFeedback("Guarda el borrador antes de publicar.");
      return;
    }
    if (!window.confirm(`Publicar la version ${draft.version}? Esto reemplaza la configuracion activa.`)) return;
    if (!writeEnabled) {
      setFeedback(DB_WRITE_DISABLED_MESSAGE);
      return;
    }
    setPending("publish");
    try {
      const response = await fetch(`${API_BASE}/${draft.id}/publish`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        handleApiError(data, response.status);
        return;
      }
      setFeedback("Configuracion publicada.");
      router.push("/agents/sales/configuration");
    } finally {
      setPending(null);
    }
  }

  function handleDiscard() {
    setForm(savedForm);
    setPhrasesText(savedForm.prohibitedPhrases.join("\n"));
    setDelaysText(formatAttemptDelaysMinutesInput(savedForm.followUpAttemptDelaysMinutes));
    setRecordName(savedRecordName);
    setFieldError(null);
    setFeedback(null);
    setConflict(false);
  }

  async function handleClone(id: number) {
    if (!writeEnabled) {
      setFeedback(DB_WRITE_DISABLED_MESSAGE);
      return;
    }
    if (!confirmDiscardIfDirty("Tienes cambios sin guardar. Descartarlos y clonar esta version?")) return;
    setPending(`${id}:clone`);
    try {
      const response = await fetch(`${API_BASE}/${id}/clone`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        handleApiError(data, response.status);
        return;
      }
      router.push(`/agents/sales/configuration?draft=${data.id}`);
    } finally {
      setPending(null);
    }
  }

  function handleEditVersion(id: number) {
    if (!confirmDiscardIfDirty("Tienes cambios sin guardar. Descartarlos y editar otra version?")) return;
    router.push(`/agents/sales/configuration?draft=${id}`);
  }

  async function handlePublishFromTable(id: number) {
    // Publishing THIS same draft while it has unsaved local edits would
    // publish stale, already-persisted content, not what's on screen -
    // block outright rather than silently publishing the wrong version.
    if (isEditingDirtyDraft(draft?.id ?? null, id, dirty)) {
      setFeedback("Guarda el borrador antes de publicar.");
      return;
    }
    // Publishing a DIFFERENT draft while the one being edited still has
    // unsaved changes doesn't touch that other draft's content, but the
    // operator may not realize their in-progress edits are still unsaved -
    // require an explicit, separate confirmation before the usual publish
    // confirmation.
    if (dirty && !window.confirm("Tienes cambios sin guardar en el borrador que estas editando. Continuar de todas formas?")) return;
    if (!window.confirm(`Publicar la version seleccionada? Esto reemplaza la configuracion activa.`)) return;
    if (!writeEnabled) {
      setFeedback(DB_WRITE_DISABLED_MESSAGE);
      return;
    }
    setPending(`${id}:publish`);
    try {
      const response = await fetch(`${API_BASE}/${id}/publish`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        handleApiError(data, response.status);
        return;
      }
      setFeedback("Configuracion publicada.");
      router.push("/agents/sales/configuration");
    } finally {
      setPending(null);
    }
  }

  async function handleArchive(id: number) {
    // Same protection as publish: archiving the draft currently being
    // edited while it has unsaved changes would discard those edits along
    // with the whole row - block outright, require save or discard first.
    if (isEditingDirtyDraft(draft?.id ?? null, id, dirty)) {
      setFeedback("Guarda o descarta los cambios antes de archivar este borrador.");
      return;
    }
    if (!writeEnabled) {
      setFeedback(DB_WRITE_DISABLED_MESSAGE);
      return;
    }
    if (!window.confirm("Archivar este borrador? No se puede deshacer desde aqui.")) return;
    setPending(`${id}:archive`);
    try {
      const response = await fetch(`${API_BASE}/${id}/archive`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        handleApiError(data, response.status);
        return;
      }
      setFeedback("Borrador archivado.");
      if (draft?.id === id) {
        router.push("/agents/sales/configuration");
      } else {
        router.refresh();
      }
    } finally {
      setPending(null);
    }
  }

  function handleReloadAfterConflict() {
    window.location.reload();
  }

  const saveDisabled = pending !== null || !writeEnabled || (draft !== null && !dirty);
  const publishDisabled = !draft || dirty || pending !== null || !writeEnabled;

  return (
    <div className="space-y-6">
      <SectionCard
        title="Configuracion activa"
        eyebrow={sourceInfo.label}
        description="Lo que el runtime esta usando ahora mismo para el Sales Agent."
      >
        <InfoGrid
          columns={3}
          items={[
            { label: "Version", value: effective.version !== null ? `v${effective.version}` : "-" },
            { label: "Hash", value: effective.configurationHash ? effective.configurationHash.slice(0, 8) : "-" },
            { label: "Source", value: <StatusChip label={sourceInfo.label} tone={sourceInfo.tone} /> },
            { label: "Agente", value: effective.configuration.agentName },
            { label: "Empresa", value: effective.configuration.companyName },
            { label: "Modelo efectivo", value: effective.effectiveModelConfiguration.model },
            { label: "Temperatura", value: effective.effectiveModelConfiguration.temperature },
            {
              label: "Max tokens",
              value: effective.effectiveModelConfiguration.maxOutputTokens ?? "sin limite configurado"
            },
            { label: "Timeout", value: `${effective.effectiveModelConfiguration.timeoutMs} ms` },
            { label: "Retries", value: effective.effectiveModelConfiguration.maxModelRetries },
            { label: "Pasos maximos", value: effective.effectiveLoopConfiguration.maxAgentStepsPerTurn },
            { label: "Tools maximas", value: effective.effectiveLoopConfiguration.maxToolCallsPerTurn },
            {
              label: "Seguimiento",
              value: <StatusChip label={effective.effectiveFollowUpConfiguration.enabled ? "Activado" : "Desactivado"} tone={effective.effectiveFollowUpConfiguration.enabled ? "green" : "gray"} />
            },
            { label: "Intentos maximos", value: effective.effectiveFollowUpConfiguration.maxAttempts }
          ]}
        />
        {effective.source !== "published" ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-body-md text-amber-900">
            No hay una configuracion publicada. El runtime esta usando {sourceInfo.label.toLowerCase()}. Crea y publica un borrador desde las
            pestanas de abajo para tomar control.
          </p>
        ) : null}
      </SectionCard>

      {!writeEnabled ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-body-md text-amber-900">
          Requiere <code>DB_WRITE_ENABLED</code> para guardar, publicar, clonar o archivar. La lectura y la validacion siguen disponibles.
        </div>
      ) : null}

      {conflict ? (
        <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2 text-body-md text-red-800">
          <span>Otro cambio se guardo primero sobre este borrador. Recarga para ver la version actual antes de seguir editando.</span>
          <button className="hub-button-secondary" type="button" onClick={handleReloadAfterConflict}>
            Recargar
          </button>
        </div>
      ) : null}

      <TabStrip
        tabs={[
          { label: "Identidad", active: tab === "identidad", onClick: () => setTab("identidad") },
          { label: "Modelo", active: tab === "modelo", onClick: () => setTab("modelo") },
          { label: "Ejecucion", active: tab === "ejecucion", onClick: () => setTab("ejecucion") },
          { label: "Seguimiento", active: tab === "seguimiento", onClick: () => setTab("seguimiento") },
          { label: "Versiones", active: tab === "versiones", onClick: () => setTab("versiones") }
        ]}
      />

      {tab !== "versiones" ? (
        <SectionCard
          title={draft ? `Editando borrador v${draft.version}` : "Nuevo borrador"}
          eyebrow="Draft"
          description={
            draft
              ? "Los cambios no afectan produccion hasta que publiques esta version."
              : "Precargado desde la configuracion efectiva actual. Guardar crea el primer borrador."
          }
        >
          <div className="mb-4">
            <label className="grid gap-1 md:max-w-sm">
              <span className="text-label-sm uppercase text-slate-500">Nombre del borrador</span>
              <input
                className="hub-input"
                value={recordName}
                maxLength={191}
                onChange={(event) => setRecordName(event.target.value)}
                disabled={pending !== null}
              />
            </label>
          </div>

          {tab === "identidad" ? (
            <div className="grid gap-3">
              <label className="grid gap-1">
                <span className="text-label-sm uppercase text-slate-500">Nombre del agente</span>
                <input
                  className="hub-input"
                  value={form.agentName}
                  maxLength={SALES_AGENT_CONFIGURATION_LIMITS.agentNameMaxLength}
                  onChange={(event) => setForm({ ...form, agentName: event.target.value })}
                  disabled={pending !== null}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-label-sm uppercase text-slate-500">Empresa</span>
                <input
                  className="hub-input"
                  value={form.companyName}
                  maxLength={SALES_AGENT_CONFIGURATION_LIMITS.companyNameMaxLength}
                  onChange={(event) => setForm({ ...form, companyName: event.target.value })}
                  disabled={pending !== null}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-label-sm uppercase text-slate-500">Rol</span>
                <input
                  className="hub-input"
                  value={form.role}
                  maxLength={SALES_AGENT_CONFIGURATION_LIMITS.roleMaxLength}
                  onChange={(event) => setForm({ ...form, role: event.target.value })}
                  disabled={pending !== null}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-label-sm uppercase text-slate-500">Descripcion de la empresa</span>
                <textarea
                  className="hub-input min-h-24"
                  value={form.companyDescription}
                  maxLength={SALES_AGENT_CONFIGURATION_LIMITS.companyDescriptionMaxLength}
                  onChange={(event) => setForm({ ...form, companyDescription: event.target.value })}
                  disabled={pending !== null}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-label-sm uppercase text-slate-500">Instrucciones personalizadas (seccion subordinada del prompt)</span>
                <textarea
                  className="hub-input min-h-24"
                  value={form.customInstructions}
                  maxLength={SALES_AGENT_CONFIGURATION_LIMITS.customInstructionsMaxLength}
                  onChange={(event) => setForm({ ...form, customInstructions: event.target.value })}
                  disabled={pending !== null}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-label-sm uppercase text-slate-500">Frases prohibidas (una por linea, {currentPhrases.length} activas)</span>
                <textarea
                  className="hub-input min-h-24"
                  value={phrasesText}
                  onChange={(event) => setPhrasesText(event.target.value)}
                  disabled={pending !== null}
                />
              </label>
            </div>
          ) : null}

          {tab === "modelo" ? (
            <div className="grid gap-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.modelConfigurationEnabled}
                  onChange={(event) => setForm({ ...form, modelConfigurationEnabled: event.target.checked })}
                  disabled={pending !== null}
                />
                <span className="text-body-md text-slate-700">Configurar parametros de modelo para este borrador (si no, hereda el efectivo actual)</span>
              </label>
              {!form.modelConfigurationEnabled ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-body-md text-slate-600">
                  Heredando: modelo {effective.effectiveModelConfiguration.model}, temperatura {effective.effectiveModelConfiguration.temperature},{" "}
                  {effective.effectiveModelConfiguration.maxOutputTokens ?? "sin limite configurado"} tokens, timeout{" "}
                  {effective.effectiveModelConfiguration.timeoutMs} ms, {effective.effectiveModelConfiguration.maxModelRetries} retries.
                </p>
              ) : (
                <>
                  <label className="grid gap-1 md:max-w-sm">
                    <span className="text-label-sm uppercase text-slate-500">Modelo</span>
                    <select
                      className="hub-input"
                      value={form.model}
                      onChange={(event) => setForm({ ...form, model: event.target.value })}
                      disabled={pending !== null}
                    >
                      {allowedModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 md:max-w-sm">
                    <span className="text-label-sm uppercase text-slate-500">
                      Temperatura ({SALES_AGENT_MODEL_CONFIGURATION_LIMITS.temperatureMin}-{SALES_AGENT_MODEL_CONFIGURATION_LIMITS.temperatureMax})
                    </span>
                    <input
                      type="number"
                      className="hub-input"
                      value={form.temperature}
                      min={SALES_AGENT_MODEL_CONFIGURATION_LIMITS.temperatureMin}
                      max={SALES_AGENT_MODEL_CONFIGURATION_LIMITS.temperatureMax}
                      step={0.1}
                      onChange={(event) => setForm({ ...form, temperature: Number(event.target.value) })}
                      disabled={pending !== null}
                    />
                  </label>
                  <label className="grid gap-1 md:max-w-sm">
                    <span className="text-label-sm uppercase text-slate-500">
                      Maximo de tokens de salida ({SALES_AGENT_MODEL_CONFIGURATION_LIMITS.maxOutputTokensMin}-
                      {SALES_AGENT_MODEL_CONFIGURATION_LIMITS.maxOutputTokensMax})
                    </span>
                    <input
                      type="number"
                      className="hub-input"
                      value={form.maxOutputTokens}
                      min={SALES_AGENT_MODEL_CONFIGURATION_LIMITS.maxOutputTokensMin}
                      max={SALES_AGENT_MODEL_CONFIGURATION_LIMITS.maxOutputTokensMax}
                      onChange={(event) => setForm({ ...form, maxOutputTokens: Number(event.target.value) })}
                      disabled={pending !== null}
                    />
                  </label>
                  <label className="grid gap-1 md:max-w-sm">
                    <span className="text-label-sm uppercase text-slate-500">
                      Timeout ms ({SALES_AGENT_MODEL_CONFIGURATION_LIMITS.timeoutMsMin}-{SALES_AGENT_MODEL_CONFIGURATION_LIMITS.timeoutMsMax})
                    </span>
                    <input
                      type="number"
                      className="hub-input"
                      value={form.timeoutMs}
                      min={SALES_AGENT_MODEL_CONFIGURATION_LIMITS.timeoutMsMin}
                      max={SALES_AGENT_MODEL_CONFIGURATION_LIMITS.timeoutMsMax}
                      onChange={(event) => setForm({ ...form, timeoutMs: Number(event.target.value) })}
                      disabled={pending !== null}
                    />
                  </label>
                  <label className="grid gap-1 md:max-w-sm">
                    <span className="text-label-sm uppercase text-slate-500">
                      Reintentos tecnicos ({SALES_AGENT_MODEL_CONFIGURATION_LIMITS.maxModelRetriesMin}-
                      {SALES_AGENT_MODEL_CONFIGURATION_LIMITS.maxModelRetriesMax})
                    </span>
                    <input
                      type="number"
                      className="hub-input"
                      value={form.maxModelRetries}
                      min={SALES_AGENT_MODEL_CONFIGURATION_LIMITS.maxModelRetriesMin}
                      max={SALES_AGENT_MODEL_CONFIGURATION_LIMITS.maxModelRetriesMax}
                      onChange={(event) => setForm({ ...form, maxModelRetries: Number(event.target.value) })}
                      disabled={pending !== null}
                    />
                  </label>
                </>
              )}
            </div>
          ) : null}

          {tab === "ejecucion" ? (
            <div className="grid gap-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.loopConfigurationEnabled}
                  onChange={(event) => setForm({ ...form, loopConfigurationEnabled: event.target.checked })}
                  disabled={pending !== null}
                />
                <span className="text-body-md text-slate-700">Configurar limites de ejecucion para este borrador (si no, hereda el efectivo actual)</span>
              </label>
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-body-md text-slate-600">
                Pasos maximos y tools maximas son limites internos del turno del agente - nunca mensajes al cliente ni follow-ups, y no modifican los
                retries del Capability Gateway.
              </p>
              {!form.loopConfigurationEnabled ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-body-md text-slate-600">
                  Heredando: {effective.effectiveLoopConfiguration.maxAgentStepsPerTurn} pasos maximos, {effective.effectiveLoopConfiguration.maxToolCallsPerTurn}{" "}
                  tools maximas.
                </p>
              ) : (
                <>
                  <label className="grid gap-1 md:max-w-sm">
                    <span className="text-label-sm uppercase text-slate-500">
                      Pasos maximos por turno ({SALES_AGENT_LOOP_CONFIGURATION_LIMITS.maxAgentStepsPerTurnMin}-
                      {SALES_AGENT_LOOP_CONFIGURATION_LIMITS.maxAgentStepsPerTurnMax})
                    </span>
                    <input
                      type="number"
                      className="hub-input"
                      value={form.maxAgentStepsPerTurn}
                      min={SALES_AGENT_LOOP_CONFIGURATION_LIMITS.maxAgentStepsPerTurnMin}
                      max={SALES_AGENT_LOOP_CONFIGURATION_LIMITS.maxAgentStepsPerTurnMax}
                      onChange={(event) => setForm({ ...form, maxAgentStepsPerTurn: Number(event.target.value) })}
                      disabled={pending !== null}
                    />
                  </label>
                  <label className="grid gap-1 md:max-w-sm">
                    <span className="text-label-sm uppercase text-slate-500">
                      Tools maximas por turno ({SALES_AGENT_LOOP_CONFIGURATION_LIMITS.maxToolCallsPerTurnMin}-
                      {SALES_AGENT_LOOP_CONFIGURATION_LIMITS.maxToolCallsPerTurnMax})
                    </span>
                    <input
                      type="number"
                      className="hub-input"
                      value={form.maxToolCallsPerTurn}
                      min={SALES_AGENT_LOOP_CONFIGURATION_LIMITS.maxToolCallsPerTurnMin}
                      max={SALES_AGENT_LOOP_CONFIGURATION_LIMITS.maxToolCallsPerTurnMax}
                      onChange={(event) => setForm({ ...form, maxToolCallsPerTurn: Number(event.target.value) })}
                      disabled={pending !== null}
                    />
                  </label>
                </>
              )}
            </div>
          ) : null}

          {tab === "seguimiento" ? (
            <div className="grid gap-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.followUpConfigurationEnabled}
                  onChange={(event) => setForm({ ...form, followUpConfigurationEnabled: event.target.checked })}
                  disabled={pending !== null}
                />
                <span className="text-body-md text-slate-700">
                  Configurar seguimiento (follow-up) para este borrador (si no, hereda el efectivo actual)
                </span>
              </label>
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-body-md text-slate-600">
                Esto solo autoriza, pausa y acota CUANDO puede agendarse un seguimiento - nunca decide si corresponde uno (eso lo sigue
                decidiendo el Sales Agent). Cancelaciones por opt-out, cliente humano activo, IA pausada u oportunidad cerrada no son
                configurables aqui: siempre aplican.
              </p>
              {!form.followUpConfigurationEnabled ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-body-md text-slate-600">
                  Heredando: seguimiento {effective.effectiveFollowUpConfiguration.enabled ? "activado" : "desactivado"},{" "}
                  {effective.effectiveFollowUpConfiguration.maxAttempts} intentos maximos, demoras{" "}
                  {formatAttemptDelaysMinutesInput(effective.effectiveFollowUpConfiguration.attemptDelaysMinutes)} minutos, ventana{" "}
                  {effective.effectiveFollowUpConfiguration.allowedWindow.startHour}-{effective.effectiveFollowUpConfiguration.allowedWindow.endHour}h{" "}
                  America/Santiago, edad maxima de oportunidad {effective.effectiveFollowUpConfiguration.maxOpportunityAgeDays} dias.
                </p>
              ) : (
                <>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.followUpEnabled}
                      onChange={(event) => setForm({ ...form, followUpEnabled: event.target.checked })}
                      disabled={pending !== null}
                    />
                    <span className="text-body-md text-slate-700">Habilitar el agendamiento real de seguimientos</span>
                  </label>
                  <label className="grid gap-1 md:max-w-sm">
                    <span className="text-label-sm uppercase text-slate-500">
                      Intentos maximos ({SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.maxAttemptsMin}-
                      {SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.maxAttemptsMax})
                    </span>
                    <input
                      type="number"
                      className="hub-input"
                      value={form.followUpMaxAttempts}
                      min={SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.maxAttemptsMin}
                      max={SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.maxAttemptsMax}
                      onChange={(event) => setForm({ ...form, followUpMaxAttempts: Number(event.target.value) })}
                      disabled={pending !== null}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-label-sm uppercase text-slate-500">
                      Demoras por intento, en minutos (separadas por coma, {currentDelays.length} valores - debe coincidir con intentos
                      maximos)
                    </span>
                    <input
                      className="hub-input"
                      value={delaysText}
                      onChange={(event) => setDelaysText(event.target.value)}
                      disabled={pending !== null}
                    />
                    <span className="text-body-sm text-slate-500">
                      El intento 1 se mide desde la decision inicial; cada intento siguiente se mide desde el scheduled_for del intento
                      anterior, nunca desde &quot;ahora&quot;.
                    </span>
                  </label>
                  <div className="grid gap-1 md:max-w-sm">
                    <span className="text-label-sm uppercase text-slate-500">
                      Ventana horaria permitida (America/Santiago, {SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.windowHourMin}-
                      {SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.windowHourMax}h)
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        className="hub-input"
                        value={form.followUpStartHour}
                        min={SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.windowHourMin}
                        max={SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.windowHourMax}
                        onChange={(event) => setForm({ ...form, followUpStartHour: Number(event.target.value) })}
                        disabled={pending !== null}
                      />
                      <span className="text-body-md text-slate-500">a</span>
                      <input
                        type="number"
                        className="hub-input"
                        value={form.followUpEndHour}
                        min={SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.windowHourMin}
                        max={SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.windowHourMax}
                        onChange={(event) => setForm({ ...form, followUpEndHour: Number(event.target.value) })}
                        disabled={pending !== null}
                      />
                    </div>
                  </div>
                  <div className="grid gap-1">
                    <span className="text-label-sm uppercase text-slate-500">Dias permitidos</span>
                    <div className="flex flex-wrap gap-3">
                      {FOLLOW_UP_WEEKDAYS.map(({ value, label }) => (
                        <label key={value} className="flex items-center gap-1 text-body-md text-slate-700">
                          <input
                            type="checkbox"
                            checked={form.followUpAllowedWeekdays.includes(value)}
                            disabled={pending !== null}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...form.followUpAllowedWeekdays, value].sort((a, b) => a - b)
                                : form.followUpAllowedWeekdays.filter((day) => day !== value);
                              setForm({ ...form, followUpAllowedWeekdays: next });
                            }}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="grid gap-1 md:max-w-sm">
                    <span className="text-label-sm uppercase text-slate-500">
                      Edad maxima de la oportunidad, en dias ({SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.maxOpportunityAgeDaysMin}-
                      {SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.maxOpportunityAgeDaysMax})
                    </span>
                    <input
                      type="number"
                      className="hub-input"
                      value={form.followUpMaxOpportunityAgeDays}
                      min={SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.maxOpportunityAgeDaysMin}
                      max={SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.maxOpportunityAgeDaysMax}
                      onChange={(event) => setForm({ ...form, followUpMaxOpportunityAgeDays: Number(event.target.value) })}
                      disabled={pending !== null}
                    />
                    <span className="text-body-sm text-slate-500">Basado en la fecha de creacion de la oportunidad, nunca en inactividad.</span>
                  </label>
                </>
              )}
            </div>
          ) : null}

          {fieldError ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-body-md text-red-800">
              {fieldError.field ? <strong className="mr-1">{fieldError.field}:</strong> : null}
              {fieldError.reason}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
            <button className="hub-button-primary" type="button" disabled={saveDisabled} onClick={() => void handleSave()}>
              <Icon name="save" /> Guardar borrador
            </button>
            <button className="hub-button-secondary" type="button" disabled={pending !== null} onClick={() => void handleValidate()}>
              <Icon name="fact_check" /> Validar
            </button>
            <button
              className="hub-button-secondary"
              type="button"
              disabled={publishDisabled}
              title={dirty ? "Guarda tus cambios antes de publicar" : undefined}
              onClick={() => void handlePublish()}
            >
              <Icon name="publish" /> Publicar configuracion
            </button>
            <button className="hub-button-secondary" type="button" disabled={!dirty || pending !== null} onClick={handleDiscard}>
              <Icon name="undo" /> Descartar cambios
            </button>
            {dirty ? <span className="text-label-sm uppercase text-amber-700">Cambios sin guardar</span> : null}
          </div>

          {feedback ? <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-body-md text-slate-700">{feedback}</p> : null}
        </SectionCard>
      ) : (
        <SectionCard title="Versiones" eyebrow="Historial" description="Orden descendente por version.">
          <SalesAgentConfigurationVersionsTable
            versions={versions}
            writeEnabled={writeEnabled}
            pendingKey={pending}
            onEdit={handleEditVersion}
            onClone={(id) => void handleClone(id)}
            onPublish={(id) => void handlePublishFromTable(id)}
            onArchive={(id) => void handleArchive(id)}
          />
        </SectionCard>
      )}
    </div>
  );
}
