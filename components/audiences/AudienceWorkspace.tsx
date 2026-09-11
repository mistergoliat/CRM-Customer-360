"use client";

import { useEffect, useMemo, useState } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { SectionCard } from "@/components/p1m/SectionCard";
import {
  compileAudienceDefinition,
  createEmptyAudienceBuilderState,
  flattenAudiencePreviewRow,
  hashAudienceDefinition,
  isBuilderGroupEmpty,
  readAudienceEvaluateResponse,
  type AudienceBuilderGroup,
  type AudienceBuilderState,
  type AudienceCapabilitySchema,
  type AudienceEvaluationSummary,
  type AudienceExportField,
  type AudienceExportFormat,
  type AudienceValidationErrorV1
} from "@/lib/marketing/customerIntelligenceAudience";
import { AudienceBuilder } from "./AudienceBuilder";
import { AudienceExportPanel } from "./AudienceExportPanel";
import { AudiencePreviewTable } from "./AudiencePreviewTable";
import { AudienceStatusBanner, type AudienceWorkspaceStatus } from "./AudienceStatusBanner";
import { AudienceSummary } from "./AudienceSummary";

type SchemaState = { readonly status: "loading" } | { readonly status: "ready"; readonly schema: AudienceCapabilitySchema } | { readonly status: "error"; readonly message: string };

type EvaluateOutcome =
  | { readonly kind: "success"; readonly summary: AudienceEvaluationSummary }
  | { readonly kind: "blocked"; readonly reason: string; readonly validationErrors: readonly AudienceValidationErrorV1[] }
  | { readonly kind: "error"; readonly message: string };

export function AudienceWorkspace() {
  const [schemaState, setSchemaState] = useState<SchemaState>({ status: "loading" });
  const [builderState, setBuilderState] = useState<AudienceBuilderState>(() => createEmptyAudienceBuilderState());
  const [phase, setPhase] = useState<"idle" | "evaluating" | "exporting">("idle");
  const [evaluateOutcome, setEvaluateOutcome] = useState<EvaluateOutcome | null>(null);
  const [evaluatedChecksum, setEvaluatedChecksum] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportWarning, setExportWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/audiences/schema");
        const body: unknown = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !isAudienceCapabilitySchema(body)) {
          setSchemaState({ status: "error", message: describeAudienceError(response.status, errorMessageFromBody(body)) });
          return;
        }
        setSchemaState({ status: "ready", schema: body });
      } catch {
        if (!cancelled) setSchemaState({ status: "error", message: "No se pudo cargar el esquema de Customer Profile." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const compileResult = useMemo(
    () => (schemaState.status === "ready" ? compileAudienceDefinition(builderState, schemaState.schema) : { ok: false as const, errors: [] }),
    [builderState, schemaState]
  );
  const currentChecksum = compileResult.ok ? hashAudienceDefinition(compileResult.definition) : null;
  const empty = isBuilderGroupEmpty(builderState);

  const status: AudienceWorkspaceStatus = useMemo(() => {
    if (phase === "evaluating") return "EVALUATING";
    if (phase === "exporting") return "EXPORTING";
    if (evaluateOutcome?.kind === "error" || evaluateOutcome?.kind === "blocked") return "ERROR";
    if (empty) return "EMPTY";
    if (evaluateOutcome?.kind === "success" && currentChecksum !== null && currentChecksum === evaluatedChecksum) return "EVALUATED";
    return "READY_TO_EVALUATE";
  }, [phase, evaluateOutcome, empty, currentChecksum, evaluatedChecksum]);

  function updateRoot(root: AudienceBuilderGroup) {
    setBuilderState({ root });
    setExportWarning(null);
  }

  async function evaluate() {
    if (!compileResult.ok || schemaState.status !== "ready") return;
    setPhase("evaluating");
    setEvaluateOutcome(null);
    setExportWarning(null);
    try {
      const response = await fetch("/api/audiences/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ definition: compileResult.definition, previewLimit: schemaState.schema.limits.defaultPreviewLimit })
      });
      const body: unknown = await response.json().catch(() => null);
      const outcome = readAudienceEvaluateResponse(body);

      if (outcome.kind === "completed") {
        setEvaluateOutcome({ kind: "success", summary: outcome.summary });
        setEvaluatedChecksum(hashAudienceDefinition(compileResult.definition));
        return;
      }
      if (outcome.kind === "blocked") {
        setEvaluateOutcome({ kind: "blocked", reason: outcome.reason, validationErrors: outcome.validationErrors });
        return;
      }
      setEvaluateOutcome({ kind: "error", message: describeAudienceError(response.status, errorMessageFromBody(body)) });
    } catch {
      setEvaluateOutcome({ kind: "error", message: "No se pudo conectar con el backend de audiencias." });
    } finally {
      setPhase("idle");
    }
  }

  async function exportAudience(format: AudienceExportFormat, fields: readonly AudienceExportField[]) {
    if (!compileResult.ok || status !== "EVALUATED") return;
    setPhase("exporting");
    setExportError(null);
    setExportWarning(null);
    try {
      const response = await fetch("/api/audiences/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ definition: compileResult.definition, format, fields })
      });
      if (!response.ok) {
        const errorBody: unknown = await response.json().catch(() => null);
        setExportError(describeAudienceError(response.status, errorMessageFromBody(errorBody)));
        return;
      }
      const matchedCountHeader = response.headers.get("x-audience-export-matched-count");
      const blob = await response.blob();
      const filename = filenameFromDisposition(response.headers.get("content-disposition")) ?? `audience-export.${format.toLowerCase()}`;
      downloadBlob(blob, filename);

      const lastMatched = evaluateOutcome?.kind === "success" ? evaluateOutcome.summary.matched : null;
      if (matchedCountHeader && lastMatched !== null && Number(matchedCountHeader) !== lastMatched) {
        setExportWarning("Los datos analiticos cambiaron desde la ultima evaluacion; el archivo contiene la audiencia mas reciente.");
      }
    } catch {
      setExportError("No se pudo conectar con el backend de exportacion.");
    } finally {
      setPhase("idle");
    }
  }

  return (
    <div className="space-y-5">
      <AudienceStatusBanner status={status} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_420px]">
        <SectionCard title="Definicion de audiencia" eyebrow="Builder" description="Compila hacia AudienceDefinitionV1. Customer Profile valida y evalua de forma autoritativa.">
          {schemaState.status === "loading" ? <p className="text-body-sm text-slate-500">Cargando esquema de Customer Profile...</p> : null}
          {schemaState.status === "error" ? <ErrorState title="Esquema no disponible" message={schemaState.message} /> : null}
          {schemaState.status === "ready" ? (
            <>
              <AudienceBuilder root={builderState.root} schema={schemaState.schema} errors={compileResult.ok ? [] : compileResult.errors} onChange={updateRoot} />
              <button
                type="button"
                className="hub-button-primary mt-4 h-11 px-5 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!compileResult.ok || phase === "evaluating"}
                onClick={() => void evaluate()}
              >
                {phase === "evaluating" ? "Evaluando..." : "Evaluar audiencia"}
              </button>
            </>
          ) : null}
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Resumen" eyebrow="Customer Profile" description="Conteos autoritativos de la ultima evaluacion.">
            {evaluateOutcome?.kind === "success" ? (
              <AudienceSummary summary={evaluateOutcome.summary} />
            ) : evaluateOutcome?.kind === "blocked" ? (
              <ErrorState title={describeBlockedReason(evaluateOutcome.reason)} message={validationErrorsSummary(evaluateOutcome.validationErrors)} />
            ) : evaluateOutcome?.kind === "error" ? (
              <ErrorState title="No se pudo evaluar" message={evaluateOutcome.message} />
            ) : (
              <p className="text-body-sm text-slate-500">Aun no hay evaluacion. Completa la definicion y presiona &quot;Evaluar audiencia&quot;.</p>
            )}
          </SectionCard>

          <SectionCard title="Exportar" eyebrow="CSV / XLSX" description="Descarga directa al equipo del usuario. Sin almacenamiento en CRM.">
            <AudienceExportPanel disabled={status !== "EVALUATED"} exporting={phase === "exporting"} exportError={exportError} exportWarning={exportWarning} onExport={(format, fields) => void exportAudience(format, fields)} />
          </SectionCard>
        </div>
      </div>

      <SectionCard title="Vista previa" eyebrow="Preview" description="Muestra acotada devuelta por la evaluacion (no es la audiencia completa ni autoridad de exportacion).">
        {evaluateOutcome?.kind === "success" ? (
          <AudiencePreviewTable preview={evaluateOutcome.summary.preview.map(flattenAudiencePreviewRow)} />
        ) : (
          <p className="text-body-sm text-slate-500">Evalua la audiencia para ver una muestra.</p>
        )}
      </SectionCard>
    </div>
  );
}

function isAudienceCapabilitySchema(value: unknown): value is AudienceCapabilitySchema {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.fields) &&
    typeof record.specialConditions === "object" &&
    record.specialConditions !== null &&
    typeof record.limits === "object" &&
    record.limits !== null
  );
}

function errorMessageFromBody(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.error === "string") return record.error;
  return undefined;
}

function describeBlockedReason(reason: string): string {
  switch (reason) {
    case "INVALID_DEFINITION":
      return "Definicion invalida";
    case "INCOMPATIBLE_SNAPSHOT":
      return "Snapshot analitico incompatible";
    case "BUDGET_EXCEEDED":
      return "Audiencia demasiado costosa de evaluar";
    case "QUERY_TIMEOUT":
      return "La evaluacion excedio el tiempo de espera";
    default:
      return "No se pudo completar la evaluacion";
  }
}

function validationErrorsSummary(validationErrors: readonly AudienceValidationErrorV1[]): string {
  if (validationErrors.length === 0) return "Customer Profile rechazo la definicion.";
  return validationErrors
    .slice(0, 3)
    .map((error) => `${error.path}: ${error.message}`)
    .join(" | ");
}

function describeAudienceError(status: number, message?: string): string {
  switch (status) {
    case 400:
      return message ?? "La definicion de audiencia es invalida.";
    case 401:
    case 403:
      return "No tienes permiso para esta operacion.";
    case 404:
      return "El Audience Workspace no esta habilitado en este entorno.";
    case 409:
      return "Los datos analiticos cambiaron. Vuelve a evaluar la audiencia.";
    case 413:
      return "La audiencia es demasiado grande para el limite de exportacion actual.";
    case 429:
      return "Capacidad de exportacion saturada. Intenta nuevamente en unos minutos.";
    case 503:
      return "Customer Profile no esta disponible en este momento.";
    case 504:
      return "La operacion excedio el tiempo de espera.";
    default:
      return message ?? "Ocurrio un error inesperado.";
  }
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

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
