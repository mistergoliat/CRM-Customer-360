"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = AgentsPage;
const PageHeader_1 = require("@/components/ui/PageHeader");
const ModulePreview_1 = require("@/components/ui/ModulePreview");
function AgentsPage() {
    return (<>
      <PageHeader_1.PageHeader eyebrow="Orchestration" title="Agents" description="Preview de agentes y orquestación IA." status="Preview"/>
      <ModulePreview_1.ModulePreview title="Agents" icon="smart_toy" description="Orquestación de agentes IA, RAG y automatizaciones nuevas quedan fuera de fase 1. El foco actual es operación humana resiliente." planned={["Inventario de agentes", "Guardrails operacionales", "Rutas de escalamiento", "Observabilidad de decisiones"]}/>
    </>);
}
