"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = KnowledgePage;
const PageHeader_1 = require("@/components/ui/PageHeader");
const ModulePreview_1 = require("@/components/ui/ModulePreview");
function KnowledgePage() {
    return (<>
      <PageHeader_1.PageHeader eyebrow="Knowledge" title="Knowledge" description="Preview de conocimiento interno y Obsidian sync." status="Preview"/>
      <ModulePreview_1.ModulePreview title="Knowledge" icon="database" description="Este módulo conectará documentación operacional, base de conocimiento y sincronización Obsidian en una fase futura. No conectado todavía." planned={["Inventario de documentos", "Obsidian sync", "Versionado de conocimiento", "Preparación para RAG futuro"]}/>
    </>);
}
