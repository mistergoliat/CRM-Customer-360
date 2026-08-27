"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { SectionCard } from "@/components/p1m/SectionCard";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  CUSTOMER_INTELLIGENCE_COPILOT_QUESTIONS,
  normalizeCopilotTurn,
  type CreateCustomerIntelligenceCopilotSessionResult,
  type CustomerIntelligenceCopilotProvenance,
  type CustomerIntelligenceCopilotResponse,
  type CustomerIntelligenceCopilotSessionSummary,
  type CustomerIntelligenceCopilotSessionTurnResponse,
  type MarketingCopilotProxyError,
  type NormalizedCopilotTurn,
  type RefreshCustomerIntelligenceCopilotSessionResult
} from "@/lib/marketing/customerIntelligenceCopilot";

void React;

const MAX_QUESTION_LENGTH = 4000;
const EXPORT_FALLBACK_FILENAME = "customer-intelligence-export.xlsx";

type MarketingCopilotWorkspaceProps = {
  data: {
    quickReplies?: string[];
  };
};

type ChatMessage =
  | {
      readonly id: string;
      readonly role: "user";
      readonly content: string;
      readonly createdAt: string;
    }
  | {
      readonly id: string;
      readonly role: "assistant";
      readonly content: string;
      readonly createdAt: string;
      readonly response: CustomerIntelligenceCopilotSessionTurnResponse;
      readonly provenance?: CustomerIntelligenceCopilotProvenance;
      readonly exportableQueryId?: string;
    };

type WorkspaceStatus = "idle" | "creating_session" | "sending" | "error";
type ExportStatus = "idle" | "exporting" | "error";

type ExportReference = {
  readonly sessionId: string;
  readonly queryId: string;
};

export function MarketingCopilotWorkspace({ data: _data }: MarketingCopilotWorkspaceProps) {
  void _data;
  const suggestions = CUSTOMER_INTELLIGENCE_COPILOT_QUESTIONS;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionSummary, setSessionSummary] = useState<CustomerIntelligenceCopilotSessionSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<WorkspaceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [provenance, setProvenance] = useState<CustomerIntelligenceCopilotProvenance | null>(null);
  const [lastExportableReference, setLastExportableReference] = useState<ExportReference | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const isBusy = status === "creating_session" || status === "sending";
  const canSubmit = question.trim().length > 0 && question.trim().length <= MAX_QUESTION_LENGTH && !isBusy;
  const lastAssistant = [...messages].reverse().find((message): message is Extract<ChatMessage, { role: "assistant" }> => message.role === "assistant") ?? null;

  useEffect(() => {
    textareaRef.current?.focus();
  }, [messages.length, isBusy]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [question]);

  async function submit(nextQuestion = question) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || trimmed.length > MAX_QUESTION_LENGTH || isBusy) return;

    setQuestion("");
    setError(null);
    setExportError(null);
    const userMessage: ChatMessage = {
      id: createUiId("user"),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString()
    };
    setMessages((current) => [...current, userMessage]);

    try {
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        setStatus("creating_session");
        const created = await postJson<CreateCustomerIntelligenceCopilotSessionResult>("/api/marketing/copilot/sessions", {});
        if (created.status !== "created") {
          throw new Error(created.status === "analytics_unavailable" ? created.message : "No se pudo crear la sesion del Copilot.");
        }
        activeSessionId = created.session.sessionId;
        setSessionId(activeSessionId);
        setSessionSummary(created.session);
        setProvenance(created.session.pinnedContext);
      }

      setStatus("sending");
      const response = await postJson<CustomerIntelligenceCopilotSessionTurnResponse>(`/api/marketing/copilot/sessions/${activeSessionId}/messages`, { question: trimmed });
      const exportableQueryId = firstExportableQueryId(response);
      const assistant: ChatMessage = {
        id: response.turnId,
        role: "assistant",
        content: assistantContent(response),
        createdAt: new Date().toISOString(),
        response,
        provenance: "provenance" in response ? response.provenance : undefined,
        exportableQueryId
      };
      setMessages((current) => [...current, assistant]);
      if ("provenance" in response) setProvenance(response.provenance);
      if (exportableQueryId) setLastExportableReference({ sessionId: activeSessionId, queryId: exportableQueryId });
      setStatus("idle");
    } catch (caught) {
      setStatus("error");
      setError(userSafeError(caught));
    }
  }

  async function startNewChat() {
    const currentSessionId = sessionId;
    setSessionId(null);
    setSessionSummary(null);
    setMessages([]);
    setQuestion("");
    setStatus("idle");
    setError(null);
    setProvenance(null);
    setLastExportableReference(null);
    setExportStatus("idle");
    setExportError(null);
    setTechnicalOpen(false);
    if (currentSessionId) {
      await fetch(`/api/marketing/copilot/sessions/${currentSessionId}`, { method: "DELETE" }).catch(() => undefined);
    }
  }

  async function refreshContext() {
    if (!sessionId || isBusy) return;
    setStatus("sending");
    setError(null);
    try {
      const response = await postJson<RefreshCustomerIntelligenceCopilotSessionResult>(`/api/marketing/copilot/sessions/${sessionId}/refresh`, {});
      if (response.status !== "refreshed") {
        throw new Error(response.status === "analytics_unavailable" ? response.message : "No se pudo actualizar el contexto.");
      }
      setSessionSummary(response.session);
      setProvenance(response.session.pinnedContext);
      setMessages([]);
      setLastExportableReference(null);
      setStatus("idle");
    } catch (caught) {
      setStatus("error");
      setError(userSafeError(caught));
    }
  }

  async function exportXlsx() {
    if (!lastExportableReference || exportStatus === "exporting") return;
    setExportStatus("exporting");
    setExportError(null);
    try {
      const response = await fetch(`/api/marketing/copilot/sessions/${lastExportableReference.sessionId}/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queryId: lastExportableReference.queryId, format: "xlsx" })
      });
      if (!response.ok) throw new Error("No se pudo exportar el resultado.");
      const blob = await response.blob();
      const filename = filenameFromDisposition(response.headers.get("content-disposition")) ?? EXPORT_FALLBACK_FILENAME;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportStatus("idle");
    } catch (caught) {
      setExportStatus("error");
      setExportError(userSafeError(caught));
    }
  }

  const provenanceItems = useMemo(() => buildProvenanceItems(provenance, lastAssistant?.response ?? null), [lastAssistant, provenance]);

  return (
    <div className="grid min-h-[calc(100vh-220px)] gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
      <section className="flex min-h-[660px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-label-bold uppercase text-primary">Marketing Copilot</p>
            <h2 className="text-headline-md text-on-surface">Workspace conversacional</h2>
            <p className="mt-1 text-body-md text-slate-500">Sesion efimera con contexto analitico pinned y ejecucion read-only en Customer Profile.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="hub-button-secondary" onClick={() => void startNewChat()} disabled={isBusy && messages.length === 0}>
              Nuevo chat
            </button>
            {lastExportableReference ? (
              <button type="button" className="hub-button-primary" onClick={() => void exportXlsx()} disabled={exportStatus === "exporting"}>
                {exportStatus === "exporting" ? "Exportando..." : "Exportar XLSX"}
              </button>
            ) : null}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-slate-50/60 px-4 py-5">
          {messages.length === 0 ? (
            <EmptyConversation suggestions={suggestions} disabled={isBusy} onPick={(value) => void submit(value)} />
          ) : (
            <div className="mx-auto flex max-w-4xl flex-col gap-4">
              {messages.map((message) => (
                <ChatBubble key={message.id} message={message} />
              ))}
              {isBusy ? <AssistantLoading status={status} /> : null}
            </div>
          )}
        </div>

        <footer className="border-t border-slate-200 bg-white p-4">
          {error ? <StateMessage tone="red" title={stateTitle("provider_error")} body={error} className="mb-3" /> : null}
          {exportError ? <StateMessage tone="red" title="Error al exportar" body={exportError} className="mb-3" /> : null}
          <div className="mx-auto max-w-4xl">
            <div className="mb-3 flex flex-wrap gap-2">
              {suggestions.slice(0, 4).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-label-sm text-slate-700 hover:border-slate-300 hover:bg-white disabled:opacity-50"
                  disabled={isBusy}
                  onClick={() => void submit(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-sky-300 focus-within:ring-2 focus-within:ring-sky-100">
              <textarea
                ref={textareaRef}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                placeholder="Pregunta..."
                className="min-h-11 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-body-md text-on-surface outline-none placeholder:text-slate-400"
                maxLength={MAX_QUESTION_LENGTH}
                disabled={isBusy}
                rows={1}
              />
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className="text-[11px] font-semibold text-slate-500">{question.trim().length}/{MAX_QUESTION_LENGTH}</span>
                <button type="button" className="hub-button-primary" disabled={!canSubmit} onClick={() => void submit()}>
                  {isBusy ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </div>
          </div>
        </footer>
      </section>

      <aside className="space-y-4">
        <SectionCard
          title="Provenance"
          eyebrow="Contexto"
          description="Snapshots y cobertura recibidos desde Customer Profile."
          actions={
            <button type="button" className="hub-button-secondary" onClick={() => void refreshContext()} disabled={!sessionId || isBusy}>
              Actualizar datos
            </button>
          }
        >
          {provenance ? (
            <div className="space-y-4">
              <InfoGrid items={provenanceItems} columns={2} />
              <CoverageNote provenance={provenance} />
              {sessionSummary ? (
                <p className="text-label-sm text-slate-500">Sesion pinned hasta {formatDateTime(sessionSummary.expiresAt)}. Refresh limpia el historial efimero y toma contexto analitico nuevo.</p>
              ) : null}
              <button type="button" className="text-label-bold text-primary hover:underline" onClick={() => setTechnicalOpen((current) => !current)}>
                {technicalOpen ? "Ocultar detalle tecnico" : "Ver detalle tecnico"}
              </button>
              {technicalOpen ? <TechnicalDetails response={lastAssistant?.response ?? null} provenance={provenance} /> : null}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-body-md text-slate-700">La provenance aparece cuando se crea una sesion o una respuesta trae datos.</div>
          )}
        </SectionCard>
      </aside>
    </div>
  );
}

function EmptyConversation({ suggestions, disabled, onPick }: { suggestions: readonly string[]; disabled: boolean; onPick(value: string): void }) {
  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-center gap-5 py-10">
      <div>
        <StatusChip label="Read-only" tone="blue" />
        <h3 className="mt-3 text-display-sm text-on-surface">Pregunta sobre Customer Intelligence</h3>
        <p className="mt-2 max-w-2xl text-body-lg text-slate-600">El Copilot usa sesiones efimeras del backend, conserva el contexto del turno y permite exportar resultados analiticos validados.</p>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={disabled}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-body-md font-semibold text-slate-700 shadow-sm hover:border-sky-200 hover:bg-sky-50 disabled:opacity-50"
            onClick={() => onPick(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <article className="ml-auto max-w-[82%] rounded-2xl bg-slate-900 px-4 py-3 text-white">
        <p className="text-label-bold uppercase text-slate-300">User</p>
        <p className="mt-1 whitespace-pre-wrap text-body-md">{message.content}</p>
      </article>
    );
  }

  const normalized = normalizeCopilotTurn(message.response);
  return (
    <article className="max-w-[92%] rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-label-bold uppercase text-primary">Copilot</p>
        <StatusChip label={statusLabel(message.response.status)} tone={toneForCopilotTurn(normalized)} />
        {message.exportableQueryId ? <StatusChip label="Exportable" tone="green" /> : null}
      </div>
      <ResponseBody response={message.response} />
    </article>
  );
}

export function ResponseBody({ response }: { response: CustomerIntelligenceCopilotSessionTurnResponse }) {
  const normalized = normalizeCopilotTurn(response);

  if (normalized.contractError) {
    console.error("Marketing Copilot: non-fatal status with no displayable text", { status: response.status, turnId: response.turnId });
  }

  if (normalized.interactionType === "answer") {
    const hasQueryMetadata = response.status === "answered" || response.status === "answered_from_context";
    return (
      <div className="mt-3 space-y-3">
        <p className="whitespace-pre-wrap text-body-lg text-on-surface">{normalized.text}</p>
        {hasQueryMetadata ? (
          <InfoGrid
            items={[
              { label: "Filas", value: response.analysis.resultRowCount.toLocaleString("es-CL") },
              { label: "Query ids", value: response.queryIds.length > 0 ? response.queryIds.join(", ") : response.sourceQueryIds.join(", ") || "Sin query nueva" },
              { label: "Planner", value: response.analysis.plannerModel ?? "No reportado" },
              { label: "Answerer", value: response.analysis.answerModel ?? "No reportado" }
            ]}
            columns={4}
          />
        ) : null}
      </div>
    );
  }

  return <StateMessage tone={toneForCopilotTurn(normalized) === "red" ? "red" : "amber"} title={stateTitle(response.status, normalized)} body={normalized.text} className="mt-3" />;
}

function AssistantLoading({ status }: { status: WorkspaceStatus }) {
  return (
    <article className="max-w-[92%] rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-label-bold uppercase text-primary">Copilot</p>
      <p className="mt-2 text-body-md text-slate-600">{status === "creating_session" ? "Creando sesion..." : "Analizando datos..."}</p>
    </article>
  );
}

function StateMessage({ tone, title, body, className }: { tone: "amber" | "red"; title: string; body: string; className?: string }) {
  return (
    <div className={clsx("rounded-xl border p-4", tone === "amber" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50", className)}>
      <StatusChip label={title} tone={tone === "amber" ? "amber" : "red"} />
      <p className="mt-3 text-body-md text-slate-700">{body}</p>
    </div>
  );
}

function CoverageNote({ provenance }: { provenance: CustomerIntelligenceCopilotProvenance }) {
  const { population } = provenance;
  if (population.clusterCoveragePct >= 99 && population.rfmCoveragePct >= 99) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-body-md text-slate-700">
      Cobertura parcial: RFM cubre {population.rfmCoveragePct}% y clustering cubre {population.clusterCoveragePct}% de la poblacion analitica.
    </div>
  );
}

function TechnicalDetails({ response, provenance }: { response: CustomerIntelligenceCopilotSessionTurnResponse | null; provenance: CustomerIntelligenceCopilotProvenance }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-label-sm text-slate-600">
      <dl className="space-y-2">
        <Detail label="Read model" value={provenance.contractVersion ?? "No reportado"} />
        <Detail label="Feature version" value={provenance.featureSnapshot.featureVersion} />
        <Detail label="Population policy" value={provenance.featureSnapshot.populationPolicyVersion} />
        <Detail label="Query plan hash" value={response && "analysis" in response && "queryPlanHashes" in response.analysis ? response.analysis.queryPlanHashes.join(", ") : "No disponible"} />
        <Detail label="Turn id" value={response?.turnId ?? "No disponible"} />
      </dl>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-bold uppercase text-slate-500">{label}</dt>
      <dd className="break-words text-slate-700">{value}</dd>
    </div>
  );
}

function buildProvenanceItems(provenance: CustomerIntelligenceCopilotProvenance | null, response: CustomerIntelligenceCopilotSessionTurnResponse | null) {
  if (!provenance) return [];
  return [
    { label: "Feature snapshot", value: formatSnapshot(provenance.featureSnapshot.snapshotId, provenance.featureSnapshot.referenceTime) },
    { label: "RFM", value: provenance.rfmSnapshot ? formatSnapshot(provenance.rfmSnapshot.snapshotId, provenance.rfmSnapshot.referenceTime) : "Sin snapshot compatible" },
    { label: "Clustering", value: provenance.clusterSnapshot ? `${formatSnapshot(provenance.clusterSnapshot.snapshotId, provenance.clusterSnapshot.referenceTime)} - ${provenance.clusterSnapshot.modelVersion}` : "Sin snapshot compatible" },
    { label: "Poblacion", value: provenance.population.featurePopulation.toLocaleString("es-CL") },
    { label: "Cobertura RFM", value: `${provenance.population.rfmCoveragePct}%` },
    { label: "Cobertura cluster", value: `${provenance.population.clusterCoveragePct}%` },
    { label: "Queries", value: response?.queryIds.length ? response.queryIds.join(", ") : "Sin query nueva" },
    { label: "Truncation", value: response && "analysis" in response && "resultRowCount" in response.analysis && response.analysis.resultRowCount > 0 ? "Ver export para resultado completo" : "No reportado" }
  ];
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = (await response.json().catch(() => null)) as T | MarketingCopilotProxyError | null;
  if (!response.ok) {
    throw new Error(payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string" ? payload.message : "Copilot no disponible.");
  }
  return payload as T;
}

function firstExportableQueryId(response: CustomerIntelligenceCopilotSessionTurnResponse): string | undefined {
  if (response.queryIds.length > 0) return response.queryIds[0];
  if ((response.status === "answered_from_context" || response.sourceQueryIds.length > 0) && response.sourceQueryIds.length > 0) return response.sourceQueryIds[0];
  return undefined;
}

function assistantContent(response: CustomerIntelligenceCopilotSessionTurnResponse): string {
  return normalizeCopilotTurn(response).text;
}

function statusLabel(status: CustomerIntelligenceCopilotResponse["status"]): string {
  if (status === "answered_from_context") return "Answered context";
  return status.replace(/_/g, " ");
}

// Tone follows the backend's own finalResponseState/interactionType, not an enumeration of every
// known status string - a status this component has never seen still renders sensibly as long as
// the backend keeps reporting finalResponseState (success/degraded_success/failure).
function toneForCopilotTurn(normalized: NormalizedCopilotTurn): "blue" | "green" | "amber" | "red" | "gray" | "slate" {
  if (normalized.finalResponseState === "failure") return "red";
  if (normalized.finalResponseState === "degraded_success") return "amber";
  if (normalized.interactionType === "clarification" || normalized.interactionType === "unsupported") return "amber";
  return "green";
}

function stateTitle(status: CustomerIntelligenceCopilotResponse["status"] | "provider_error", normalized?: NormalizedCopilotTurn): string {
  if (normalized?.contractError) return "Respuesta sin contenido";
  switch (status) {
    case "clarification_required":
      return "Necesito una precision";
    case "unsupported_data":
      return "No puedo responder con los datos disponibles";
    case "unsupported_operation":
      return "Operacion no soportada";
    case "planner_invalid":
    case "orchestrator_invalid":
      return "Plan invalido";
    case "analytics_timeout":
      return "Timeout analitico";
    case "analytics_unavailable":
      return "Analitica no disponible";
    case "provider_error":
      return "Error temporal del modelo";
    default:
      return normalized?.finalResponseState === "failure" ? "Error temporal del modelo" : "Respondido";
  }
}

function userSafeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "Copilot no disponible.";
}

function formatSnapshot(snapshotId: string, referenceTime: string) {
  return `#${snapshotId} - ${formatDateTime(referenceTime)}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function filenameFromDisposition(value: string | null): string | null {
  if (!value) return null;
  const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1]);
  const quotedMatch = /filename="([^"]+)"/i.exec(value);
  if (quotedMatch?.[1]) return quotedMatch[1];
  const plainMatch = /filename=([^;]+)/i.exec(value);
  return plainMatch?.[1]?.trim() ?? null;
}

function createUiId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
