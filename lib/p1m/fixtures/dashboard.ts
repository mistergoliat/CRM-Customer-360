import type { KeyValueField, MetricCard, TimelineItem, TableRow } from "../types";

export type DashboardFixture = {
  metrics: MetricCard[];
  priorityRows: TableRow[];
  pipeline: { key: string; label: string; count: number; value: string; tone?: "green" | "amber" | "red" | "blue" | "gray" }[];
  recentActivity: TimelineItem[];
  aiReview: {
    customer: string;
    opportunity: string;
    signal: string;
    action: string;
    confidence: string;
    risk: string;
    approval: string;
    missing: string[];
  };
  identityQuality: KeyValueField[];
  integrationHealth: { label: string; status: string }[];
  sourceStatus: { label: string; status: string; detail?: string }[];
};

export const dashboardFixture: DashboardFixture = {
  metrics: [
    { key: "conversations", title: "Conversaciones esperando", value: "12", description: "Urgente", icon: "forum", tone: "blue", href: "/conversations" },
    { key: "opportunities", title: "Oportunidades activas", value: "45", description: "Pipeline", icon: "point_of_sale", tone: "green", href: "/opportunities" },
    { key: "followups", title: "Follow-ups de hoy", value: "08", description: "Hoy", icon: "event_available", tone: "amber", href: "/actions" },
    { key: "cases", title: "Casos en riesgo", value: "03", description: "SLA crítico", icon: "warning", tone: "red", href: "/cases" },
    { key: "actions", title: "Acciones por revisar", value: "21", description: "Pendiente", icon: "bolt", tone: "blue", href: "/actions" }
  ],
  priorityRows: [
    {
      id: "p1m-priority-1",
      priority: "P0",
      client: "Camila Rojas",
      phone: "56987554321",
      work_type: "Oportunidad",
      related_entity: "Home Gym Pro - Cotización formal",
      status: "Quote pending",
      reason: "Validación humana requerida para descuento especial",
      waiting_time: "42m\nSLA Risk",
      owner: "Admin User",
      action: "Revisar",
      href: "/opportunities/demo-opportunity-1"
    },
    {
      id: "p1m-priority-1b",
      priority: "P0",
      client: "Camila Rojas",
      phone: "56987554321",
      work_type: "Conversación",
      related_entity: "Consulta de stock y despacho",
      status: "Esperando cliente",
      reason: "Ya existe oportunidad vinculada pero falta confirmar disponibilidad",
      waiting_time: "18m",
      owner: "Laura Perez",
      action: "Ver",
      href: "/conversations/demo-conversation-2"
    },
    {
      id: "p1m-priority-2",
      priority: "P1",
      client: "Gimnasio Pacific",
      phone: "56981234567",
      work_type: "Caso",
      related_entity: "Trotadora con falla",
      status: "En progreso",
      reason: "Retraso logístico en sincronización SAP",
      waiting_time: "2.5h",
      owner: "Admin User",
      action: "Abrir",
      href: "/cases/demo-case-1"
    },
    {
      id: "p1m-priority-3",
      priority: "P1",
      client: "Mauricio Lopez",
      phone: "56983456789",
      work_type: "Conversación",
      related_entity: "Consulta envío WhatsApp",
      status: "Esperando cliente",
      reason: "Esperando respuesta del cliente",
      waiting_time: "15m",
      owner: "Laura Perez",
      action: "Ver",
      href: "/conversations/demo-conversation-1"
    },
    {
      id: "p1m-priority-4",
      priority: "P2",
      client: "Vanessa Reyes",
      phone: "56984567890",
      work_type: "Acción de agente",
      related_entity: "Enviar catálogo actualizado",
      status: "Revisión requerida",
      reason: "AI SDR sugiere envío, requiere aprobación",
      waiting_time: "1.1h",
      owner: "Laura Perez",
      action: "Revisar",
      href: "/actions"
    },
    {
      id: "p1m-priority-5",
      priority: "P3",
      client: "Jorge Silva",
      phone: "56986378901",
      work_type: "Revisión de identidad",
      related_entity: "Conflicto de identidad PrestaShop / WA",
      status: "Requiere revisión",
      reason: "Posible duplicado de cliente",
      waiting_time: "3.2h",
      owner: "Admin User",
      action: "Ver",
      href: "/customers/demo-customer-3"
    },
    {
      id: "p1m-priority-6",
      priority: "P1",
      client: "Renata Soto",
      phone: "56974455661",
      work_type: "Acción",
      related_entity: "Confirmar descuento aprobado",
      status: "Revisión requerida",
      reason: "El copilot detectó riesgo de margen y espera confirmación",
      waiting_time: "58m",
      owner: "Laura Perez",
      action: "Revisar",
      href: "/actions/demo-action-1"
    },
    {
      id: "p1m-priority-7",
      priority: "P2",
      client: "Andrés Ibarra",
      phone: "56952233441",
      work_type: "Oportunidad",
      related_entity: "Mantenimiento anual",
      status: "Negotiation",
      reason: "Esperando documento adjunto y validación de términos",
      waiting_time: "2.1h",
      owner: "Admin User",
      action: "Abrir",
      href: "/opportunities/demo-opportunity-3"
    },
    {
      id: "p1m-priority-8",
      priority: "P3",
      client: "Marta León",
      phone: "56931122449",
      work_type: "Caso",
      related_entity: "Garantía de producto",
      status: "Abierto",
      reason: "Se requiere revisión de evidencia antes de escalar",
      waiting_time: "4.3h",
      owner: "Laura Perez",
      action: "Abrir",
      href: "/cases/demo-case-1"
    }
  ],
  pipeline: [
    { key: "new", label: "New", count: 12, value: "$1.8M", tone: "gray" },
    { key: "engaged", label: "Engaged", count: 8, value: "$2.1M", tone: "blue" },
    { key: "qualifying", label: "Qualifying", count: 15, value: "$3.4M", tone: "blue" },
    { key: "quote_pending", label: "Quote pending", count: 5, value: "$2.7M", tone: "amber" },
    { key: "waiting_customer", label: "Waiting customer", count: 6, value: "$1.2M", tone: "gray" },
    { key: "negotiation", label: "Negotiation", count: 3, value: "$2.0M", tone: "red" },
    { key: "won", label: "Won", count: 14, value: "$1.0M", tone: "green" }
  ],
  recentActivity: [
    {
      id: "activity-1",
      title: "WhatsApp - Mensaje entrante",
      subtitle: "Camila Rojas: \"¿Tienen stock de trotadora profesional?\"",
      time: "2 min ago",
      tone: "green",
      icon: "chat",
      chips: [{ label: "CONV-5567", tone: "blue" }]
    },
    {
      id: "activity-2",
      title: "Operador - Respuesta",
      subtitle: "Admin User respondió a Camila Rojas",
      time: "15 min ago",
      tone: "blue",
      icon: "person"
    },
    {
      id: "activity-3",
      title: "Oportunidad - Etapa actualizada",
      subtitle: "Home Gym Pro pasó a Quote pending",
      time: "1 hour ago",
      tone: "blue",
      icon: "target"
    },
    {
      id: "activity-4",
      title: "Caso - Creado",
      subtitle: "Trotadora con falla - Gimnasio Pacific",
      time: "2 hours ago",
      tone: "amber",
      icon: "assignment"
    },
    {
      id: "activity-5",
      title: "PrestaShop - Orden sincronizada",
      subtitle: "Orden #1021 por $2.345.000",
      time: "3 hours ago",
      tone: "gray",
      icon: "shopping_cart"
    },
    {
      id: "activity-6",
      title: "Copilot - Recomendación creada",
      subtitle: "Cotización formal con aprobación requerida",
      time: "4 hours ago",
      tone: "amber",
      icon: "auto_awesome"
    },
    {
      id: "activity-7",
      title: "Knowledge - Artículo consultado",
      subtitle: "Proceso de cotización abierto desde Copilot",
      time: "5 hours ago",
      tone: "blue",
      icon: "book_5"
    }
  ],
  aiReview: {
    customer: "Camila Rojas",
    opportunity: "Home Gym Pro - Cotización formal",
    signal: "Solicitud de cotización formal",
    action: "Preparar borrador de cotización",
    confidence: "Alta",
    risk: "Medio",
    approval: "Requerida",
    missing: ["Historial completo de compras", "Dirección de despacho confirmada"]
  },
  identityQuality: [
    { label: "Resueltos", value: "88%" },
    { label: "Candidatos provisionales", value: "12%" },
    { label: "Conflictos de identidad", value: "23" },
    { label: "Requieren revisión", value: "34" },
    { label: "Identidad insuficiente", value: "11" }
  ],
  integrationHealth: [
    { label: "PrestaShop", status: "Conectado" },
    { label: "WhatsApp / Meta", status: "Conectado" },
    { label: "SAP Business One", status: "Retrasado 12m" },
    { label: "POS", status: "Conectado" },
    { label: "Preventa", status: "Conectado" },
    { label: "CRM Brain", status: "Conectado" }
  ],
  sourceStatus: [
    { label: "PrestaShop API", status: "Conectado", detail: "12m" },
    { label: "SAP Business One", status: "Retrasado", detail: "12m" },
    { label: "WhatsApp Cloud", status: "Conectado", detail: "3m" },
    { label: "CRM Brain", status: "Conectado", detail: "read-only" },
    { label: "Meta Graph", status: "Conectado", detail: "session ok" },
    { label: "Scheduler", status: "Conectado", detail: "preview mode" }
  ]
};
