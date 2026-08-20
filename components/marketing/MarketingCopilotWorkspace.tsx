"use client";

import React, { useMemo, useState } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import {
  CUSTOMER_INTELLIGENCE_COPILOT_DEMO_QUESTIONS,
  type CustomerIntelligenceCopilotResponse
} from "@/lib/marketing/customerIntelligenceCopilot";

void React;

type MarketingCopilotWorkspaceProps = {
  data: {
    quickReplies?: string[];
  };
};

type Turn = {
  id: string;
  question: string;
  response: CustomerIntelligenceCopilotResponse;
};

export function MarketingCopilotWorkspace({ data: _data }: MarketingCopilotWorkspaceProps) {
  void _data;
  const examples = CUSTOMER_INTELLIGENCE_COPILOT_DEMO_QUESTIONS;
  const [question, setQuestion] = useState<string>(examples[1] ?? "");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = turns[0] ?? null;
  const canSubmit = question.trim().length > 0 && !loading;

  async function submit(nextQuestion = question) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || loading) return;
    setQuestion(trimmed);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/marketing/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed })
      });
      const payload = (await response.json()) as CustomerIntelligenceCopilotResponse | { code?: string; message?: string };
      if (!("status" in payload)) {
        setError(payload.message ?? "Copilot no disponible.");
        return;
      }
      setTurns((current) => [{ id: `${Date.now()}`, question: trimmed, response: payload }, ...current].slice(0, 5));
    } catch {
      setError("No se pudo contactar Marketing Copilot.");
    } finally {
      setLoading(false);
    }
  }

  const provenanceItems = useMemo(() => {
    if (!latest || latest.response.status !== "answered") return [];
    const provenance = latest.response.provenance;
    return [
      { label: "Comercial", value: formatSnapshot(provenance.featureSnapshot.snapshotId, provenance.featureSnapshot.referenceTime) },
      { label: "RFM", value: provenance.rfmSnapshot ? formatSnapshot(provenance.rfmSnapshot.snapshotId, provenance.rfmSnapshot.referenceTime) : "Sin snapshot compatible" },
      { label: "Clustering", value: provenance.clusterSnapshot ? `${formatSnapshot(provenance.clusterSnapshot.snapshotId, provenance.clusterSnapshot.referenceTime)} - ${provenance.clusterSnapshot.modelVersion}` : "Sin snapshot compatible" },
      { label: "Cobertura RFM", value: `${provenance.population.rfmCoveragePct}%` },
      { label: "Cobertura clustering", value: `${provenance.population.clusterCoveragePct}%` },
      { label: "Poblacion analitica", value: provenance.population.featurePopulation.toLocaleString("es-CL") }
    ];
  }, [latest]);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
      <SectionCard title="Pregunta" eyebrow="Marketing Copilot" description="Consulta analitica read-only sobre Customer Intelligence.">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <label htmlFor="marketing-copilot-question" className="text-label-bold uppercase text-slate-500">
              Pregunta
            </label>
            <textarea
              id="marketing-copilot-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ej: Cuantos clientes hay en cada cluster?"
              className="hub-textarea mt-3 min-h-32 w-full bg-white"
              maxLength={4000}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-label-sm text-slate-500">{question.trim().length}/4000</p>
              <button className="hub-button-primary" type="button" disabled={!canSubmit} onClick={() => void submit()}>
                {loading ? "Consultando..." : "Preguntar"}
              </button>
            </div>
          </div>

          <div>
            <p className="text-label-bold uppercase text-slate-500">Checklist demo</p>
            <div className="mt-2 grid gap-2">
              {examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={loading}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-body-md text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  onClick={() => void submit(example)}
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        </div>
      </SectionCard>

      <div className="space-y-5">
        <SectionCard title="Respuesta" eyebrow="Resultado" description="Respuesta generada solo desde resultados analiticos ejecutados por el runtime.">
          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-body-md text-slate-700">Consultando planner, runtime y answerer...</div>
          ) : error ? (
            <StateMessage tone="red" title="Copilot no disponible" body={error} />
          ) : latest ? (
            <CopilotResponseView turn={latest} />
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-body-md text-slate-700">Selecciona una pregunta del checklist o escribe una consulta analitica.</div>
          )}
        </SectionCard>

        <SectionCard title="Provenance" eyebrow="Contexto" description="Snapshot y cobertura usados para auditar la respuesta.">
          {latest?.response.status === "answered" ? (
            <div className="space-y-4">
              <InfoGrid items={provenanceItems} columns={3} />
              <CoverageNote response={latest.response} />
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-body-md text-slate-700">
              La provenance aparece cuando una consulta se responde con datos.
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function CopilotResponseView({ turn }: { turn: Turn }) {
  const response = turn.response;
  if (response.status === "answered") {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
          <div className="flex items-center gap-2">
            <StatusChip label="Answered" tone="blue" />
            <span className="text-label-sm text-slate-500">{response.analysis.queryCount} query runtime</span>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-body-lg text-on-surface">{response.answer}</p>
        </div>
        <InfoGrid
          items={[
            { label: "Filas resultado", value: response.analysis.resultRowCount.toLocaleString("es-CL") },
            { label: "Duracion runtime", value: `${response.analysis.executionDurationMs} ms` },
            { label: "Planner", value: response.analysis.plannerModel ?? "No reportado" },
            { label: "Answerer", value: response.analysis.answerModel ?? "No reportado" }
          ]}
          columns={4}
        />
      </div>
    );
  }

  if (response.status === "clarification_required") {
    return <StateMessage tone="amber" title="Necesita criterio" body={response.message} />;
  }
  if (response.status === "unsupported_data") {
    return <StateMessage tone="amber" title="Dato no disponible" body={response.message} />;
  }
  if (response.status === "unsupported_operation") {
    return <StateMessage tone="amber" title="Operacion no soportada" body={response.message} />;
  }
  if (response.status === "planner_invalid") {
    return <StateMessage tone="red" title="Planner invalido" body={response.errors.join(" - ")} />;
  }
  return <StateMessage tone="red" title="Servicio degradado" body={response.message} />;
}

function StateMessage({ tone, title, body }: { tone: "amber" | "red"; title: string; body: string }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone === "amber" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}>
      <StatusChip label={title} tone={tone === "amber" ? "amber" : "red"} />
      <p className="mt-3 text-body-md text-slate-700">{body}</p>
    </div>
  );
}

function CoverageNote({ response }: { response: Extract<CustomerIntelligenceCopilotResponse, { status: "answered" }> }) {
  const { population } = response.provenance;
  if (population.clusterCoveragePct >= 99 && population.rfmCoveragePct >= 99) return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-body-md text-slate-700">
      Cobertura parcial: RFM cubre {population.rfmCoveragePct}% y clustering cubre {population.clusterCoveragePct}% de la poblacion analitica del snapshot.
    </div>
  );
}

function formatSnapshot(snapshotId: string, referenceTime: string) {
  return `#${snapshotId} - ${new Date(referenceTime).toLocaleDateString("es-CL")}`;
}
