import type { MetricCard, KeyValueField, TableRow } from "../types";

export type KnowledgeRow = TableRow & {
  category: string;
  status: string;
  owner: string;
  freshness: string;
  confidence: string;
  usage: string;
  gaps: string;
};

export type KnowledgeArticle = {
  title: string;
  summary: string;
  metadata: KeyValueField[];
  related: string[];
  body: string[];
};

export const knowledgeFixture = {
  metrics: [
    { key: "docs", title: "Artículos", value: "148", description: "Activos", icon: "book_5", tone: "blue" },
    { key: "fresh", title: "Vigencia media", value: "12d", description: "Freshness", icon: "update", tone: "green" },
    { key: "gaps", title: "Gaps detectados", value: "17", description: "Pendientes", icon: "gap", tone: "amber" },
    { key: "confidence", title: "Confianza", value: "91%", description: "Base útil", icon: "verified", tone: "green" }
  ] satisfies MetricCard[],
  rows: [
    { id: "kb-1", category: "Ventas", title: "Proceso de cotización", status: "Activo", owner: "Sales Ops", freshness: "2d", confidence: "Alta", usage: "Alta", gaps: "2", href: "/knowledge?article=kb-1" },
    { id: "kb-2", category: "Postventa", title: "Flujo de garantías", status: "Revisión", owner: "Ops", freshness: "8d", confidence: "Media", usage: "Media", gaps: "4", href: "/knowledge?article=kb-2" },
    { id: "kb-3", category: "CRM", title: "Identidad provisional", status: "Activo", owner: "Data", freshness: "1d", confidence: "Alta", usage: "Alta", gaps: "1", href: "/knowledge?article=kb-3" }
  ] satisfies KnowledgeRow[],
  selected: {
    title: "Proceso de cotización",
    summary: "Guía para convertir una intención comercial en cotización aprobada.",
    metadata: [
      { label: "Estado", value: "Activo", tone: "green" },
      { label: "Vigencia", value: "2 días", tone: "blue" },
      { label: "Propietario", value: "Sales Ops", tone: "gray" },
      { label: "Confianza", value: "Alta", tone: "green" }
    ],
    related: ["Flujo de descuentos", "Manejo de objeciones", "Plantillas de respuesta"],
    body: [
      "La cotización debe partir de un requerimiento validado.",
      "El descuento especial requiere aprobación humana.",
      "No prometer stock ni despacho sin confirmación del sistema fuente."
    ]
  } satisfies KnowledgeArticle
} as const;

export const analyticsFixture = {
  metrics: [
    { key: "revenue", title: "Ingresos influenciados", value: "CLP $214.2M", description: "Últimos 90 días", icon: "trending_up", tone: "green" },
    { key: "won", title: "Ingresos ganados", value: "CLP $143.8M", description: "Cerrados", icon: "paid", tone: "green" },
    { key: "cases", title: "Casos resueltos", value: "1,284", description: "Servicio", icon: "assignment_turned_in", tone: "blue" },
    { key: "cost", title: "Costo IA", value: "CLP $4.8M", description: "Estimado", icon: "auto_awesome", tone: "amber" }
  ] satisfies MetricCard[],
  tabs: ["Resumen", "Comercial", "Servicio", "Marketing", "IA", "Calidad de datos"],
  scorecards: [
    { label: "Horas ahorradas", value: "1,242" },
    { label: "Ahorro estimado", value: "CLP $11.3M" },
    { label: "ROI", value: "4.7x" },
    { label: "Frescura de datos", value: "91%" }
  ] satisfies KeyValueField[],
  sections: [
    { label: "Comercial", value: "Pipeline, conversión, etapas y seguimiento" },
    { label: "Servicio", value: "Casos, SLA, tiempo de resolución" },
    { label: "Marketing", value: "Campañas, segmentos, conversiones" },
    { label: "IA", value: "Cobertura de copilots y costos" },
    { label: "Calidad de datos", value: "Identidad, cobertura, gaps" }
  ] satisfies KeyValueField[]
};
