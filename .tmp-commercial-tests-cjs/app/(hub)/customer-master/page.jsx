"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = CustomerMasterPage;
const PageHeader_1 = require("@/components/ui/PageHeader");
const ModulePreview_1 = require("@/components/ui/ModulePreview");
function CustomerMasterPage() {
    return (<>
      <PageHeader_1.PageHeader eyebrow="Identity" title="Customer Master" description="Preview de identidad cliente unificada." status="Preview"/>
      <ModulePreview_1.ModulePreview title="Customer Master" icon="badge" description="Este módulo consolidará identidad cliente entre WhatsApp, Prestashop, órdenes, casos, historial de compra y fuentes operacionales. No conectado todavía." planned={["Resolución de identidad", "Merge controlado", "Vista 360 por cliente", "Auditoría de cambios de identidad"]}/>
    </>);
}
