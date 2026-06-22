"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = CustomersPage;
const PageHeader_1 = require("@/components/ui/PageHeader");
const ModulePreview_1 = require("@/components/ui/ModulePreview");
function CustomersPage() {
    return (<>
      <PageHeader_1.PageHeader eyebrow="CRM" title="Customers" description="Preview del módulo CRM y clusters de clientes." status="Preview"/>
      <ModulePreview_1.ModulePreview title="Customers" icon="groups" description="Este módulo consolidará segmentos comerciales, comportamiento de compra, señales de WhatsApp y estados operacionales. No conectado todavía." planned={["Clusters de clientes", "Historial comercial resumido", "Señales de recompra", "Filtros por fuente operacional"]}/>
    </>);
}
