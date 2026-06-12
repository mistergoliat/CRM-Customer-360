import { PageHeader } from "@/components/ui/PageHeader";
import { ModulePreview } from "@/components/ui/ModulePreview";

export default function AnalyticsPage() {
  return (
    <>
      <PageHeader eyebrow="Analytics" title="Analytics avanzado" description="Preview de analítica comercial y operacional futura." status="Preview" />
      <ModulePreview
        title="Analytics avanzado"
        icon="monitoring"
        description="Revenue analytics, atribución comercial y segmentación avanzada quedan visibles como dirección de producto, sin backend real en esta fase."
        planned={["Revenue analytics", "Atribución comercial", "Cohortes y retención", "Embudo operacional-comercial"]}
      />
    </>
  );
}
