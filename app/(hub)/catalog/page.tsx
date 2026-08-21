import { CatalogConsole } from "@/components/catalog/CatalogConsole";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { PageHeader } from "@/components/ui/PageHeader";

export default function CatalogPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inteligencia"
        title="Catalogo"
        description="Consola read-only para inspeccionar productos, precio, stock, disponibilidad y recomendaciones comerciales desde Catalog Service."
        actions={<SurfaceBadge kind="readOnly" />}
      />
      <CatalogConsole />
    </div>
  );
}
