"use client";

import React, { useState } from "react";
import { CaseInlineNote } from "../CaseDetailPrimitives";
import type { CommercialShadowReviewSummary, CommercialShadowReviewViewModel } from "@/lib/brain/commercial/review";

export const COMMERCIAL_HUMAN_EVALUATION_CHOICES = ["yes", "no", "unreviewed"] as const;
export type CommercialHumanEvaluationChoice = (typeof COMMERCIAL_HUMAN_EVALUATION_CHOICES)[number];

export type CommercialHumanEvaluationDraftFormState = {
  responseUseful: CommercialHumanEvaluationChoice;
  responseCorrect: CommercialHumanEvaluationChoice;
  policyTooRestrictive: CommercialHumanEvaluationChoice;
  missingContext: CommercialHumanEvaluationChoice;
  expectedOutcome: string;
  comments: string;
};

export type CommercialHumanEvaluationDraftPreview = {
  draftType: "commercial_shadow_human_evaluation";
  preparedAt: string | null;
  caseId: string | number | null;
  reviewStatus: CommercialShadowReviewViewModel["status"];
  observedAt: string | null;
  responseUseful: boolean | null;
  responseCorrect: boolean | null;
  policyTooRestrictive: boolean | null;
  missingContext: boolean | null;
  expectedOutcome: string | null;
  comments: string | null;
  reviewSummary: {
    shadowStatus: CommercialShadowReviewSummary["shadowStatus"] | null;
    proposalOutcome: CommercialShadowReviewSummary["proposedOutcome"] | null;
    governedOutcome: CommercialShadowReviewSummary["governedOutcome"] | null;
    policyStatus: CommercialShadowReviewSummary["policyStatus"] | null;
    riskLevel: CommercialShadowReviewSummary["riskLevel"] | null;
    approvalRequirement: CommercialShadowReviewSummary["approvalRequirement"] | null;
  };
};

function normalizeText(value: string, maxLength = 2000) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

function choiceToBoolean(value: CommercialHumanEvaluationChoice) {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

export function buildCommercialHumanEvaluationDraftPreview(input: {
  caseId: string | number | null;
  review: CommercialShadowReviewViewModel;
  form: CommercialHumanEvaluationDraftFormState;
  preparedAt?: string | null;
}): CommercialHumanEvaluationDraftPreview {
  return {
    draftType: "commercial_shadow_human_evaluation",
    preparedAt: input.preparedAt ?? null,
    caseId: input.caseId,
    reviewStatus: input.review.status,
    observedAt: input.review.observedAt,
    responseUseful: choiceToBoolean(input.form.responseUseful),
    responseCorrect: choiceToBoolean(input.form.responseCorrect),
    policyTooRestrictive: choiceToBoolean(input.form.policyTooRestrictive),
    missingContext: choiceToBoolean(input.form.missingContext),
    expectedOutcome: normalizeText(input.form.expectedOutcome, 1200),
    comments: normalizeText(input.form.comments, 4000),
    reviewSummary: {
      shadowStatus: input.review.summary?.shadowStatus ?? null,
      proposalOutcome: input.review.summary?.proposedOutcome ?? null,
      governedOutcome: input.review.summary?.governedOutcome ?? null,
      policyStatus: input.review.summary?.policyStatus ?? null,
      riskLevel: input.review.summary?.riskLevel ?? null,
      approvalRequirement: input.review.summary?.approvalRequirement ?? null
    }
  };
}

function fieldChoiceLabel(value: CommercialHumanEvaluationChoice) {
  if (value === "yes") return "sí";
  if (value === "no") return "no";
  return "sin evaluar";
}

export function AiSdrHumanEvaluationDraft({
  review,
  caseId
}: {
  review: CommercialShadowReviewViewModel;
  caseId: string | number | null;
}) {
  void React;
  const [form, setForm] = useState<CommercialHumanEvaluationDraftFormState>({
    responseUseful: "unreviewed",
    responseCorrect: "unreviewed",
    policyTooRestrictive: "unreviewed",
    missingContext: "unreviewed",
    expectedOutcome: "",
    comments: ""
  });
  const [preview, setPreview] = useState<CommercialHumanEvaluationDraftPreview | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  function updateChoice(field: keyof CommercialHumanEvaluationDraftFormState, value: CommercialHumanEvaluationChoice | string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function prepareEvaluation() {
    const nextPreview = buildCommercialHumanEvaluationDraftPreview({
      caseId,
      review,
      form,
      preparedAt: new Date().toISOString()
    });
    setPreview(nextPreview);
    setCopyState("idle");
  }

  async function copyPreview() {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(preview, null, 2));
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-headline-md text-on-surface">Revision humana</p>
            <p className="mt-1 text-body-md text-slate-500">Borrador local no guardado</p>
          </div>
          <button type="button" className="hub-button-secondary" onClick={prepareEvaluation}>
            Preparar evaluación
          </button>
        </div>
        <CaseInlineNote
          tone="info"
          title="Modo local"
          body="Este formulario solo prepara un borrador en memoria. No escribe en API, DB, audit ni outbox."
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <label className="grid gap-2">
          <span className="text-label-bold uppercase text-slate-500">Respuesta útil</span>
          <select className="hub-input" value={form.responseUseful} onChange={(event) => updateChoice("responseUseful", event.target.value as CommercialHumanEvaluationChoice)}>
            {COMMERCIAL_HUMAN_EVALUATION_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {fieldChoiceLabel(choice)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2">
          <span className="text-label-bold uppercase text-slate-500">Respuesta correcta</span>
          <select className="hub-input" value={form.responseCorrect} onChange={(event) => updateChoice("responseCorrect", event.target.value as CommercialHumanEvaluationChoice)}>
            {COMMERCIAL_HUMAN_EVALUATION_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {fieldChoiceLabel(choice)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2">
          <span className="text-label-bold uppercase text-slate-500">Policy demasiado restrictiva</span>
          <select className="hub-input" value={form.policyTooRestrictive} onChange={(event) => updateChoice("policyTooRestrictive", event.target.value as CommercialHumanEvaluationChoice)}>
            {COMMERCIAL_HUMAN_EVALUATION_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {fieldChoiceLabel(choice)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2">
          <span className="text-label-bold uppercase text-slate-500">Faltó contexto</span>
          <select className="hub-input" value={form.missingContext} onChange={(event) => updateChoice("missingContext", event.target.value as CommercialHumanEvaluationChoice)}>
            {COMMERCIAL_HUMAN_EVALUATION_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {fieldChoiceLabel(choice)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 lg:col-span-2">
          <span className="text-label-bold uppercase text-slate-500">Outcome esperado</span>
          <input className="hub-input" value={form.expectedOutcome} onChange={(event) => updateChoice("expectedOutcome", event.target.value)} placeholder="Describe el outcome esperado" />
        </label>

        <label className="grid gap-2 lg:col-span-2">
          <span className="text-label-bold uppercase text-slate-500">Comentarios</span>
          <textarea
            className="hub-input min-h-[96px]"
            value={form.comments}
            onChange={(event) => updateChoice("comments", event.target.value)}
            placeholder="Observaciones locales, sin persistencia"
          />
        </label>
      </div>

      <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-label-bold uppercase text-slate-500">Vista previa JSON</p>
          <div className="flex items-center gap-2">
            {preview ? (
              <button type="button" className="hub-button-secondary" onClick={() => void copyPreview()}>
                Copiar JSON
              </button>
            ) : null}
            {copyState === "copied" ? <span className="text-label-sm text-emerald-700">Copiado</span> : null}
            {copyState === "error" ? <span className="text-label-sm text-rose-700">No se pudo copiar</span> : null}
          </div>
        </div>

        {preview ? (
          <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-4 text-[12px] leading-5 text-slate-800">
            {JSON.stringify(preview, null, 2)}
          </pre>
        ) : (
          <p className="mt-3 text-body-md text-slate-500">La vista previa aparecerá al preparar la evaluación.</p>
        )}
      </div>

    </section>
  );
}
