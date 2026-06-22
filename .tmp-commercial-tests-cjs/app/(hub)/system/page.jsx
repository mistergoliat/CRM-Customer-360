"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SystemPage;
const system_1 = require("@/lib/system");
const PageHeader_1 = require("@/components/ui/PageHeader");
const HealthStatusCard_1 = require("@/components/ui/HealthStatusCard");
async function SystemPage() {
    const health = await (0, system_1.getSystemHealth)();
    return (<>
      <PageHeader_1.PageHeader eyebrow="System" title="Salud del sistema" description="Chequeos básicos para continuidad operacional. Meta se valida por configuración local; n8n es monitoreado sin ser dependencia crítica." status="Activo"/>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {health.items.map((item) => (<HealthStatusCard_1.HealthStatusCard key={item.key} title={item.title} status={item.status} description={item.description} details={item.details}/>))}
      </div>
      <p className="mt-4 text-label-sm text-slate-500">Generado: {health.generatedAt}</p>
    </>);
}
