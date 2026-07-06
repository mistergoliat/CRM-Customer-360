import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { WorkspaceShell } from "@/components/p1m/WorkspaceShell";
import { getOpportunityById } from "@/lib/domains/opportunities/service";
import { getModuleModeLabel, type ModuleDataMode } from "@/lib/domains/runtime/data-source-status";

type OpportunityDetailProps = {
  params: Promise<{ id: string }>;
};

function surfaceKindForMode(mode: ModuleDataMode) {
  if (mode === "real") return "real" as const;
  if (mode === "partial") return "preview" as const;
  return "notAvailable" as const;
}

function toneForStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (["won"].includes(normalized)) return "green" as const;
  if (["lost", "archived", "cancelled"].includes(normalized)) return "red" as const;
  if (["requires_review", "pending", "waiting", "blocked"].includes(normalized)) return "amber" as const;
  if (["active", "open"].includes(normalized)) return "blue" as const;
  return "gray" as const;
}

function toneForStage(stage: string) {
  const normalized = stage.trim().toLowerCase();
  if (["won"].includes(normalized)) return "green" as const;
  if (["lost", "archived", "cancelled"].includes(normalized)) return "red" as const;
  if (["quote_pending", "purchase_intent", "checkout_support"].includes(normalized)) return "amber" as const;
  if (["discovery", "qualification", "recommendation", "objection_handling", "follow_up", "handoff"].includes(normalized)) return "blue" as const;
  return "gray" as const;
}

function toneForRisk(risk: string) {
  if (risk === "Alto") return "red" as const;
  if (risk === "Medio") return "amber" as const;
  if (risk === "Bajo") return "green" as const;
  return "gray" as const;
}

function fallbackList(values: string[] | null | undefined, fallback = "No disponible") {
  return values && values.length > 0 ? values : [fallback];
}

export default async function OpportunityDetailPage({ params }: OpportunityDetailProps) {
  const { id } = await params;
  const data = await getOpportunityById(id);

  if (!data || !data.opportunity) {
    return <EmptyState title="Oportunidad no disponible" description={`No se encontro informacion operativa para ${id}.`} />;
  }

  const { opportunity, customer, profile, decision, actions, timeline, quote, copilot, warnings, meta } = data;
  const badgeKind = surfaceKindForMode(meta.mode);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Oportunidades"
        title={customer?.name ?? opportunity.customer}
        description="Workspace operativo de oportunidad con decision, profile, timeline y acciones reales."
        status={getModuleModeLabel(meta.mode)}
        actions={<SurfaceBadge kind={badgeKind} />}
      />

      {warnings.length > 0 ? <ErrorState title="Warnings de oportunidad" message={warnings.join(", ")} /> : null}

      <WorkspaceShell
        sidebar={
          <div className="space-y-5">
            <SectionCard title="Resumen" eyebrow="Opportunity" description="Estado operativo actual" actions={<StatusChip label={opportunity.status} tone={toneForStatus(opportunity.status)} />}>
              <InfoGrid
                items={[
                  { label: "Etapa", value: <StatusChip label={opportunity.stage} tone={toneForStage(opportunity.stage)} /> },
                  { label: "Valor estimado", value: opportunity.estimatedValue },
                  { label: "Responsable", value: opportunity.owner },
                  { label: "Riesgo", value: <StatusChip label={opportunity.risk} tone={toneForRisk(opportunity.risk)} /> },
                  { label: "Ultima actividad", value: opportunity.activity },
                  { label: "Origen", value: opportunity.source }
                ]}
                columns={2}
              />
            </SectionCard>

            <SectionCard title="Customer 360 provisional" eyebrow="Identity" description="La identidad sigue siendo provisional mientras no exista customer_master definitivo.">
              <InfoGrid
                items={[
                  { label: "Email", value: customer?.email ?? "No disponible" },
                  { label: "Plataforma", value: customer?.platformOrigin ?? "No disponible" },
                  { label: "Fuente", value: customer?.source ?? "No disponible" }
                ]}
              />
            </SectionCard>

            <SectionCard title="Need profile" eyebrow="Profile" description="Lo que el sistema sabe hoy de la necesidad">
              {profile ? (
                <div className="space-y-4">
                  <InfoGrid
                    items={[
                      { label: "Use case", value: profile.useCase ?? "No disponible" },
                      { label: "Cliente", value: profile.customerType ?? "No disponible" },
                      { label: "Urgencia", value: profile.purchaseUrgency ?? "No disponible" },
                      { label: "Readiness", value: profile.decisionReadiness ?? "No disponible" },
                      { label: "Experiencia", value: profile.experienceLevel ?? "No disponible" },
                      { label: "Ultima actualizacion", value: profile.lastUpdatedAt }
                    ]}
                    columns={2}
                  />
                  <div>
                    <p className="text-label-bold uppercase text-slate-500">Missing information</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {fallbackList(profile.missingInformation).map((item) => (
                        <StatusChip key={item} label={item} tone="gray" />
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState title="Sin profile" description="El backend aun no tiene perfil de necesidades para esta oportunidad." />
              )}
            </SectionCard>
          </div>
        }
        main={
          <div className="space-y-5">
            <SectionCard title="Timeline" eyebrow="Activity" description="Hechos operativos ordenados por recencia">
              <div className="space-y-3">
                {timeline.map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-on-surface">{item.title}</p>
                      <StatusChip label={item.time} tone={item.tone} />
                    </div>
                    <p className="mt-1 text-body-md text-slate-600">{item.subtitle}</p>
                  </div>
                ))}
              </div>
            </SectionCard>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_360px]">
              <SectionCard title="Decision" eyebrow="Governance" description="Ultima decision registrada por el cerebro comercial">
                {decision ? (
                  <div className="space-y-4">
                    <InfoGrid
                      items={[
                        { label: "Decision", value: decision.decisionId },
                        { label: "Next status", value: decision.nextStatus },
                        { label: "Next stage", value: decision.nextStage ?? "No disponible" },
                        { label: "Created at", value: decision.createdAt }
                      ]}
                      columns={2}
                    />
                    <div>
                      <p className="text-label-bold uppercase text-slate-500">Rationale</p>
                      <p className="mt-2 text-body-md text-slate-700">{decision.rationale}</p>
                    </div>
                    {decision.warnings.length > 0 ? (
                      <div>
                        <p className="text-label-bold uppercase text-slate-500">Warnings</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {decision.warnings.map((item) => (
                            <StatusChip key={item} label={item} tone="amber" />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <EmptyState title="Sin decision" description="No hay una decision comercial registrada aun." />
                )}
              </SectionCard>

              <SectionCard title="Quote" eyebrow="Commercial" description="La cotizacion sigue siendo una lectura real del backend">
                {quote ? (
                  <InfoGrid
                    items={[
                      { label: "Numero", value: quote.number },
                      { label: "Estado", value: quote.status },
                      { label: "Monto", value: quote.amount },
                      { label: "Emitida", value: quote.issued },
                      { label: "Expira", value: quote.expiry }
                    ]}
                  />
                ) : (
                  <EmptyState title="Sin cotizacion" description="El backend aun no expone una cotizacion para esta oportunidad." />
                )}
              </SectionCard>
            </div>

            <SectionCard title="AI SDR Copilot" eyebrow="Copilot" description="Resumen operativo y evidencia factual">
              <div className="space-y-4">
                <p className="text-body-md text-slate-700">{copilot.summary}</p>
                <InfoGrid
                  items={[
                    { label: "Next action", value: copilot.nextAction },
                    { label: "Risk", value: copilot.risk },
                    { label: "Approval", value: copilot.approval }
                  ]}
                  columns={3}
                />
                <div>
                  <p className="text-label-bold uppercase text-slate-500">Evidence</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-body-md text-slate-700">
                    {fallbackList(copilot.evidence).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </SectionCard>
          </div>
        }
        rail={
          <SectionCard title="Acciones vinculadas" eyebrow="Action" description="Acciones reales asociadas a la oportunidad">
            {actions.length > 0 ? (
              <div className="space-y-3">
                {actions.map((action) => (
                  <div key={action.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-on-surface">{action.actionType}</p>
                        <p className="text-label-sm text-slate-500">{action.actionId}</p>
                      </div>
                      <StatusChip label={action.status} tone={toneForStatus(action.status)} />
                    </div>
                    <div className="mt-3 grid gap-2">
                      <InfoGrid
                        items={[
                          { label: "Risk", value: action.riskLevel },
                          { label: "Approval", value: action.approvalRequirement },
                          { label: "Owner", value: action.owner },
                          { label: "Scheduled", value: action.scheduledFor ?? "No disponible" }
                        ]}
                        columns={2}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Sin acciones" description="Todavia no hay acciones de cola vinculadas a esta oportunidad." />
            )}
          </SectionCard>
        }
      />
    </div>
  );
}
