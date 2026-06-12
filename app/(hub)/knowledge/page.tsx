import { PageHeader } from "@/components/ui/PageHeader";
import { ModulePreview } from "@/components/ui/ModulePreview";

export default function KnowledgePage() {
  return (
    <>
      <PageHeader eyebrow="Knowledge" title="Knowledge" description="Preview de conocimiento interno y Obsidian sync." status="Preview" />
      <ModulePreview
        title="Knowledge"
        icon="database"
        description="Este módulo conectará documentación operacional, base de conocimiento y sincronización Obsidian en una fase futura. No conectado todavía."
        planned={["Inventario de documentos", "Obsidian sync", "Versionado de conocimiento", "Preparación para RAG futuro"]}
      />
    </>
  );
}
