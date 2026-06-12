import { PageHeader } from "@/components/ui/PageHeader";
import { ModulePreview } from "@/components/ui/ModulePreview";

export default function AgentsPage() {
  return (
    <>
      <PageHeader eyebrow="Orchestration" title="Agents" description="Preview de agentes y orquestación IA." status="Preview" />
      <ModulePreview
        title="Agents"
        icon="smart_toy"
        description="Orquestación de agentes IA, RAG y automatizaciones nuevas quedan fuera de fase 1. El foco actual es operación humana resiliente."
        planned={["Inventario de agentes", "Guardrails operacionales", "Rutas de escalamiento", "Observabilidad de decisiones"]}
      />
    </>
  );
}
