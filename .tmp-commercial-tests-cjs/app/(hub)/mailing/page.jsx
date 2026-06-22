"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = MailingPage;
const PageHeader_1 = require("@/components/ui/PageHeader");
const ModulePreview_1 = require("@/components/ui/ModulePreview");
function MailingPage() {
    return (<>
      <PageHeader_1.PageHeader eyebrow="Lifecycle" title="Mailing" description="Preview de campañas y comunicación comercial." status="Preview"/>
      <ModulePreview_1.ModulePreview title="Mailing" icon="mail_lock" description="Mailing avanzado, automatizaciones comerciales y campañas quedan planificados para fases posteriores. No hay backend real en fase 1." planned={["Listas y consentimientos", "Campañas segmentadas", "Templates comerciales", "Métricas de entregabilidad"]}/>
    </>);
}
