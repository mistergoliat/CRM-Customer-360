"use client";

import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { SectionCard } from "@/components/p1m/SectionCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { MarketingCopilotWorkspace } from "@/components/marketing/MarketingCopilotWorkspace";
import {
  EMPTY_CUSTOMER_INTELLIGENCE_FILTER_SELECTION,
  buildCustomerIntelligenceFilterTree,
  type CustomerIntelligenceFilterSelection,
  type DashboardClustersResult,
  type DashboardContext,
  type DashboardContextResult,
  type DashboardIntersectionResult,
  type DashboardOverviewResult,
  type DashboardRfmResult
} from "@/lib/marketing/customerIntelligenceDashboard";
import type { AnalyticalFilterInput } from "@/lib/marketing/customerIntelligenceCopilot";

void React;

type CustomerIntelligenceDashboardWorkspaceProps = {
  copilotData: {
    quickReplies?: string[];
  };
};

type LoadState<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: T }
  | { readonly status: "error"; readonly message: string };

type CommercialFilterKey = keyof CustomerIntelligenceFilterSelection["commercial"];

export function CustomerIntelligenceDashboardWorkspace({ copilotData }: CustomerIntelligenceDashboardWorkspaceProps) {
  const [context, setContext] = useState<LoadState<DashboardContextResult>>({ status: "loading" });
  const [overview, setOverview] = useState<LoadState<DashboardOverviewResult>>({ status: "loading" });
  const [rfm, setRfm] = useState<LoadState<DashboardRfmResult>>({ status: "loading" });
  const [clusters, setClusters] = useState<LoadState<DashboardClustersResult>>({ status: "loading" });
  const [selection, setSelection] = useState<CustomerIntelligenceFilterSelection>(EMPTY_CUSTOMER_INTELLIGENCE_FILTER_SELECTION);
  const filters = useMemo(() => buildCustomerIntelligenceFilterTree(selection), [selection]);
  const [intersection, setIntersection] = useState<LoadState<DashboardIntersectionResult> | { readonly status: "empty" }>({ status: "empty" });

  useEffect(() => {
    void loadDashboardEndpoint("/api/marketing/customer-intelligence/dashboard/context", setContext);
    void loadDashboardEndpoint("/api/marketing/customer-intelligence/dashboard/overview", setOverview);
    void loadDashboardEndpoint("/api/marketing/customer-intelligence/dashboard/rfm", setRfm);
    void loadDashboardEndpoint("/api/marketing/customer-intelligence/dashboard/clusters", setClusters);
  }, []);

  useEffect(() => {
    if (!filters) {
      setIntersection({ status: "empty" });
      return;
    }

    let cancelled = false;
    setIntersection({ status: "loading" });
    postDashboardIntersection(filters)
      .then((data) => {
        if (!cancelled) setIntersection({ status: "ready", data });
      })
      .catch((error) => {
        if (!cancelled) setIntersection({ status: "error", message: userSafeError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const activeContext = context.status === "ready" && context.data.status === "available" ? context.data : null;

  function toggleRfmSegment(segmentCode: string | null) {
    if (!segmentCode) return;
    setSelection((current) => ({ ...current, rfmSegmentCode: current.rfmSegmentCode === segmentCode ? null : segmentCode }));
  }

  function toggleCluster(clusterId: number) {
    setSelection((current) => ({ ...current, clusterId: current.clusterId === clusterId ? null : clusterId }));
  }

  function updateCommercial(key: CommercialFilterKey, value: string) {
    setSelection((current) => ({ ...current, commercial: { ...current.commercial, [key]: value } }));
  }

  function clearSelection() {
    setSelection(EMPTY_CUSTOMER_INTELLIGENCE_FILTER_SELECTION);
  }

  return (
    <div className="space-y-5">
      <ContextStrip state={context} />

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_390px]">
        <main className="space-y-5">
          <OverviewSection state={overview} />
          <RfmSection state={rfm} selectedSegmentCode={selection.rfmSegmentCode} onSelect={toggleRfmSegment} />
          <ClustersSection state={clusters} selectedClusterId={selection.clusterId} onSelect={toggleCluster} />
        </main>

        <aside className="space-y-5 2xl:sticky 2xl:top-4 2xl:self-start">
          <CommercialFilters selection={selection} onChange={updateCommercial} onClear={clearSelection} />
          <SelectedPopulationPanel filters={filters} intersection={intersection} context={activeContext?.context ?? null} />
        </aside>
      </div>

      <MarketingCopilotWorkspace data={copilotData} uiContextFilters={filters} scopeLabel={filters ? "Selected population activa" : undefined} />
    </div>
  );
}

function ContextStrip({ state }: { state: LoadState<DashboardContextResult> }) {
  if (state.status === "loading") return <InlineState label="Cargando contexto analitico..." />;
  if (state.status === "error") return <InlineState label={state.message} tone="red" />;
  if (state.data.status !== "available") return <InlineState label={dashboardStatusMessage(state.data)} tone={state.data.status === "degraded" ? "amber" : "red"} />;

  const { context, population } = state.data;
  return (
    <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-label-bold uppercase text-primary">Snapshot activo</p>
          <p className="mt-1 text-body-md text-slate-600">
            Feature #{context.featureSnapshotId} · {formatDateTime(context.featureReferenceTime)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusChip label={`RFM ${formatPercent(population.rfmCoveragePct)}`} tone="blue" />
          <StatusChip label={`Cluster ${formatPercent(population.clusterCoveragePct)}`} tone="green" />
          <StatusChip label={`${formatInteger(population.featurePopulation)} clientes`} tone="slate" />
        </div>
      </div>
    </section>
  );
}

function OverviewSection({ state }: { state: LoadState<DashboardOverviewResult> }) {
  return (
    <SectionCard title="Overview" eyebrow="Customer Intelligence" description="KPIs recibidos desde Customer Profile para la poblacion feature completa.">
      {state.status === "loading" ? <PanelState message="Cargando overview..." /> : null}
      {state.status === "error" ? <PanelState message={state.message} tone="red" /> : null}
      {state.status === "ready" && state.data.status !== "available" ? <PanelState message={dashboardStatusMessage(state.data)} tone={state.data.status === "degraded" ? "amber" : "red"} /> : null}
      {state.status === "ready" && state.data.status === "available" ? (
        <InfoGrid
          columns={4}
          items={[
            { label: "Total customers", value: formatInteger(state.data.population.featurePopulation) },
            { label: "With RFM", value: formatInteger(state.data.population.rfmMatched) },
            { label: "RFM coverage", value: formatPercent(state.data.population.rfmCoveragePct) },
            { label: "With cluster", value: formatInteger(state.data.population.clusterMatched) },
            { label: "Cluster coverage", value: formatPercent(state.data.population.clusterCoveragePct) },
            { label: "With both", value: formatInteger(state.data.population.bothMatched) },
            { label: "Total spend", value: formatMoney(state.data.commercial.totalSpentTaxIncl) },
            { label: "AOV", value: formatMoneyNullable(state.data.commercial.averageOrderValueTaxIncl) },
            { label: "Avg valid orders", value: formatDecimal(state.data.commercial.averageValidOrders) },
            { label: "Avg recency", value: `${formatDecimal(state.data.commercial.averageDaysSinceLastOrder)} dias` },
            { label: "Orders 365d", value: formatDecimal(state.data.commercial.averageOrders365d) },
            { label: "Purchase freq sample", value: formatInteger(state.data.commercial.purchaseFrequencyDaysSampleSize) }
          ]}
        />
      ) : null}
    </SectionCard>
  );
}

function RfmSection({ state, selectedSegmentCode, onSelect }: { state: LoadState<DashboardRfmResult>; selectedSegmentCode: string | null; onSelect(segmentCode: string | null): void }) {
  return (
    <SectionCard title="RFM" eyebrow="Segmentos" description="Distribucion y metricas calculadas por el backend sobre la poblacion RFM analizada.">
      {state.status === "loading" ? <PanelState message="Cargando RFM..." /> : null}
      {state.status === "error" ? <PanelState message={state.message} tone="red" /> : null}
      {state.status === "ready" && state.data.status !== "available" ? <PanelState message={dashboardStatusMessage(state.data)} tone={state.data.status === "degraded" ? "amber" : "red"} /> : null}
      {state.status === "ready" && state.data.status === "available" ? (
        <div className="space-y-4">
          <InfoGrid
            columns={3}
            items={[
              { label: "Analyzed population", value: formatInteger(state.data.analyzedPopulation) },
              { label: "Full feature population", value: formatInteger(state.data.fullFeaturePopulation) },
              { label: "Coverage", value: formatPercent(state.data.coveragePct) }
            ]}
          />
          <div className="grid gap-3 xl:grid-cols-2">
            {state.data.segments.map((segment) => {
              const active = selectedSegmentCode !== null && selectedSegmentCode === segment.segmentCode;
              return (
                <button
                  key={segment.segmentCode ?? "UNSEGMENTED"}
                  type="button"
                  disabled={segment.segmentCode === null}
                  onClick={() => onSelect(segment.segmentCode)}
                  className={clsx(
                    "rounded-lg border p-4 text-left transition",
                    active ? "border-sky-400 bg-sky-50 ring-2 ring-sky-100" : "border-slate-200 bg-white hover:border-slate-300",
                    segment.segmentCode === null && "cursor-not-allowed opacity-75"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-label-bold uppercase text-slate-500">{segment.segmentCode ?? "Sin codigo"}</p>
                      <h3 className="mt-1 text-body-lg font-semibold text-on-surface">{segment.businessLabel}</h3>
                    </div>
                    <StatusChip label={formatInteger(segment.customerCount)} tone={active ? "blue" : "gray"} />
                  </div>
                  <Bar value={segment.percentageOfRfmPopulation} label={`${formatPercent(segment.percentageOfRfmPopulation)} de RFM`} />
                  <InfoGrid
                    columns={4}
                    items={[
                      { label: "Feature share", value: formatPercent(segment.percentageOfFeaturePopulation) },
                      { label: "Avg R/F/M", value: `${formatDecimal(segment.averageRScore)} / ${formatDecimal(segment.averageFScore)} / ${formatDecimal(segment.averageMScore)}` },
                      { label: "Avg ticket", value: formatMoneyNullable(segment.averageOrderValueTaxIncl) },
                      { label: "Avg spend", value: formatMoney(segment.averageTotalSpentTaxIncl) },
                      { label: "Avg orders", value: formatDecimal(segment.averageValidOrders) },
                      { label: "Avg recency", value: `${formatDecimal(segment.averageDaysSinceLastOrder)} dias` }
                    ]}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}

function ClustersSection({ state, selectedClusterId, onSelect }: { state: LoadState<DashboardClustersResult>; selectedClusterId: number | null; onSelect(clusterId: number): void }) {
  return (
    <SectionCard title="Clusters" eyebrow="Comportamiento" description="Clusters, cobertura y cross-section RFM entregados por Customer Profile.">
      {state.status === "loading" ? <PanelState message="Cargando clusters..." /> : null}
      {state.status === "error" ? <PanelState message={state.message} tone="red" /> : null}
      {state.status === "ready" && state.data.status !== "available" ? <PanelState message={dashboardStatusMessage(state.data)} tone={state.data.status === "degraded" ? "amber" : "red"} /> : null}
      {state.status === "ready" && state.data.status === "available" ? (
        <div className="space-y-4">
          <InfoGrid
            columns={4}
            items={[
              { label: "Analyzed population", value: formatInteger(state.data.analyzedPopulation) },
              { label: "Full feature population", value: formatInteger(state.data.fullFeaturePopulation) },
              { label: "Coverage", value: formatPercent(state.data.coveragePct) },
              { label: "RFM cross-section", value: state.data.rfmCrossSectionAvailable ? "Disponible" : "No disponible" }
            ]}
          />
          <div className="grid gap-3 xl:grid-cols-2">
            {state.data.clusters.map((cluster) => {
              const active = selectedClusterId === cluster.clusterId;
              return (
                <button
                  key={cluster.clusterId}
                  type="button"
                  onClick={() => onSelect(cluster.clusterId)}
                  className={clsx("rounded-lg border p-4 text-left transition", active ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-100" : "border-slate-200 bg-white hover:border-slate-300")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-label-bold uppercase text-slate-500">Cluster {cluster.clusterId}</p>
                      <h3 className="mt-1 text-body-lg font-semibold text-on-surface">{cluster.businessLabel ?? `Cluster ${cluster.clusterId}`}</h3>
                    </div>
                    <StatusChip label={formatInteger(cluster.customerCount)} tone={active ? "green" : "gray"} />
                  </div>
                  <Bar value={cluster.percentageOfClusterPopulation} label={`${formatPercent(cluster.percentageOfClusterPopulation)} de clusters`} />
                  <InfoGrid
                    columns={4}
                    items={[
                      { label: "Feature share", value: formatPercent(cluster.percentageOfFeaturePopulation) },
                      { label: "Avg ticket", value: formatMoneyNullable(cluster.averageOrderValueTaxIncl) },
                      { label: "Avg spend", value: formatMoney(cluster.averageTotalSpentTaxIncl) },
                      { label: "Avg orders", value: formatDecimal(cluster.averageValidOrders) },
                      { label: "Avg recency", value: `${formatDecimal(cluster.averageDaysSinceLastOrder)} dias` },
                      { label: "Diversity", value: formatDecimal(cluster.averageEffectiveDiversity) },
                      { label: "Repeat rate", value: formatPercentFromRatio(cluster.averageRepeatProductRate) },
                      { label: "Orders 365d", value: formatDecimal(cluster.averageOrders365d) }
                    ]}
                  />
                  {cluster.rfmCrossSection ? (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-label-bold uppercase text-slate-500">RFM cross-section · cobertura {formatPercent(cluster.rfmCrossSection.coveragePct)}</p>
                      <div className="mt-2 space-y-2">
                        {cluster.rfmCrossSection.segments.map((segment) => (
                          <Bar
                            key={`${segment.segmentCode ?? "UNSEGMENTED"}-${cluster.clusterId}`}
                            value={segment.percentageOfComparablePopulation}
                            label={`${segment.businessLabel}: ${formatInteger(segment.customerCount)} (${formatPercent(segment.percentageOfComparablePopulation)})`}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}

function CommercialFilters({
  selection,
  onChange,
  onClear
}: {
  selection: CustomerIntelligenceFilterSelection;
  onChange(key: CommercialFilterKey, value: string): void;
  onClear(): void;
}) {
  const fields: { readonly key: CommercialFilterKey; readonly label: string; readonly placeholder: string }[] = [
    { key: "daysSinceLastOrderGte", label: "Recency min", placeholder: "dias >=" },
    { key: "daysSinceLastOrderLte", label: "Recency max", placeholder: "dias <=" },
    { key: "totalSpentGte", label: "Spend min", placeholder: "$ >=" },
    { key: "totalSpentLte", label: "Spend max", placeholder: "$ <=" },
    { key: "averageOrderValueGte", label: "AOV min", placeholder: "$ >=" },
    { key: "averageOrderValueLte", label: "AOV max", placeholder: "$ <=" },
    { key: "validOrdersGte", label: "Orders min", placeholder: "ordenes >=" },
    { key: "validOrdersLte", label: "Orders max", placeholder: "ordenes <=" }
  ];

  return (
    <SectionCard title="Filtros" eyebrow="Selected population" actions={<button type="button" className="hub-button-secondary" onClick={onClear}>Limpiar</button>}>
      <div className="space-y-4">
        <InfoGrid
          columns={2}
          items={[
            { label: "RFM", value: selection.rfmSegmentCode ?? "Sin seleccionar" },
            { label: "Cluster", value: selection.clusterId === null ? "Sin seleccionar" : `Cluster ${selection.clusterId}` }
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <label key={field.key} className="block">
              <span className="text-label-bold uppercase text-slate-500">{field.label}</span>
              <input
                type="number"
                value={selection.commercial[field.key]}
                onChange={(event) => onChange(field.key, event.target.value)}
                placeholder={field.placeholder}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-body-md text-on-surface outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
              />
            </label>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

function SelectedPopulationPanel({
  filters,
  intersection,
  context
}: {
  filters: AnalyticalFilterInput | null;
  intersection: LoadState<DashboardIntersectionResult> | { readonly status: "empty" };
  context: DashboardContext | null;
}) {
  return (
    <SectionCard title="Selected population" eyebrow="Interseccion">
      {!filters ? <PanelState message="Selecciona un segmento, cluster o rango comercial para activar una poblacion." /> : null}
      {filters ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
            <pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(filters, null, 2)}</pre>
          </div>
          {intersection.status === "loading" ? <PanelState message="Calculando interseccion..." /> : null}
          {intersection.status === "error" ? <PanelState message={intersection.message} tone="red" /> : null}
          {intersection.status === "ready" && intersection.data.status !== "available" ? <PanelState message={intersectionStatusMessage(intersection.data)} tone={intersection.data.status === "degraded" ? "amber" : "red"} /> : null}
          {intersection.status === "ready" && intersection.data.status === "available" ? <IntersectionDetails data={intersection.data} /> : null}
        </div>
      ) : context ? (
        <p className="mt-3 text-label-sm text-slate-500">Feature snapshot #{context.featureSnapshotId}</p>
      ) : null}
    </SectionCard>
  );
}

function IntersectionDetails({ data }: { data: Extract<DashboardIntersectionResult, { status: "available" }> }) {
  return (
    <div className="space-y-4">
      <InfoGrid
        columns={2}
        items={[
          { label: "Matching population", value: formatInteger(data.intersection.matchingPopulation) },
          { label: "Feature population", value: formatInteger(data.intersection.featurePopulation) },
          { label: "Required dimensions", value: data.intersection.requiredDimensions.join(", ") || "Solo commercial" },
          { label: "Query count", value: data.execution.queryCount },
          { label: "RFM coverage", value: formatPercent(data.intersection.rfmCoveragePct) },
          { label: "Cluster coverage", value: formatPercent(data.intersection.clusterCoveragePct) }
        ]}
      />
      <InfoGrid
        columns={2}
        items={[
          { label: "Total spend", value: formatMoney(data.metrics.totalSpentTaxIncl) },
          { label: "AOV", value: formatMoneyNullable(data.metrics.averageOrderValueTaxIncl) },
          { label: "Avg spend", value: formatMoneyNullable(data.metrics.averageTotalSpentTaxIncl) },
          { label: "Avg orders", value: formatNullableDecimal(data.metrics.averageValidOrders) },
          { label: "Avg recency", value: nullableWithUnit(data.metrics.averageDaysSinceLastOrder, "dias") },
          { label: "Repeat rate", value: nullableRatioPercent(data.metrics.averageRepeatProductRate) }
        ]}
      />
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-label-sm text-slate-600">
        <p className="font-bold uppercase text-slate-500">Snapshot / provenance</p>
        <p className="mt-1 break-words">Feature #{data.context.featureSnapshotId} · hash {data.analyticalDefinition.queryPlanHash}</p>
        <p className="mt-1">Leaves {data.execution.filterLeafCount} · depth {data.execution.filterDepth}</p>
      </div>
    </div>
  );
}

function Bar({ value, label }: { value: number; label: string }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between gap-3 text-label-sm text-slate-600">
        <span>{label}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-sky-500" style={{ width: percentWidth(value) }} />
      </div>
    </div>
  );
}

function PanelState({ message, tone = "amber" }: { message: string; tone?: "amber" | "red" }) {
  return (
    <div className={clsx("rounded-lg border p-4 text-body-md", tone === "red" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800")}>
      {message}
    </div>
  );
}

function InlineState({ label, tone = "amber" }: { label: string; tone?: "amber" | "red" }) {
  return (
    <div className={clsx("rounded-lg border px-4 py-3 text-body-md", tone === "red" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800")}>
      {label}
    </div>
  );
}

async function loadDashboardEndpoint<T>(url: string, setState: (state: LoadState<T>) => void) {
  try {
    setState({ status: "ready", data: await fetchDashboardJson<T>(url) });
  } catch (error) {
    setState({ status: "error", message: userSafeError(error) });
  }
}

async function postDashboardIntersection(filters: AnalyticalFilterInput): Promise<DashboardIntersectionResult> {
  return fetchDashboardJson<DashboardIntersectionResult>("/api/marketing/customer-intelligence/dashboard/intersections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filters })
  });
}

async function fetchDashboardJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as T | { readonly message?: string; readonly status?: string; readonly errors?: readonly string[] } | null;
  if (!response.ok && !hasBackendStatus(payload)) {
    throw new Error(hasMessage(payload) ? payload.message : "Customer Intelligence no disponible.");
  }
  return payload as T;
}

function hasBackendStatus(payload: unknown): payload is { readonly status: string } {
  return typeof payload === "object" && payload !== null && "status" in payload && typeof payload.status === "string";
}

function hasMessage(payload: unknown): payload is { readonly message: string } {
  return typeof payload === "object" && payload !== null && "message" in payload && typeof payload.message === "string";
}

function dashboardStatusMessage(result: { readonly status: string; readonly reason?: string; readonly featureSnapshotId?: string }): string {
  switch (result.status) {
    case "no_published_feature_snapshot":
      return "No hay un feature snapshot publicado para mostrar.";
    case "feature_snapshot_not_found":
      return `Feature snapshot ${result.featureSnapshotId ?? ""} no encontrado.`;
    case "no_compatible_rfm_snapshot":
      return "No hay snapshot RFM compatible para este feature snapshot.";
    case "no_compatible_cluster_snapshot":
      return "No hay snapshot de clusters compatible para este feature snapshot.";
    case "degraded":
      return result.reason === "dashboard_not_configured" ? "Dashboard no configurado." : "Analitica no disponible.";
    default:
      return "Estado no disponible.";
  }
}

function intersectionStatusMessage(result: Exclude<DashboardIntersectionResult, { status: "available" }>): string {
  if (result.status === "invalid_intersection") return result.errors?.join(" - ") || "Los filtros no pasaron la validacion del backend.";
  if (result.status === "required_rfm_snapshot_unavailable") return "La seleccion requiere RFM, pero no hay snapshot RFM compatible.";
  if (result.status === "required_cluster_snapshot_unavailable") return "La seleccion requiere cluster, pero no hay snapshot compatible.";
  return dashboardStatusMessage(result);
}

function userSafeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "Customer Intelligence no disponible.";
}

function formatInteger(value: number): string {
  return value.toLocaleString("es-CL");
}

function formatDecimal(value: string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("es-CL", { maximumFractionDigits: 2 }) : value;
}

function formatNullableDecimal(value: string | null): string {
  return value === null ? "No reportado" : formatDecimal(value);
}

function formatMoney(value: string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }) : value;
}

function formatMoneyNullable(value: string | null): string {
  return value === null ? "No reportado" : formatMoney(value);
}

function formatPercent(value: number): string {
  return `${value.toLocaleString("es-CL", { maximumFractionDigits: 2 })}%`;
}

function formatPercentFromRatio(value: string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? formatPercent(numeric * 100) : value;
}

function nullableRatioPercent(value: string | null): string {
  return value === null ? "No reportado" : formatPercentFromRatio(value);
}

function nullableWithUnit(value: string | null, unit: string): string {
  return value === null ? "No reportado" : `${formatDecimal(value)} ${unit}`;
}

function percentWidth(value: number): string {
  const finite = Number.isFinite(value) ? value : 0;
  return `${Math.min(100, Math.max(0, finite))}%`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
