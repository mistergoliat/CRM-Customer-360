import type { KeyValueField, MetricCard, TableRow } from "../types";

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
  breadcrumb: string[];
  version: string;
  status: string;
  source: string;
  owner: string;
  audience: string;
  confidence: string;
  gaps: string[];
  metadata: KeyValueField[];
  related: string[];
  sections: { title: string; body: string[] }[];
};

type AnalyticsSeriesPoint = { label: string; value: number };

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
    { id: "kb-3", category: "CRM", title: "Identidad provisional", status: "Activo", owner: "Data", freshness: "1d", confidence: "Alta", usage: "Alta", gaps: "1", href: "/knowledge?article=kb-3" },
    { id: "kb-4", category: "Marketing", title: "Plantillas consentidas", status: "Activo", owner: "Growth", freshness: "4d", confidence: "Alta", usage: "Media", gaps: "1", href: "/knowledge?article=kb-4" },
    { id: "kb-5", category: "Operación", title: "Matriz SLA", status: "Activo", owner: "Ops", freshness: "3d", confidence: "Alta", usage: "Alta", gaps: "0", href: "/knowledge?article=kb-5" },
    { id: "kb-6", category: "Integraciones", title: "Meta / WhatsApp", status: "Revisión", owner: "Platform", freshness: "6d", confidence: "Media", usage: "Alta", gaps: "3", href: "/knowledge?article=kb-6" },
    { id: "kb-7", category: "Comercial", title: "Gestión de objeciones", status: "Activo", owner: "Sales Ops", freshness: "2d", confidence: "Alta", usage: "Alta", gaps: "1", href: "/knowledge?article=kb-7" },
    { id: "kb-8", category: "Casos", title: "Escalamiento humano", status: "Activo", owner: "Support", freshness: "9d", confidence: "Media", usage: "Media", gaps: "2", href: "/knowledge?article=kb-8" }
  ] satisfies KnowledgeRow[],
  selected: {
    title: "Proceso de cotización",
    summary: "Guía para convertir una intención comercial en cotización aprobada.",
    breadcrumb: ["Biblioteca", "Comercial", "Proceso de cotización"],
    version: "v1.8",
    status: "Activo",
    source: "Docs operativos + revisión comercial",
    owner: "Sales Ops",
    audience: "Operadores y supervisores",
    confidence: "Alta",
    gaps: ["Falta un ejemplo de descuento especial", "Falta referencia de despacho express"],
    metadata: [
      { label: "Estado", value: "Activo", tone: "green" },
      { label: "Vigencia", value: "2 días", tone: "blue" },
      { label: "Propietario", value: "Sales Ops", tone: "gray" },
      { label: "Confianza", value: "Alta", tone: "green" },
      { label: "Fuente", value: "Docs operativos", tone: "blue" },
      { label: "Audiencia", value: "Operadores", tone: "gray" }
    ],
    related: ["Flujo de descuentos", "Manejo de objeciones", "Plantillas de respuesta", "Validación de stock"],
    sections: [
      {
        title: "Regla operativa",
        body: [
          "La cotización debe partir de un requerimiento validado.",
          "El descuento especial requiere aprobación humana.",
          "No prometer stock ni despacho sin confirmación del sistema fuente."
        ]
      },
      {
        title: "Checklist de salida",
        body: [
          "Confirmar identidad del cliente.",
          "Validar margen antes de preparar borrador.",
          "Verificar disponibilidad y SLA de despacho."
        ]
      },
      {
        title: "Señales de error",
        body: [
          "No usar datos ficticios como cotización real.",
          "No escribir sobre el mismo lead si ya existe oportunidad vinculada."
        ]
      }
    ]
  } satisfies KnowledgeArticle
} as const;

export const analyticsFixture = {
  metrics: [
    { key: "revenue", title: "Ingresos influenciados", value: "CLP $214.2M", description: "Últimos 90 días", icon: "trending_up", tone: "green" },
    { key: "won", title: "Ingresos ganados", value: "CLP $143.8M", description: "Cerrados", icon: "paid", tone: "green" },
    { key: "cases", title: "Casos resueltos", value: "1,284", description: "Servicio", icon: "assignment_turned_in", tone: "blue" },
    { key: "conversion", title: "Conversiones", value: "8.4%", description: "Mix comercial", icon: "conversion_path", tone: "blue" },
    { key: "cost", title: "Costo IA", value: "CLP $4.8M", description: "Estimado", icon: "auto_awesome", tone: "amber" },
    { key: "hours", title: "Horas ahorradas", value: "1,242", description: "Operación", icon: "schedule", tone: "green" },
    { key: "savings", title: "Ahorro estimado", value: "CLP $11.3M", description: "Eficiencia", icon: "savings", tone: "green" },
    { key: "roi", title: "ROI", value: "4.7x", description: "IA + automatización", icon: "query_stats", tone: "blue" }
  ] satisfies MetricCard[],
  tabs: ["Resumen", "Comercial", "Servicio", "Marketing", "IA", "Calidad de datos"],
  scorecards: [
    { label: "Horas ahorradas", value: "1,242" },
    { label: "Ahorro estimado", value: "CLP $11.3M" },
    { label: "ROI", value: "4.7x" },
    { label: "Frescura de datos", value: "91%" }
  ] satisfies KeyValueField[],
  funnel: [
    { label: "New", value: 12 },
    { label: "Engaged", value: 8 },
    { label: "Qualifying", value: 15 },
    { label: "Quote pending", value: 5 },
    { label: "Waiting customer", value: 6 },
    { label: "Negotiation", value: 3 },
    { label: "Won", value: 14 }
  ] satisfies AnalyticsSeriesPoint[],
  monthly: [
    { label: "Ene", value: 62 },
    { label: "Feb", value: 68 },
    { label: "Mar", value: 71 },
    { label: "Abr", value: 84 },
    { label: "May", value: 93 },
    { label: "Jun", value: 88 }
  ] satisfies AnalyticsSeriesPoint[],
  service: [
    { label: "SLA crítico", value: 14 },
    { label: "En revisión", value: 26 },
    { label: "Resueltos", value: 78 },
    { label: "Reabiertos", value: 8 }
  ] satisfies AnalyticsSeriesPoint[],
  marketing: [
    { label: "Open rate", value: 42 },
    { label: "CTR", value: 18 },
    { label: "Conversiones", value: 11 },
    { label: "Opt-out", value: 3 }
  ] satisfies AnalyticsSeriesPoint[],
  ai: [
    { label: "Tokens", value: 740 },
    { label: "Acciones propuestas", value: 122 },
    { label: "Aprobadas", value: 74 },
    { label: "Override rate", value: 12 }
  ] satisfies AnalyticsSeriesPoint[],
  quality: [
    { label: "Resueltos", value: 88 },
    { label: "Candidatos provisionales", value: 12 },
    { label: "Conflictos", value: 23 },
    { label: "Revisiones", value: 34 },
    { label: "Insuficiente", value: 11 }
  ] satisfies AnalyticsSeriesPoint[],
  commercialBreakdown: [
    { label: "Ingresos por etapa", value: "CLP $214.2M" },
    { label: "Ganadas", value: "CLP $143.8M" },
    { label: "Perdidas", value: "CLP $12.4M" },
    { label: "Pipeline futuro", value: "CLP $58.0M" }
  ] satisfies KeyValueField[],
  dataQualityRows: [
    { id: "dq-1", label: "Cobertura cliente", status: "92%", owner: "Data", freshness: "Hoy", confidence: "Alta", usage: "Alta", gaps: "1" },
    { id: "dq-2", label: "Cobertura orden", status: "88%", owner: "Platform", freshness: "Hoy", confidence: "Media", usage: "Alta", gaps: "2" },
    { id: "dq-3", label: "Cobertura WhatsApp", status: "96%", owner: "Ops", freshness: "Hace 5m", confidence: "Alta", usage: "Alta", gaps: "0" }
  ] satisfies TableRow[],
  operatorsRows: [
    { id: "op-1", label: "Admin User", status: "124 acciones", owner: "Operación", freshness: "Override 8%", confidence: "Alta", usage: "Alta", gaps: "1" },
    { id: "op-2", label: "Laura Perez", status: "86 acciones", owner: "CRM", freshness: "Override 12%", confidence: "Media", usage: "Alta", gaps: "2" }
  ] satisfies TableRow[],
  campaignRows: [
    { id: "cmp-1", label: "Carritos abandonados", status: "CLP $18.4M", owner: "Growth", freshness: "Open 42%", confidence: "Alta", usage: "Alta", gaps: "1" },
    { id: "cmp-2", label: "Postventa 48h", status: "CLP $12.1M", owner: "Growth", freshness: "Open 38%", confidence: "Media", usage: "Alta", gaps: "2" }
  ] satisfies TableRow[],
  integrationRows: [
    { id: "int-1", label: "PrestaShop", status: "98%", owner: "Platform", freshness: "12m", confidence: "Alta", usage: "Alta", gaps: "0" },
    { id: "int-2", label: "WhatsApp / Meta", status: "100%", owner: "Platform", freshness: "3m", confidence: "Alta", usage: "Alta", gaps: "0" },
    { id: "int-3", label: "SAP Business One", status: "76%", owner: "Platform", freshness: "12m", confidence: "Media", usage: "Alta", gaps: "3" }
  ] satisfies TableRow[]
};
