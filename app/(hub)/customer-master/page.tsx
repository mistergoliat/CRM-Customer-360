import { PageHeader } from "@/components/ui/PageHeader";
import { ModulePreview } from "@/components/ui/ModulePreview";

export default function CustomerMasterPage() {
  return (
    <>
      <PageHeader eyebrow="Identity" title="Customer Master" description="Preview de identidad cliente unificada." status="Preview" />
      <ModulePreview
        title="Customer Master"
        icon="badge"
        description="Este módulo consolidará identidad cliente entre WhatsApp, Prestashop, órdenes, casos, historial de compra y fuentes operacionales. No conectado todavía."
        planned={["Resolución de identidad", "Merge controlado", "Vista 360 por cliente", "Auditoría de cambios de identidad"]}
      />
    </>
  );
}
