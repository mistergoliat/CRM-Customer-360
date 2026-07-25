import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { formatDateTime } from "@/lib/format";
import { stateForTone, type ChipTone } from "@/lib/status";
import { getFollowUpSummary } from "@/lib/domains/follow-up-observability/summaryService";
import { listFollowUps } from "@/lib/domains/follow-up-observability/listService";
import { getFollowUpDetail } from "@/lib/domains/follow-up-observability/detailService";
import { FOLLOW_UP_CRITICALITY_VALUES, FOLLOW_UP_STATUS_VALUES, FOLLOW_UP_SUMMARY_RANGES } from "@/lib/domains/follow-up-observability/constants";
import { MISSING_CONFIGURATION_BADGE_LABEL, labelForFollowUpStatus } from "@/lib/domains/follow-up-observability/reasonLabels";
import type { FollowUpCriticalSignal } from "@/lib/domains/follow-up-observability/types";
import {
  parseCriticality,
  parseFreeText,
  parsePage,
  parsePositiveInt,
  parseRange,
  parseStatusList
} from "@/app/api/brain/agents/sales/follow-ups/_lib/httpHelpers";

type FollowUpsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function param(searchParams: Record<string, string | string[] | undefined>, key: string): string | null {
  const value = searchParams[key];
  const resolved = Array.isArray(value) ? value[0] : value;
  return resolved === undefined ? null : resolved;
}

function toneForFollowUpStatus(status: string): ChipTone {
  if (["executed"].includes(status)) return "green";
  if (["cancelled", "failed", "blocked"].includes(status)) return "red";
  if (["planned", "executing", "requires_review"].includes(status)) return "amber";
  return "gray";
}

const CRITICAL_SIGNAL_LABELS: Record<FollowUpCriticalSignal, string> = {
  planned_overdue: "Planificado vencido",
  executing_stale: "Ejecución estancada",
  missing_schedule: "Sin fecha programada",
  missing_configuration: MISSING_CONFIGURATION_BADGE_LABEL,
  requires_review: "Requiere revisión"
};

function buildHref(base: Record<string, string | null | undefined>, overrides: Record<string, string | number | null | undefined>) {
  const params = new URLSearchParams();
  const merged = { ...base, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `/agents/sales/follow-ups?${query}` : "/agents/sales/follow-ups";
}

export default async function SalesFollowUpsPage({ searchParams }: FollowUpsPageProps) {
  const sp = await searchParams;

  const rangeParsed = parseRange(param(sp, "range"));
  const range = (rangeParsed.ok ? rangeParsed.value : undefined) ?? "24h";
  const statusParsed = parseStatusList(param(sp, "status"));
  const status = statusParsed.ok ? statusParsed.value : undefined;
  const reasonParsed = parseFreeText(param(sp, "reason"));
  const reason = reasonParsed.ok ? reasonParsed.value : undefined;
  const opportunityIdParsed = parsePositiveInt(param(sp, "opportunityId"));
  const opportunityId = opportunityIdParsed.ok ? opportunityIdParsed.value : undefined;
  const conversationCaseIdParsed = parsePositiveInt(param(sp, "conversationCaseId"));
  const conversationCaseId = conversationCaseIdParsed.ok ? conversationCaseIdParsed.value : undefined;
  const actionIdParsed = parseFreeText(param(sp, "actionId"));
  const actionId = actionIdParsed.ok ? actionIdParsed.value : undefined;
  const criticalityParsed = parseCriticality(param(sp, "criticality"));
  const criticality = criticalityParsed.ok ? criticalityParsed.value : undefined;
  const pageParsed = parsePage(param(sp, "page"));
  const page = pageParsed.ok ? pageParsed.value : 1;

  const baseParams = {
    range,
    status: status?.join(","),
    reason,
    opportunityId: opportunityId ? String(opportunityId) : undefined,
    conversationCaseId: conversationCaseId ? String(conversationCaseId) : undefined,
    actionId,
    criticality
  };

  const [summaryResult, listResult] = await Promise.all([
    getFollowUpSummary(range),
    listFollowUps({ range, status, reason, opportunityId, conversationCaseId, actionId, criticality, page, limit: 25 })
  ]);

  const selectedActionId = actionId ?? listResult.items[0]?.actionId ?? null;
  const detailResult = selectedActionId ? await getFollowUpDetail(selectedActionId) : null;
  const selected = detailResult?.detail ?? null;

  const totalPages = Math.max(1, Math.ceil(listResult.pagination.total / listResult.pagination.limit));
  const warnings = [...summaryResult.warnings, ...listResult.warnings, ...(detailResult?.warnings ?? [])];
  const summary = summaryResult.summary;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agentes"
        title="Seguimientos del Sales Agent"
        description="Observabilidad operativa de follow-ups sobre crm_agent_actions - sin logica comercial nueva, sin escrituras."
        actions={<SurfaceBadge kind="readOnly" />}
      />

      {warnings.length > 0 ? <ErrorState title="Datos parciales" message={`Algunas consultas no estan disponibles: ${warnings.join(", ")}`} /> : null}

      <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
        <StatCard title="Planificados" value={summary.planned} icon="schedule" state={stateForTone("blue")} />
        <StatCard title="Planificados vencidos" value={summary.plannedOverdue} description="scheduled_for > 15 min en el pasado" icon="event_busy" state={stateForTone("amber")} />
        <StatCard title="En ejecucion" value={summary.executing} icon="play_circle" state={stateForTone("blue")} />
        <StatCard title="Ejecucion estancada" value={summary.executingStale} description="updated_at > 300s" icon="hourglass_top" state={stateForTone("amber")} />
        <StatCard title="Ejecutados" value={summary.executed} icon="check_circle" state={stateForTone("green")} />
        <StatCard title="Cancelados" value={summary.cancelled} icon="cancel" state={stateForTone("gray")} />
        <StatCard title="Fallidos" value={summary.failed} icon="error" state={stateForTone("red")} />
        <StatCard title="Bloqueados" value={summary.blocked} icon="block" state={stateForTone("red")} />
        <StatCard title="Requieren revision" value={summary.requiresReview} description="Sin flujo de aprobacion disponible" icon="rule" state={stateForTone("amber")} />
        <StatCard title="Sin scheduled_for" value={summary.missingSchedule} icon="event_busy" state={stateForTone("red")} />
        <StatCard title="Sin configuracion asociada" value={summary.missingConfiguration} icon="settings_suggest" state={stateForTone("gray")} />
      </section>

      <form className="hub-card grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-6" action="/agents/sales/follow-ups">
        <select className="hub-input" name="range" defaultValue={range}>
          {FOLLOW_UP_SUMMARY_RANGES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select className="hub-input" name="status" defaultValue={status?.[0] ?? ""}>
          <option value="">Todos los estados</option>
          {FOLLOW_UP_STATUS_VALUES.map((value) => (
            <option key={value} value={value}>
              {labelForFollowUpStatus(value)}
            </option>
          ))}
        </select>
        <select className="hub-input" name="criticality" defaultValue={criticality ?? ""}>
          <option value="">Cualquier señal</option>
          {FOLLOW_UP_CRITICALITY_VALUES.map((value) => (
            <option key={value} value={value}>
              {CRITICAL_SIGNAL_LABELS[value]}
            </option>
          ))}
        </select>
        <input className="hub-input" name="reason" defaultValue={reason ?? ""} placeholder="Motivo (cancel/failure reason)" />
        <input className="hub-input" name="opportunityId" defaultValue={opportunityId ? String(opportunityId) : ""} placeholder="Oportunidad" />
        <input className="hub-input" name="conversationCaseId" defaultValue={conversationCaseId ? String(conversationCaseId) : ""} placeholder="Conversacion" />
        <input className="hub-input md:col-span-2" name="actionId" defaultValue={actionId ?? ""} placeholder="Buscar por action_id" />
        <button className="hub-button-primary" type="submit">
          Filtrar
        </button>
      </form>

      <SectionCard
        title="Follow-ups (schedule_followup)"
        eyebrow="crm_agent_actions"
        description="Fuente unica: crm_agent_actions. Sin duplicacion de estado, sin tabla de eventos nueva."
        actions={<StatusChip label={`${listResult.pagination.total} resultados`} tone="gray" />}
      >
        {listResult.items.length === 0 ? (
          <EmptyState title="Sin follow-ups" description="No hay filas para este filtro." />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="hub-table">
              <thead>
                <tr>
                  <th>Estado</th>
                  <th>Señal critica</th>
                  <th>Action ID</th>
                  <th>Oportunidad</th>
                  <th>Conversacion</th>
                  <th>Cliente</th>
                  <th>Intento</th>
                  <th>Programado</th>
                  <th>Motivo</th>
                  <th>Configuracion</th>
                  <th>Actualizado</th>
                </tr>
              </thead>
              <tbody>
                {listResult.items.map((item) => (
                  <tr key={item.actionId} className={item.actionId === selectedActionId ? "bg-primary-fixed/30" : undefined}>
                    <td>
                      <StatusChip label={item.statusLabel} tone={toneForFollowUpStatus(item.status)} />
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {item.criticalSignals.length === 0 ? (
                          <span className="text-body-md text-slate-400">-</span>
                        ) : (
                          item.criticalSignals.map((signal) => <StatusChip key={signal} label={CRITICAL_SIGNAL_LABELS[signal]} tone="amber" />)
                        )}
                      </div>
                    </td>
                    <td>
                      <Link href={buildHref(baseParams, { actionId: item.actionId })} className="font-mono text-body-md text-primary hover:underline">
                        {item.actionIdShort}
                      </Link>
                    </td>
                    <td>{item.opportunityKey ?? item.opportunityId ?? "-"}</td>
                    <td>{item.conversationCaseId ?? "-"}</td>
                    <td className="font-mono">{item.waIdMasked ?? "-"}</td>
                    <td>
                      {item.attemptNumber}/{item.maxAttempts}
                    </td>
                    <td>{item.scheduledFor ? formatDateTime(item.scheduledFor) : "Sin fecha"}</td>
                    <td>{item.reason.label || "-"}</td>
                    <td>{item.configuration.source ? `${item.configuration.source} v${item.configuration.version ?? "?"}` : MISSING_CONFIGURATION_BADGE_LABEL}</td>
                    <td>{item.updatedAt ? formatDateTime(item.updatedAt) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="flex items-center justify-between gap-3">
        <p className="text-body-md text-slate-500">
          Pagina {listResult.pagination.page} de {totalPages}. Total: {listResult.pagination.total}
        </p>
        <div className="flex gap-2">
          <Link className="hub-button-secondary" href={buildHref(baseParams, { page: Math.max(1, listResult.pagination.page - 1) })}>
            Anterior
          </Link>
          <Link className="hub-button-secondary" href={buildHref(baseParams, { page: Math.min(totalPages, listResult.pagination.page + 1) })}>
            Siguiente
          </Link>
        </div>
      </div>

      <SectionCard
        title="Detalle"
        eyebrow="Seleccion"
        description={selected ? selected.item.actionId : "Sin seleccion"}
        actions={selected ? <StatusChip label={selected.item.statusLabel} tone={toneForFollowUpStatus(selected.item.status)} /> : undefined}
      >
        {!selected ? (
          <EmptyState title="Sin detalle" description="Selecciona un follow-up de la tabla para ver su detalle." />
        ) : (
          <div className="space-y-5">
            <InfoGrid
              columns={3}
              items={[
                { label: "Action ID", value: selected.item.actionId },
                { label: "Cliente (wa_id)", value: selected.item.waIdMasked ?? "-" },
                { label: "Intento", value: `${selected.item.attemptNumber}/${selected.item.maxAttempts}` },
                { label: "Programado para", value: selected.item.scheduledFor ? formatDateTime(selected.item.scheduledFor) : "Sin fecha" },
                { label: "Creado", value: selected.timestamps.createdAt ? formatDateTime(selected.timestamps.createdAt) : "-" },
                { label: "Actualizado", value: selected.timestamps.updatedAt ? formatDateTime(selected.timestamps.updatedAt) : "-" },
                { label: "Ejecutado", value: selected.timestamps.executedAt ? formatDateTime(selected.timestamps.executedAt) : "-" },
                { label: "Cancelado", value: selected.timestamps.cancelledAt ? formatDateTime(selected.timestamps.cancelledAt) : "-" },
                { label: "Aprobado", value: selected.timestamps.approvedAt ? formatDateTime(selected.timestamps.approvedAt) : "-" }
              ]}
            />

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-label-bold uppercase text-slate-500">Motivos estructurados</p>
                <p className="mt-1 text-body-md text-slate-700">Cancel reason: {selected.reasons.cancelReason ?? "-"}</p>
                <p className="text-body-md text-slate-700">Failure reason: {selected.reasons.failureReason ?? "-"}</p>
                <p className="mt-2 text-label-bold uppercase text-slate-500">Block reasons</p>
                <p className="text-body-md text-slate-700">{selected.reasons.blockReasons.length > 0 ? selected.reasons.blockReasons.join(", ") : "-"}</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-label-bold uppercase text-slate-500">Snapshot de configuracion</p>
                {selected.configurationSnapshot.source ? (
                  <p className="mt-1 text-body-md text-slate-700">
                    source: {selected.configurationSnapshot.source} · id: {selected.configurationSnapshot.recordId ?? "-"} · version:{" "}
                    {selected.configurationSnapshot.version ?? "-"} · hash: {selected.configurationSnapshot.hash ? `${selected.configurationSnapshot.hash.slice(0, 12)}…` : "-"}
                  </p>
                ) : (
                  <p className="mt-1 text-body-md text-slate-700">{MISSING_CONFIGURATION_BADGE_LABEL}</p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-label-bold uppercase text-slate-500">Oportunidad</p>
                {selected.opportunity ? (
                  <p className="mt-1 text-body-md text-slate-700">
                    {selected.opportunity.key ?? selected.opportunity.id} · status: {selected.opportunity.status ?? "-"} · stage: {selected.opportunity.stage ?? "-"}
                  </p>
                ) : (
                  <p className="mt-1 text-body-md text-slate-700">Sin oportunidad asociada</p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-label-bold uppercase text-slate-500">Conversacion</p>
                {selected.conversation ? (
                  <p className="mt-1 text-body-md text-slate-700">
                    #{selected.conversation.id} · status: {selected.conversation.status ?? "-"} · dueño humano:{" "}
                    {selected.conversation.humanOwnerActive ? "si" : "no"} · IA habilitada: {selected.conversation.aiEnabled ? "si" : "no"}
                  </p>
                ) : (
                  <p className="mt-1 text-body-md text-slate-700">Sin conversacion asociada</p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-label-bold uppercase text-slate-500">Opt-out</p>
                <p className="mt-1 text-body-md text-slate-700">
                  {selected.optOut === null ? "No disponible" : selected.optOut.optedOut ? "Cliente dado de baja" : "Cliente no dado de baja"}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-label-bold uppercase text-slate-500">Correlacion con outbox (best-effort)</p>
                {selected.outboxCorrelation.kind === "correlated" ? (
                  <p className="mt-1 text-body-md text-slate-700">
                    Mensaje correlacionado #{selected.outboxCorrelation.outboxMessageId} · status: {selected.outboxCorrelation.status ?? "-"} · enviado:{" "}
                    {selected.outboxCorrelation.sentAt ? formatDateTime(selected.outboxCorrelation.sentAt) : "-"}
                  </p>
                ) : selected.outboxCorrelation.kind === "ambiguous" ? (
                  <p className="mt-1 text-body-md text-slate-700">Correlacion ambigua ({selected.outboxCorrelation.candidateCount} candidatos) - no implica error.</p>
                ) : (
                  <p className="mt-1 text-body-md text-slate-700">Sin mensaje correlacionado - no implica error.</p>
                )}
              </div>
            </div>

            <ErrorState title="Historial tecnico" message={selected.technicalHistoryMessage} />
          </div>
        )}
      </SectionCard>
    </div>
  );
}
