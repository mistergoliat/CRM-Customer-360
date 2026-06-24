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
  owner?: string;
  reach?: string;
  opens?: string;
  clicks?: string;
  conversion?: string;
  subject?: string;
  preheader?: string;
  cta?: string;
  variants?: { label: string; content: string }[];
  blocks?: string[];
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
  status?: string;
  executions?: string;
  conversions?: string;
  channel?: string;
  nodes?: { id: string; label: string; tone?: "green" | "amber" | "red" | "blue" | "gray"; branches?: string[] }[];
};

export type MarketingTemplateCard = {
  id: string;
  name: string;
  channel: string;
  category: string;
  usage: string;
  performance: string;
  updated: string;
  preview: string;
};

export const marketingOverviewFixture = {
  metrics: [
    { key: "active", title: "Campañas activas", value: "14", description: "En curso", icon: "campaign", tone: "green" },
    { key: "scheduled", title: "Programadas", value: "06", description: "Pendientes", icon: "schedule", tone: "amber" },
    { key: "drafts", title: "Borradores", value: "09", description: "Para revisión", icon: "draft", tone: "blue" },
    { key: "automation", title: "Automatizaciones", value: "12", description: "Flujos", icon: "account_tree", tone: "blue" },
    { key: "audience", title: "Audiencia alcanzable", value: "28.4K", description: "Consentida", icon: "groups", tone: "green" },
    { key: "conversions", title: "Conversiones", value: "8.4%", description: "Últimos 30 días", icon: "conversion_path", tone: "green" }
  ] satisfies MetricCard[],
  campaigns: [
    { id: "cmp-overview-1", label: "Carritos abandonados", status: "Activa", segment: "Carritos 7d", channel: "Email + WhatsApp", schedule: "Hoy 18:00", reach: "4,812", opens: "42%", clicks: "11%", conversion: "4.3%", owner: "Growth Ops", href: "/marketing/campaigns/demo-campaign-1" },
    { id: "cmp-overview-2", label: "Postventa 48h", status: "Programada", segment: "Postventa crítica", channel: "WhatsApp", schedule: "Mañana 09:00", reach: "1,120", opens: "58%", clicks: "16%", conversion: "6.1%", owner: "Ops", href: "/marketing/campaigns/demo-campaign-2" },
    { id: "cmp-overview-3", label: "Lanzamiento accesorios", status: "Borrador", segment: "Clientes recurrentes", channel: "Email", schedule: "Pendiente", reach: "3,200", opens: "39%", clicks: "9%", conversion: "2.8%", owner: "Growth Ops", href: "/marketing/campaigns/demo-campaign-3" },
    { id: "cmp-overview-4", label: "Winback 30d", status: "Activa", segment: "Dormidos 30d", channel: "WhatsApp", schedule: "Hoy 20:00", reach: "2,048", opens: "47%", clicks: "13%", conversion: "5.2%", owner: "Lifecycle", href: "/marketing/campaigns/demo-campaign-2" },
    { id: "cmp-overview-5", label: "VIP recovery", status: "Programada", segment: "VIP abandonados", channel: "Email", schedule: "Jue 11:00", reach: "611", opens: "63%", clicks: "18%", conversion: "7.4%", owner: "Growth Ops", href: "/marketing/campaigns/demo-campaign-1" }
  ],
  segments: [
    { label: "Abandonó carrito 7d", value: "4,812", state: "Activa" },
    { label: "Clientes con compra recurrente", value: "1,204", state: "Activa" },
    { label: "Postventa crítica 48h", value: "312", state: "Revisión" },
    { label: "Dormidos 30d", value: "2,048", state: "Activa" },
    { label: "VIP abandonados", value: "611", state: "Programada" }
  ],
  recommendations: [
    "Separar carritos abandonados por valor de compra.",
    "Crear variante con incentivo solo para clientes consentidos.",
    "Reusar el mismo segmento para email y WhatsApp con exclusiones.",
    "Publicar la plantilla de seguimiento con bloqueo de compradores recientes."
  ],
  performance: [
    { label: "Open rate", value: "42%" },
    { label: "CTR", value: "3.2%" },
    { label: "Conversiones", value: "8.4%" },
    { label: "Opt-out", value: "0.4%" }
  ] satisfies KeyValueField[],
  templates: [
    { id: "tpl-1", name: "Recordatorio carrito", channel: "Email", category: "Recuperación", usage: "124 usos", performance: "4.2% conv.", updated: "2h", preview: "Hero corto con producto, descuento leve y CTA directo." },
    { id: "tpl-2", name: "Seguimiento WhatsApp", channel: "WhatsApp", category: "Follow-up", usage: "88 usos", performance: "5.1% conv.", updated: "4h", preview: "Mensaje breve con confirmación de stock y link de revisión." },
    { id: "tpl-3", name: "Lanzamiento catálogo", channel: "Email", category: "Promoción", usage: "63 usos", performance: "2.8% conv.", updated: "1d", preview: "Grid de productos con propuesta de valor y CTA a catálogo." },
    { id: "tpl-4", name: "Winback 30d", channel: "WhatsApp", category: "Reactivación", usage: "41 usos", performance: "6.4% conv.", updated: "1d", preview: "Oferta de regreso con exclusión de compradores recientes." }
  ] satisfies MarketingTemplateCard[],
  automations: [
    { id: "auto-1", label: "Carrito abandonado", status: "Activa", trigger: "Cart abandoned", executions: "1,248", conversions: "4.3%", owner: "Growth Ops", channel: "Email + WhatsApp", href: "/marketing/automations/demo-automation-1" },
    { id: "auto-2", label: "Postventa 48h", status: "Activa", trigger: "Case resolved", executions: "842", conversions: "6.1%", owner: "Ops", channel: "WhatsApp", href: "/marketing/automations/demo-automation-2" },
    { id: "auto-3", label: "Winback 30d", status: "Pausada", trigger: "No purchase 30d", executions: "412", conversions: "3.7%", owner: "Lifecycle", channel: "Email", href: "/marketing/automations/demo-automation-2" }
  ]
};

export const marketingCopilotFixture = {
  messages: [
    { id: "msg-1", role: "user", label: "Usuario", body: "Quiero una campaña para carritos abandonados de los últimos 7 días." },
    { id: "msg-2", role: "copilot", label: "Copilot", body: "¿La quieres para email, WhatsApp o ambos? También necesito incentivo, exclusiones y horario." },
    { id: "msg-3", role: "user", label: "Usuario", body: "Email y WhatsApp, 10% de descuento, excluir compradores recientes." },
    { id: "msg-4", role: "copilot", label: "Copilot", body: "Perfecto. Armo audiencia consentida, bloqueo compras recientes y preparo dos variantes de asunto." },
    { id: "msg-5", role: "user", label: "Usuario", body: "Quiero que el tono sea más urgente pero sin sonar agresivo." },
    { id: "msg-6", role: "copilot", label: "Copilot", body: "Puedo subir urgencia con recordatorio de stock limitado y CTA directo al carrito." },
    { id: "msg-7", role: "user", label: "Usuario", body: "Déjala lista para aprobación." }
  ],
  quickReplies: ["Agregar canal", "Revisar exclusiones", "Cambiar tono", "Generar asunto"],
  draft: {
    name: "Recovery 7d",
    objective: "Recuperar carritos abandonados",
    segment: "Carritos abandonados 7d",
    channels: "Email + WhatsApp",
    schedule: "Hoy 18:00",
    approval: "Requerida",
    utm: "utm_campaign=recovery_7d",
    subject: "Tu carrito sigue esperando",
    preheader: "Retoma tu compra en segundos",
    cta: "Volver al carrito",
    audience: "4,812 contactos consentidos",
    rules: [
      "Carrito creado en últimos 7 días",
      "Sin compra completada",
      "Consentimiento válido"
    ],
    exclusions: [
      "Compradores recientes",
      "Pedidos cancelados por fraude",
      "Contactos sin consentimiento"
    ],
    content: [
      "Recordatorio de carrito",
      "Prueba social",
      "Incentivo leve"
    ],
    variants: [
      { label: "A", content: "Mensaje directo con urgencia y 10% de descuento." },
      { label: "B", content: "Mensaje consultivo con foco en stock y despacho." }
    ],
    lastEdit: "Hace 4 min"
  },
  governance: [
    "Consentimiento obligatorio para WhatsApp.",
    "Frecuencia máxima: 2 impactos / 7 días.",
    "No overlap con campañas activas de recuperación.",
    "Hard bounce y opt-out bloquean reingreso.",
    "Aprobación humana antes de programar."
  ],
  summary: [
    "Impacto esperado: +4.2% conversiones",
    "Costo estimado: CLP $120.000",
    "Ingreso esperado: CLP $2.8M",
    "ROI: 23.3x"
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
    { id: "segment-3", description: "Postventa crítica 48h", rules: "SLA risk + case open", size: "312", channel: "WhatsApp", consent: "Parcial", updated: "1h", campaigns: "1", href: "/marketing/segments?segment=segment-3" },
    { id: "segment-4", description: "Dormidos 30d", rules: "No purchase 30d", size: "2,048", channel: "Email", consent: "Sí", updated: "5m", campaigns: "2", href: "/marketing/segments?segment=segment-4" },
    { id: "segment-5", description: "VIP abandonados", rules: "Cart > 400k + consent", size: "611", channel: "Email + WhatsApp", consent: "Sí", updated: "8m", campaigns: "2", href: "/marketing/segments?segment=segment-5" },
    { id: "segment-6", description: "Leads de preventa", rules: "Lead source = preventa", size: "1,804", channel: "WhatsApp", consent: "Sí", updated: "22m", campaigns: "4", href: "/marketing/segments?segment=segment-1" },
    { id: "segment-7", description: "Clientes de accesorios", rules: "Purchased accessories", size: "932", channel: "Email", consent: "Sí", updated: "1d", campaigns: "2", href: "/marketing/segments?segment=segment-2" },
    { id: "segment-8", description: "Reactivación 90d", rules: "No order 90d", size: "4,012", channel: "WhatsApp", consent: "Parcial", updated: "2d", campaigns: "1", href: "/marketing/segments?segment=segment-3" }
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
  rows: [
    { id: "demo-campaign-1", name: "Recovery 7d", status: "Draft", segment: "Carritos abandonados 7d", channel: "WhatsApp + Email", schedule: "Hoy 18:00", reach: "4,812", opens: "42%", clicks: "11%", conversion: "4.3%", owner: "Growth Ops", href: "/marketing/campaigns/demo-campaign-1" },
    { id: "demo-campaign-2", name: "Lanzamiento accesorios", status: "Scheduled", segment: "Clientes recurrentes", channel: "Email", schedule: "Mañana 09:00", reach: "3,200", opens: "39%", clicks: "9%", conversion: "2.8%", owner: "Growth Ops", href: "/marketing/campaigns/demo-campaign-2" },
    { id: "demo-campaign-3", name: "Postventa 48h", status: "Active", segment: "Postventa crítica", channel: "WhatsApp", schedule: "Activo", reach: "1,120", opens: "58%", clicks: "16%", conversion: "6.1%", owner: "Ops", href: "/marketing/campaigns/demo-campaign-3" },
    { id: "demo-campaign-4", name: "Winback 30d", status: "Active", segment: "Dormidos 30d", channel: "WhatsApp", schedule: "Hoy 20:00", reach: "2,048", opens: "47%", clicks: "13%", conversion: "5.2%", owner: "Lifecycle", href: "/marketing/campaigns/demo-campaign-2" },
    { id: "demo-campaign-5", name: "VIP recovery", status: "Scheduled", segment: "VIP abandonados", channel: "Email", schedule: "Jue 11:00", reach: "611", opens: "63%", clicks: "18%", conversion: "7.4%", owner: "Growth Ops", href: "/marketing/campaigns/demo-campaign-1" },
    { id: "demo-campaign-6", name: "Lead nurturing", status: "Draft", segment: "Leads de preventa", channel: "Email + WhatsApp", schedule: "Pendiente", reach: "1,804", opens: "33%", clicks: "8%", conversion: "1.9%", owner: "Preventa", href: "/marketing/campaigns/demo-campaign-3" },
    { id: "demo-campaign-7", name: "Accessories cross-sell", status: "Completed", segment: "Clientes de accesorios", channel: "Email", schedule: "Cerrada", reach: "932", opens: "41%", clicks: "10%", conversion: "3.6%", owner: "Growth Ops", href: "/marketing/campaigns/demo-campaign-2" },
    { id: "demo-campaign-8", name: "Reactivation 90d", status: "Scheduled", segment: "Reactivación 90d", channel: "WhatsApp", schedule: "Vie 16:00", reach: "4,012", opens: "45%", clicks: "12%", conversion: "5.0%", owner: "Lifecycle", href: "/marketing/campaigns/demo-campaign-1" }
  ],
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
      governance: ["Approval required", "Consent enforced", "No live send"],
      owner: "Growth Ops",
      reach: "4,812",
      opens: "42%",
      clicks: "11%",
      conversion: "4.3%",
      subject: "Tu carrito sigue esperando",
      preheader: "Retoma tu compra en segundos",
      cta: "Volver al carrito",
      variants: [
        { label: "A", content: "Mensaje directo con urgencia y 10% de descuento." },
        { label: "B", content: "Mensaje consultivo con foco en stock y despacho." }
      ],
      blocks: ["Texto hero", "Imagen producto", "Botón CTA", "Separador", "Footer"]
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
      governance: ["Approved draft", "Consent enforced"],
      owner: "Growth Ops",
      reach: "3,200",
      opens: "39%",
      clicks: "9%",
      conversion: "2.8%",
      subject: "Nuevos accesorios disponibles",
      preheader: "Completa tu set de entrenamiento",
      cta: "Ver accesorios",
      variants: [
        { label: "A", content: "Variante con catálogo destacado." },
        { label: "B", content: "Variante con promoción de bundle." }
      ],
      blocks: ["Texto hero", "Grid productos", "CTA"]
    },
    "demo-campaign-3": {
      id: "demo-campaign-3",
      name: "Postventa 48h",
      objective: "Collect feedback and cross-sell",
      channel: "WhatsApp",
      segment: "Postventa crítica",
      status: "Active",
      schedule: "Hoy 10:00",
      approval: "Required",
      utm: "utm_campaign=postventa_48h",
      content: ["Asunto: Queremos saber cómo te fue", "Preheader: Cuéntanos para mejorar", "CTA: Responder encuesta"],
      preview_desktop: "Desktop preview with support card",
      preview_mobile: "Mobile preview stacked",
      suggestions: ["Pedir feedback antes del cross-sell", "Reducir longitud"],
      tests: ["Preview render ok"],
      governance: ["Approval required", "No live send"],
      owner: "Ops",
      reach: "1,120",
      opens: "58%",
      clicks: "16%",
      conversion: "6.1%",
      subject: "Queremos saber cómo te fue",
      preheader: "Cuéntanos para mejorar",
      cta: "Responder encuesta",
      variants: [
        { label: "A", content: "Encuesta corta + oferta de soporte." },
        { label: "B", content: "Encuesta + recomendación de accesorios." }
      ],
      blocks: ["Texto hero", "Encuesta", "CTA"]
    }
  },
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
    governance: ["Preview only", "No live send", "Approval later"],
    owner: "Growth Ops",
    subject: "Escribe un asunto",
    preheader: "Escribe un preheader",
    cta: "Definir CTA",
    blocks: ["Texto", "Imagen", "Botón", "Separador", "Footer"]
  }
} satisfies {
  rows: { id: string; name: string; status: string; segment: string; channel: string; schedule: string; reach: string; opens: string; clicks: string; conversion: string; owner: string; href: string }[];
  campaigns: Record<string, MarketingCampaign>;
  newCampaign: MarketingCampaign;
};

export const marketingAutomationsFixture = {
  rows: [
    { id: "demo-automation-1", name: "Carrito abandonado", status: "Activa", trigger: "Cart abandoned", executions: "1,248", conversions: "4.3%", owner: "Growth Ops", channel: "Email + WhatsApp", href: "/marketing/automations/demo-automation-1" },
    { id: "demo-automation-2", name: "Postventa 48h", status: "Activa", trigger: "Case resolved", executions: "842", conversions: "6.1%", owner: "Ops", channel: "WhatsApp", href: "/marketing/automations/demo-automation-2" },
    { id: "demo-automation-3", name: "Winback 30d", status: "Pausada", trigger: "No purchase 30d", executions: "412", conversions: "3.7%", owner: "Lifecycle", channel: "Email", href: "/marketing/automations/demo-automation-3" },
    { id: "demo-automation-4", name: "Lead nurturing", status: "Borrador", trigger: "Lead created", executions: "210", conversions: "1.9%", owner: "Preventa", channel: "Email + WhatsApp", href: "/marketing/automations/demo-automation-4" },
    { id: "demo-automation-5", name: "VIP recovery", status: "Activa", trigger: "Cart > 400k", executions: "311", conversions: "7.4%", owner: "Growth Ops", channel: "Email", href: "/marketing/automations/demo-automation-5" }
  ],
  automations: {
    "demo-automation-1": {
      id: "demo-automation-1",
      name: "Carrito abandonado",
      trigger: "Carrito abandonado",
      wait: "4h",
      condition: "No purchase",
      email: "Enviar correo recordatorio",
      whatsapp: "Enviar WhatsApp si hay consentimiento",
      branches: ["Recordatorio", "Escalar a supervisor", "Cerrar si compra"],
      suppression: "Suppress if purchase completed",
      owner: "Growth Ops",
      governance: ["No motor real", "Preview canvas", "Approval before send"],
      status: "Activa",
      executions: "1,248",
      conversions: "4.3%",
      channel: "Email + WhatsApp",
      nodes: [
        { id: "node-1", label: "Carrito abandonado", tone: "blue" },
        { id: "node-2", label: "Esperar 4 horas", tone: "gray" },
        { id: "node-3", label: "¿Compró?", tone: "amber", branches: ["Sí", "No"] },
        { id: "node-4", label: "Enviar email", tone: "blue" },
        { id: "node-5", label: "Esperar 24 horas", tone: "gray" },
        { id: "node-6", label: "¿Abrió email?", tone: "amber", branches: ["Sí", "No"] },
        { id: "node-7", label: "Enviar WhatsApp", tone: "blue" }
      ]
    },
    "demo-automation-2": {
      id: "demo-automation-2",
      name: "Postventa 48h",
      trigger: "Caso resuelto",
      wait: "48h",
      condition: "SLA satisfied",
      email: "Enviar encuesta",
      whatsapp: "Enviar seguimiento",
      branches: ["Feedback", "Cross-sell", "No response follow-up"],
      suppression: "Suppress if case reopened",
      owner: "Operations",
      governance: ["Preview canvas", "Read only", "No execution"],
      status: "Activa",
      executions: "842",
      conversions: "6.1%",
      channel: "WhatsApp",
      nodes: [
        { id: "node-1", label: "Caso resuelto", tone: "green" },
        { id: "node-2", label: "Esperar 48 horas", tone: "gray" },
        { id: "node-3", label: "Enviar encuesta", tone: "blue" },
        { id: "node-4", label: "Esperar 24 horas", tone: "gray" },
        { id: "node-5", label: "¿Respondió?", tone: "amber", branches: ["Sí", "No"] }
      ]
    }
  }
} satisfies {
  rows: { id: string; name: string; status: string; trigger: string; executions: string; conversions: string; owner: string; channel: string; href: string }[];
  automations: Record<string, MarketingAutomation>;
};

export const marketingTemplatesFixture = {
  cards: marketingOverviewFixture.templates
};

export const marketingPerformanceFixture = {
  metrics: [
    { key: "reach", title: "Alcance", value: "28.4K", description: "Contactos", icon: "groups", tone: "green" },
    { key: "open", title: "Apertura", value: "42%", description: "Promedio", icon: "mail", tone: "blue" },
    { key: "ctr", title: "CTR", value: "3.2%", description: "Clicks", icon: "ads_click", tone: "blue" },
    { key: "conv", title: "Conversión", value: "8.4%", description: "Objetivo", icon: "conversion_path", tone: "green" },
    { key: "revenue", title: "Revenue", value: "CLP $18.4M", description: "Atribuido", icon: "paid", tone: "green" },
    { key: "optout", title: "Opt-out", value: "0.4%", description: "Baja", icon: "unsubscribe", tone: "amber" },
    { key: "cost", title: "Costo", value: "CLP $1.2M", description: "Media", icon: "payments", tone: "amber" },
    { key: "roi", title: "ROI", value: "15.3x", description: "Estimado", icon: "query_stats", tone: "green" }
  ] satisfies MetricCard[],
  trend: [
    { label: "Ene", value: 62 },
    { label: "Feb", value: 68 },
    { label: "Mar", value: 71 },
    { label: "Abr", value: 84 },
    { label: "May", value: 93 },
    { label: "Jun", value: 88 }
  ],
  topCampaigns: marketingOverviewFixture.campaigns.slice(0, 4),
  topSegments: marketingOverviewFixture.segments.slice(0, 4),
  channelComparison: [
    { label: "Email", value: 42 },
    { label: "WhatsApp", value: 58 }
  ]
};
