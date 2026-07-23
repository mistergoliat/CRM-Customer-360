import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorState } from "@/components/ui/ErrorState";
import { isDbWriteEnabled } from "@/lib/write-access";
import { sanitizeDbError } from "@/lib/db";
import { buildAllowedSalesAgentModelValues, listPesasChileConfigurations, resolveSalesAgentConfiguration } from "@/lib/brain/commercial/sales-agent-configuration";
import { describeConfigurationSource } from "@/lib/domains/sales-agent-config/form";
import { SalesAgentConfigurationWorkspace } from "@/components/agents/SalesAgentConfigurationWorkspace";

const INFRASTRUCTURE_ERROR_MESSAGE = "No se pudo cargar la configuracion del Sales Agent. Intenta de nuevo en unos minutos.";

type PageProps = {
  searchParams: Promise<{ draft?: string }>;
};

export default async function SalesAgentConfigurationPage({ searchParams }: PageProps) {
  const { draft: draftIdParam } = await searchParams;

  // resolveSalesAgentConfiguration()/listPesasChileConfigurations() deliberately
  // throw on a real DB failure (never mistaken for "nothing published") - this
  // is the page's own "error de infraestructura" state, not a silent crash.
  let effective: Awaited<ReturnType<typeof resolveSalesAgentConfiguration>>;
  let versions: Awaited<ReturnType<typeof listPesasChileConfigurations>>;
  try {
    [effective, versions] = await Promise.all([resolveSalesAgentConfiguration(), listPesasChileConfigurations({ limit: 100 })]);
  } catch (error) {
    // Internal-only detail (still credential-redacted) - the operator never
    // sees SQL, table names, host/port, or a raw repository error message.
    console.error("sales_agent_configuration_page_error", sanitizeDbError(error));
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Agentes" title="Configura al agente" description="Identidad, modelo y ejecucion del Sales Agent de PesasChile." />
        <ErrorState title="Configuracion no disponible" message={INFRASTRUCTURE_ERROR_MESSAGE} />
      </div>
    );
  }

  const drafts = versions.filter((version) => version.status === "draft");
  const requestedDraftId = draftIdParam ? Number(draftIdParam) : null;
  const selectedDraft = (requestedDraftId ? (drafts.find((draft) => draft.id === requestedDraftId) ?? null) : null) ?? drafts[0] ?? null;

  const source = describeConfigurationSource(effective.source);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agentes"
        title="Configura al agente"
        description="Identidad, modelo y ejecucion del Sales Agent de PesasChile."
        status={source.label}
      />
      <SalesAgentConfigurationWorkspace
        key={selectedDraft?.id ?? "no-draft"}
        effective={effective}
        versions={versions}
        selectedDraft={selectedDraft}
        allowedModels={buildAllowedSalesAgentModelValues()}
        writeEnabled={isDbWriteEnabled()}
      />
    </div>
  );
}
