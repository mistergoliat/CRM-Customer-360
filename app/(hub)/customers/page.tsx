import { PageHeader } from "@/components/ui/PageHeader";
import { ModulePreview } from "@/components/ui/ModulePreview";

export default function CustomersPage() {
  return (
    <>
      <PageHeader eyebrow="CRM" title="Customers" description="Preview del módulo CRM y clusters de clientes." status="Preview" />
      <ModulePreview
        title="Customers"
        icon="groups"
        description="Este módulo consolidará segmentos comerciales, comportamiento de compra, señales de WhatsApp y estados operacionales. No conectado todavía."
        planned={["Clusters de clientes", "Historial comercial resumido", "Señales de recompra", "Filtros por fuente operacional"]}
      />
    </>
  );
}
