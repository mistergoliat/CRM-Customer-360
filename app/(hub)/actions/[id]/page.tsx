import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { WorkspaceShell } from "@/components/p1m/WorkspaceShell";
import { getActionById } from "@/lib/domains/actions/service";
import { getModuleModeLabel, type ModuleDataMode } from "@/lib/domains/runtime/data-source-status";

type ActionDetailProps = {
  params: Promise<{ id: string }>;
};

function surfaceKindForMode(mode: ModuleDataMode) {
  if (mode === "real") return "real" as const;
  if (mode === "partial") return "preview" as const;
  return "notAvailable" as const;
}

function toneForStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (["blocked", "failed", "cancelled"].includes(normalized)) return "red" as const;
  if (["requires_review", "review", "planned", "scheduled"].includes(normalized)) return "amber" as const;
  if (["sent", "delivered", "read", "executed"].includes(normalized)) return "green" as const;
  if (["draft", "proposed", "pending"].includes(normalized)) return "blue" as const;
  return "gray" as const;
}

function toneForRisk(risk: string) {
  if (risk === "Alto") return "red" as const;
  if (risk === "Medio") return "amber" as const;
  if (risk === "Bajo") return "green" as const;
  return "gray" as const;
}

function toneForApproval(approval: string) {
  const normalized = approval.trim().toLowerCase();
  if (normalized.includes("review") || normalized.includes("operator")) return "red" as const;
  if (normalized.includes("auto") || normalized.includes("none")) return "green" as const;
  return "amber" as const;
}

function fallbackList(values: string[] | null | undefined, fallback = "No disponible") {
  return values && values.length > 0 ? values : [fallback];
}

export default async function ActionDetailPage({ params }: ActionDetailProps) {
  const { id } = await params;
  const data = await getActionById(id);

  if (!data || !data.action) {
    return <EmptyState title="Accion no disponible" description={`No se encontro informacion operativa para ${id}.`} />;
  }

  const { action, lifecycle, rationale, evidence, missing, eligibility, guardrails, preview, warnings, meta } = data;
  const badgeKind = surfaceKindForMode(meta.mode);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Acciones"
        title={action.client}
        description="Detalle de accion real con lifecycle, rationale y guardrails."
        status={getModuleModeLabel(meta.mode)}
        actions={<SurfaceBadge kind={badgeKind} />}
      />

      {warnings.length > 0 ? <ErrorState title="Warnings de accion" message={warnings.join(", ")} /> : null}

      <WorkspaceShell
        sidebar={
          <div className="space-y-5">
            <SectionCard title="Resumen" eyebrow="Action" description="Estado operativo actual" actions={<StatusChip label={action.status} tone={toneForStatus(action.status)} />}>
              <InfoGrid
                items={[
                  { label: "Cliente", value: action.client },
                  { label: "Entidad", value: action.relatedEntity },
                  { label: "Riesgo", value: <StatusChip label={action.risk} tone={toneForRisk(action.risk)} /> },
                  { label: "Aprobacion", value: <StatusChip label={action.approval} tone={toneForApproval(action.approval)} /> },
                  { label: "Programacion", value: action.schedule },
                  { label: "Origen", value: action.origin }
                ]}
                columns={2}
              />
            </SectionCard>

            <SectionCard title="Lifecycle" eyebrow="History" description="Eventos persistidos por el queue">
              <div className="space-y-2">
                {lifecycle.map((item, index) => (
                  <div key={item} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-body-md font-semibold text-on-surface">{item}</p>
                      <StatusChip label={String(index + 1)} tone="gray" />
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        }
        main={
          <div className="space-y-5">
            <SectionCard title="Preview" eyebrow="Execution" description="Vista factual del mensaje o payload esperado">
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-label-bold uppercase text-slate-500">Preview</p>
                  <p className="mt-2 text-body-md text-slate-700">{preview}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-label-bold uppercase text-slate-500">Rationale</p>
                  <p className="mt-2 text-body-md text-slate-700">{rationale}</p>
                </div>
                <InfoGrid
                  items={[
                    { label: "Status", value: action.status },
                    { label: "Risk", value: action.risk },
                    { label: "Approval", value: action.approval },
                    { label: "Scheduled", value: action.schedule }
                  ]}
                  columns={2}
                />
              </div>
            </SectionCard>

            <SectionCard title="Evidence" eyebrow="Signals" description="Lo que el sistema uso para construir la accion">
              <ul className="list-disc space-y-2 pl-5 text-body-md text-slate-700">
                {fallbackList(evidence).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </SectionCard>
          </div>
        }
        rail={
          <div className="space-y-5">
            <SectionCard title="Eligibility" eyebrow="Guardrails" description="Condiciones observadas para la accion">
              <ul className="list-disc space-y-2 pl-5 text-body-md text-slate-700">
                {fallbackList(eligibility).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </SectionCard>

            <SectionCard title="Guardrails" eyebrow="Safety" description="Reglas que explican por que la accion existe">
              <ul className="list-disc space-y-2 pl-5 text-body-md text-slate-700">
                {fallbackList(guardrails).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </SectionCard>

            <SectionCard title="Missing" eyebrow="Gaps" description="Lo que aun falta para completar la ejecucion">
              <ul className="list-disc space-y-2 pl-5 text-body-md text-slate-700">
                {fallbackList(missing).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </SectionCard>
          </div>
        }
      />
    </div>
  );
}
