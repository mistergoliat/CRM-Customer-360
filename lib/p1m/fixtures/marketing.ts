import type { KeyValueField, MetricCard, TableRow } from "../types";

export type MarketingSegmentRow = TableRow & {
  description: string;
  rules: string;
  size: string;
  channel: string;
  consent: string;
  updated: string;
  campaigns: string;
};

export type MarketingCampaign = {
  id: string;
  name: string;
  objective: string;
  channel: string;
  segment: string;
  status: string;
  schedule: string;
  approval: string;
  utm: string;
  content: string[];
  preview_desktop: string;
  preview_mobile: string;
  suggestions: string[];
  tests: string[];
  governance: string[];
};

export type MarketingAutomation = {
  id: string;
  name: string;
  trigger: string;
  wait: string;
  condition: string;
  email: string;
  whatsapp: string;
  branches: string[];
  suppression: string;
  owner: string;
  governance: string[];
};

export const marketingOverviewFixture = {
  metrics: [
    { key: "active", title: "Campañas activas", value: "14", description: "En curso", icon: "campaign", tone: "green" },
    { key: "scheduled", title: "Programadas", value: "06", description: "Pendientes", icon: "schedule", tone: "amber" },
    { key: "drafts", title: "Borradores", value: "09", description: "Para review", icon: "draft", tone: "blue" },
    { key: "audience", title: "Audiencia alcanzable", value: "28.4K", description: "Consented", icon: "groups", tone: "green" }
  ] satisfies MetricCard[],
  campaigns: [
    { label: "Carritos abandonados", value: "CLP $1.1M", state: "Activa" },
    { label: "Recuperación postventa", value: "CLP $840K", state: "Programada" },
    { label: "Lanzamiento accesorios", value: "CLP $420K", state: "Borrador" }
  ],
  segments: [
    { label: "Abandonó carrito 7d", value: "4,812", state: "Activa" },
    { label: "Clientes con compra recurrente", value: "1,204", state: "Activa" },
    { label: "Postventa crítica", value: "312", state: "Revisión" }
  ],
  recommendations: [
    "Separar carritos abandonados por valor de compra.",
    "Crear variante con incentivo solo para clientes consentidos.",
    "Reusar el mismo segmento para email y WhatsApp con exclusiones."
  ],
  performance: [
    { label: "Conversiones", value: "8.4%" },
    { label: "CTR", value: "3.2%" },
    { label: "Opt-out", value: "0.4%" }
  ] satisfies KeyValueField[],
  templates: ["Email descuento", "WhatsApp seguimiento", "Catálogo actualizado"],
  automations: [
    { label: "Carrito abandonado", value: "Activa" },
    { label: "Postventa 48h", value: "Activa" },
    { label: "Lead nurturing", value: "Programada" }
  ]
};

export const marketingCopilotFixture = {
  user_prompt: "Quiero generar una campaña para todos los carritos abandonados en los últimos 7 días.",
  stages: ["Instrucción del usuario", "Segmento", "Exclusiones", "Audiencia", "Canal", "Contenido", "Variantes", "Programación", "Aprobación"],
  draft: [
    { label: "Segmento", value: "Carritos abandonados 7d", tone: "blue" },
    { label: "Exclusiones", value: "Clientes con compra completada", tone: "gray" },
    { label: "Audiencia", value: "4,812 contactos", tone: "green" },
    { label: "Canal", value: "WhatsApp + Email", tone: "blue" },
    { label: "Contenido", value: "Recordatorio + prueba social", tone: "amber" },
    { label: "Variantes", value: "2", tone: "gray" },
    { label: "Programación", value: "Hoy 18:00", tone: "blue" },
    { label: "Aprobación", value: "Requerida", tone: "red" }
  ] as KeyValueField[],
  governance: [
    "No generar SQL libre.",
    "No enviar campañas reales.",
    "Mantener aprobación separada de ejecución."
  ],
  validation: [
    "Segmento consentido",
    "Exclusiones aplicadas",
    "Canal permitido",
    "Contenido sin claims sensibles"
  ],
  suggestions: [
    "Usar el mismo copy para WhatsApp y email.",
    "Crear una variante con incentivo menor.",
    "Bloquear contactos con compra completada en los últimos 3 días."
  ]
};

export const marketingSegmentsFixture = {
  metrics: [
    { key: "segments", title: "Segmentos", value: "18", description: "Activos", icon: "segment", tone: "blue" },
    { key: "consent", title: "Con consentimiento", value: "82%", description: "Listas elegibles", icon: "verified_user", tone: "green" },
    { key: "updated", title: "Actualizados hoy", value: "09", description: "Sync", icon: "update", tone: "amber" },
    { key: "campaigns", title: "Campañas asociadas", value: "31", description: "Relación", icon: "campaign", tone: "blue" }
  ] satisfies MetricCard[],
  rows: [
    { id: "segment-1", description: "Carritos abandonados últimos 7 días", rules: "Cart <= 7d + no purchase", size: "4,812", channel: "Email + WhatsApp", consent: "Sí", updated: "2m", campaigns: "3", href: "/marketing/segments?segment=segment-1" },
    { id: "segment-2", description: "Clientes recurrentes con ticket alto", rules: "2+ compras + CLP > 250k", size: "1,204", channel: "Email", consent: "Sí", updated: "15m", campaigns: "2", href: "/marketing/segments?segment=segment-2" },
    { id: "segment-3", description: "Postventa crítica 48h", rules: "SLA risk + case open", size: "312", channel: "WhatsApp", consent: "Parcial", updated: "1h", campaigns: "1", href: "/marketing/segments?segment=segment-3" }
  ] satisfies MarketingSegmentRow[],
  selected: {
    name: "Carritos abandonados 7d",
    description: "Cliente añadió productos al carrito pero no completó la compra.",
    rules: ["Cart created within 7 days", "No order completed", "Consent available"],
    size: "4,812",
    channel: "Email + WhatsApp",
    consent: "Sí",
    updated: "2m",
    campaigns: ["Recovery 7d", "Recovery low ticket", "VIP recovery"],
    source_systems: [
      { label: "PrestaShop", value: "Carrito", tone: "green" },
      { label: "CRM", value: "Consentimiento", tone: "blue" },
      { label: "Brain", value: "Preview", tone: "amber" }
    ]
  }
};

export const marketingCampaignsFixture = {
  campaigns: {
    "demo-campaign-1": {
      id: "demo-campaign-1",
      name: "Recovery 7d",
      objective: "Recover abandoned carts",
      channel: "WhatsApp + Email",
      segment: "Carritos abandonados 7d",
      status: "Draft",
      schedule: "Hoy 18:00",
      approval: "Required",
      utm: "utm_campaign=recovery_7d",
      content: ["Asunto: Tu carrito sigue esperando", "Preheader: Retoma tu compra en segundos", "CTA: Volver al carrito"],
      preview_desktop: "Desktop preview with hero and CTA",
      preview_mobile: "Mobile preview stacked",
      suggestions: ["Usar incentivo leve", "Acortar asunto", "Agregar prueba social"],
      tests: ["Test send disabled", "Preview render ok"],
      governance: ["Approval required", "Consent enforced", "No live send"]
    },
    "demo-campaign-2": {
      id: "demo-campaign-2",
      name: "Lanzamiento accesorios",
      objective: "Promote accessories",
      channel: "Email",
      segment: "Clientes recurrentes",
      status: "Scheduled",
      schedule: "Mañana 09:00",
      approval: "Approved",
      utm: "utm_campaign=accessories_launch",
      content: ["Asunto: Nuevos accesorios disponibles", "Preheader: Completa tu set de entrenamiento", "CTA: Ver accesorios"],
      preview_desktop: "Desktop preview with product grid",
      preview_mobile: "Mobile preview stacked",
      suggestions: ["Mantener copy corto", "Destacar descuento"],
      tests: ["Preview render ok"],
      governance: ["Approved draft", "Consent enforced"]
    }
  } satisfies Record<string, MarketingCampaign>,
  newCampaign: {
    id: "new",
    name: "Nueva campaña",
    objective: "Build draft",
    channel: "Email + WhatsApp",
    segment: "Seleccionar segmento",
    status: "Preview",
    schedule: "Programación pendiente",
    approval: "Required",
    utm: "utm_campaign=new",
    content: ["Escribe un asunto", "Escribe un preheader", "Escribe un CTA"],
    preview_desktop: "Desktop preview placeholder",
    preview_mobile: "Mobile preview placeholder",
    suggestions: ["Agregar segmento", "Definir exclusiones", "Solicitar aprobación"],
    tests: ["Test send disabled"],
    governance: ["Preview only", "No live send", "Approval later"]
  } satisfies MarketingCampaign
};

export const marketingAutomationsFixture = {
  automations: {
    "demo-automation-1": {
      id: "demo-automation-1",
      name: "Carrito abandonado",
      trigger: "Cart abandoned",
      wait: "2h",
      condition: "No purchase",
      email: "Enviar correo recordatorio",
      whatsapp: "Enviar WhatsApp si hay consentimiento",
      branches: ["Recordatorio", "Escalar a supervisor", "Cerrar si compra"],
      suppression: "Suppress if purchase completed",
      owner: "Growth Ops",
      governance: ["No motor real", "Preview canvas", "Approval before send"]
    },
    "demo-automation-2": {
      id: "demo-automation-2",
      name: "Postventa 48h",
      trigger: "Case resolved",
      wait: "48h",
      condition: "SLA satisfied",
      email: "Enviar encuesta",
      whatsapp: "Enviar seguimiento",
      branches: ["Feedback", "Cross-sell", "No response follow-up"],
      suppression: "Suppress if case reopened",
      owner: "Operations",
      governance: ["Preview canvas", "Read only", "No execution"]
    }
  } satisfies Record<string, MarketingAutomation>
};
