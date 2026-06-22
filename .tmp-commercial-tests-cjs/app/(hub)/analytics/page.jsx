"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = AnalyticsPage;
const PageHeader_1 = require("@/components/ui/PageHeader");
const ModulePreview_1 = require("@/components/ui/ModulePreview");
function AnalyticsPage() {
    return (<>
      <PageHeader_1.PageHeader eyebrow="Analytics" title="Analytics avanzado" description="Preview de analítica comercial y operacional futura." status="Preview"/>
      <ModulePreview_1.ModulePreview title="Analytics avanzado" icon="monitoring" description="Revenue analytics, atribución comercial y segmentación avanzada quedan visibles como dirección de producto, sin backend real en esta fase." planned={["Revenue analytics", "Atribución comercial", "Cohortes y retención", "Embudo operacional-comercial"]}/>
    </>);
}
