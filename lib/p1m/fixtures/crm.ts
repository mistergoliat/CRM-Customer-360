import type { KeyValueField, MetricCard, TableRow, TimelineItem } from "../types";

export type ConversationRow = TableRow & {
  client: string;
  wa_id: string;
  channel: string;
  status: string;
  owner: string;
  waiting: string;
  related: string;
  last_message: string;
  summary: string;
  source?: string;
  direction?: string;
  tone?: "green" | "amber" | "red" | "blue" | "gray";
};

export type ConversationWorkspace = {
  id: string;
  customer: string;
  identity: string;
  status: string;
  owner: string;
  channel: string;
  linked_case: string;
  linked_opportunity: string;
  source_systems: KeyValueField[];
  notes: string[];
  signals: KeyValueField[];
  attachments?: { name: string; type: string; size: string }[];
  messages: { id: string; direction: "inbound" | "outbound" | "system"; author: string; body: string; time: string; tone?: "green" | "amber" | "red" | "blue" | "gray"; chips?: { label: string; tone?: "green" | "amber" | "red" | "blue" | "gray" }[] }[];
  action_queue: { id: string; title: string; due: string; status: string; preview: string; disabled: boolean }[];
  copilot: {
    summary: string;
    next_action: string;
    rationale: string;
    evidence: string[];
    missing: string[];
    guardrails: string[];
  };
  composer: {
    templates: string[];
    quick_actions: string[];
  };
};

export type CustomerRow = TableRow & {
  client: string;
  identity_state: string;
  source: string;
  activity: string;
  status: string;
  region: string;
  ltv?: string;
  risk?: string;
};

export type CustomerProfile = {
  id: string;
  name: string;
  identity: string;
  contact: string;
  source: string;
  rut: string;
  region: string;
  last_activity: string;
  ltv?: string;
  operational_health?: string;
  summary: string;
  commercial_summary: string;
  notes: string[];
  missing_data: string[];
  source_systems: KeyValueField[];
  conversations: TimelineItem[];
  opportunities: TimelineItem[];
  cases: TimelineItem[];
  actions: TimelineItem[];
};

export type OpportunityRow = TableRow & {
  customer: string;
  stage: string;
  status: string;
  estimated_value: string;
  activity: string;
  next_action: string;
  owner: string;
  risk: string;
};

export type OpportunityWorkspace = {
  id: string;
  customer: string;
  stage: string;
  status: string;
  amount: string;
  source: string;
  owner: string;
  last_activity: string;
  needs: string[];
  products: string[];
  budget: string;
  location: string;
  objections: string[];
  requirements: string[];
  next_step: string;
  timeline: TimelineItem[];
  quote: {
    number: string;
    status: string;
    amount: string;
    issued: string;
    expiry: string;
  };
  copilot: {
    summary: string;
    next_action: string;
    risk: string;
    approval: string;
    evidence: string[];
  };
  actions: { label: string; state: string; disabled: boolean }[];
};

export type ActionRow = TableRow & {
  client: string;
  related_entity: string;
  status: string;
  risk: string;
  approval: string;
  origin: string;
  schedule: string;
  owner: string;
};

export type ActionDetail = {
  id: string;
  client: string;
  related_entity: string;
  lifecycle: string[];
  rationale: string;
  evidence: string[];
  missing: string[];
  eligibility: string[];
  guardrails: string[];
  preview: string;
};

export const conversationInboxFixture = {
  metrics: [
    { key: "waiting", title: "Conversaciones esperando", value: "12", description: "Urgente", icon: "forum", tone: "blue", href: "/conversations" },
    { key: "today", title: "Pendientes hoy", value: "08", description: "Hoy", icon: "event", tone: "amber", href: "/conversations" },
    { key: "human", title: "Requieren humano", value: "03", description: "SLA crítico", icon: "warning", tone: "red", href: "/cases" },
    { key: "owner", title: "Sin responsable", value: "05", description: "Pendiente", icon: "person_search", tone: "gray", href: "/actions" }
  ] satisfies MetricCard[],
  filters: ["Todos", "WhatsApp", "Email", "Requiere humano", "Hoy", "Con oportunidad"],
  rows: [
    {
      id: "demo-conversation-1",
      client: "Mauricio Lopez",
      wa_id: "56983456789",
      channel: "WhatsApp",
      status: "Esperando cliente",
      owner: "Admin User",
      waiting: "15m",
      related: "CAS-3341 · OPP-1009",
      last_message: "¿Tienen stock de trotadora profesional para entrega esta semana?",
      summary: "AI SDR sugiere confirmar stock y tiempo de despacho antes de escalar a cotización.",
      priority: "P1",
      unread: "2",
      id_label: "CONV-5567",
      tone: "amber",
      href: "/conversations/demo-conversation-1"
    },
    {
      id: "demo-conversation-2",
      client: "Camila Rojas",
      wa_id: "56987554321",
      channel: "WhatsApp",
      status: "Quote pending",
      owner: "Laura Perez",
      waiting: "42m",
      related: "OPP-1008",
      last_message: "Necesito el borrador de cotización con descuento especial.",
      summary: "Escala a revisión humana por descuento especial y validación de margen.",
      priority: "P0",
      unread: "1",
      id_label: "CONV-6650",
      tone: "red",
      href: "/conversations/demo-conversation-2"
    },
    {
      id: "demo-conversation-3",
      client: "Vanessa Reyes",
      wa_id: "56984567890",
      channel: "Email",
      status: "Revisión requerida",
      owner: "Admin User",
      waiting: "1.1h",
      related: "ACT-7709",
      last_message: "¿Podemos enviar catálogo actualizado y condiciones de pago?",
      summary: "Solicita catálogo actualizado, pendiente de aprobación.",
      priority: "P2",
      unread: "0",
      id_label: "CONV-7709",
      tone: "blue",
      href: "/conversations/demo-conversation-3"
    },
    {
      id: "demo-conversation-4",
      client: "Renata Soto",
      wa_id: "56974455661",
      channel: "WhatsApp",
      status: "Revisión requerida",
      owner: "Laura Perez",
      waiting: "28m",
      related: "OPP-2010 · Mantenimiento anual",
      last_message: "Necesito confirmar condiciones y cobertura del plan.",
      summary: "Requiere validar elegibilidad antes de avanzar a propuesta.",
      priority: "P1",
      unread: "1",
      id_label: "CONV-7711",
      tone: "amber",
      href: "/conversations/demo-conversation-1"
    },
    {
      id: "demo-conversation-5",
      client: "Andrés Ibarra",
      wa_id: "56952233441",
      channel: "Email",
      status: "Esperando cliente",
      owner: "Admin User",
      waiting: "1.2h",
      related: "OPP-2011 · CrossFit Pro",
      last_message: "Te envié el resumen comercial con el catálogo.",
      summary: "Pendiente de respuesta para seguir con la negociación.",
      priority: "P2",
      unread: "0",
      id_label: "CONV-7712",
      tone: "blue",
      href: "/conversations/demo-conversation-3"
    },
    {
      id: "demo-conversation-6",
      client: "Marta León",
      wa_id: "56931122449",
      channel: "WhatsApp",
      status: "Requerimos humano",
      owner: "Laura Perez",
      waiting: "3h",
      related: "CAS-4470 · Garantía de producto",
      last_message: "Adjunté fotos del producto con falla.",
      summary: "El caso necesita revisión humana y documentación extra.",
      priority: "P0",
      unread: "3",
      id_label: "CONV-7713",
      tone: "red",
      href: "/conversations/demo-conversation-2"
    },
    {
      id: "demo-conversation-7",
      client: "José Fuentes",
      wa_id: "56966778899",
      channel: "WhatsApp",
      status: "Esperando cliente",
      owner: "Admin User",
      waiting: "5h",
      related: "OPP-2012 · Winback 30d",
      last_message: "¿Puedo retomar la compra con despacho express?",
      summary: "Tiene intención de reactivar la compra con condiciones de envío.",
      priority: "P2",
      unread: "1",
      id_label: "CONV-7714",
      tone: "blue",
      href: "/conversations/demo-conversation-1"
    },
    {
      id: "demo-conversation-8",
      client: "Valentina Cruz",
      wa_id: "56922334455",
      channel: "Email",
      status: "Revisión requerida",
      owner: "Laura Perez",
      waiting: "7h",
      related: "CAS-4480 · Garantía",
      last_message: "Necesito el detalle de cobertura de garantía.",
      summary: "La respuesta necesita validación antes de salir.",
      priority: "P1",
      unread: "0",
      id_label: "CONV-7715",
      tone: "amber",
      href: "/conversations/demo-conversation-3"
    }
  ] satisfies ConversationRow[],
  selectedId: "demo-conversation-1",
  workspaces: {
    "demo-conversation-1": {
      id: "demo-conversation-1",
      customer: "Mauricio Lopez",
      identity: "56983456789",
      status: "Esperando cliente",
      owner: "Admin User",
      channel: "WhatsApp",
      linked_case: "CAS-3341 · Trotadora con falla",
      linked_opportunity: "OPP-1009 · Home Gym Pro",
      source_systems: [
        { label: "WhatsApp", value: "Directo", tone: "green" },
        { label: "PrestaShop", value: "Orden #1021", tone: "blue" },
        { label: "CRM Brain", value: "Preview", tone: "amber" }
      ],
      notes: ["Cliente solicita stock y despacho.", "Quiere comparar entrega con retiro en tienda."],
      signals: [
        { label: "Intent", value: "Cotización", tone: "blue" },
        { label: "Risk", value: "Moderado", tone: "amber" },
        { label: "Approval", value: "No requerida", tone: "green" }
      ],
      attachments: [
        { name: "cotizacion-preliminar.pdf", type: "PDF", size: "1.2 MB" },
        { name: "captura-stock.png", type: "Imagen", size: "480 KB" }
      ],
      messages: [
        { id: "msg-1", direction: "inbound", author: "Mauricio Lopez", body: "Hola, ¿tienen stock de trotadora profesional para entrega esta semana?", time: "09:14", tone: "gray", chips: [{ label: "inbound", tone: "gray" }] },
        { id: "msg-2", direction: "system", author: "CRM Brain", body: "AI SDR detectó intención comercial y sugiere validar stock antes de cotizar.", time: "09:15", tone: "amber", chips: [{ label: "system", tone: "amber" }, { label: "review", tone: "blue" }] },
        { id: "msg-3", direction: "outbound", author: "Admin User", body: "Hola Mauricio, reviso inventario y te confirmo disponibilidad hoy mismo.", time: "09:17", tone: "blue", chips: [{ label: "outbound", tone: "blue" }] },
        { id: "msg-4", direction: "inbound", author: "Mauricio Lopez", body: "Perfecto, quedo atento.", time: "09:21", tone: "gray", chips: [{ label: "client follow-up", tone: "gray" }] },
        { id: "msg-5", direction: "system", author: "CRM Brain", body: "Se detectó posible oportunidad secundaria en accesorios de alto margen.", time: "09:23", tone: "blue", chips: [{ label: "signal", tone: "blue" }] },
        { id: "msg-6", direction: "outbound", author: "Admin User", body: "También puedo revisar accesorios compatibles y enviarte un solo resumen.", time: "09:24", tone: "blue" },
        { id: "msg-7", direction: "inbound", author: "Mauricio Lopez", body: "Sí, me sirve. Si tienen banco ajustable también.", time: "09:27", tone: "gray" },
        { id: "msg-8", direction: "system", author: "Sistema", body: "Documento adjunto: cotizacion-preliminar.pdf", time: "09:28", tone: "green", chips: [{ label: "attachment", tone: "green" }] }
      ],
      action_queue: [
        { id: "aq-1", title: "Confirmar stock", due: "15m", status: "preview", preview: "Revisar disponibilidad antes de cotizar.", disabled: true },
        { id: "aq-2", title: "Preparar cotización", due: "45m", status: "preview", preview: "Generar borrador con margen mínimo.", disabled: true },
        { id: "aq-3", title: "Registrar seguimiento", due: "2h", status: "preview", preview: "Programar follow-up si no responde.", disabled: true }
      ],
      copilot: {
        summary: "El caso está listo para validar stock y luego proponer cotización.",
        next_action: "Confirmar stock y plazo de despacho.",
        rationale: "La intención comercial es clara, pero falta confirmar inventario antes de comprometer entrega.",
        evidence: ["Mensaje inbound preguntando por stock.", "Oportunidad vinculada en etapa de cotización.", "Sin aprobación requerida para la consulta de stock."],
        missing: ["Disponibilidad exacta por SKU", "Plazo de despacho estimado"],
        guardrails: ["No enviar mensaje real", "No confirmar stock sin fixture o backend real", "No mutar oportunidad"]
      },
      composer: {
        templates: ["Responder con validación de stock", "Pedir SKU específico", "Escalar a humano"],
        quick_actions: ["Abrir caso", "Ver oportunidad", "Ver cliente"]
      }
    },
    "demo-conversation-2": {
      id: "demo-conversation-2",
      customer: "Camila Rojas",
      identity: "56987554321",
      status: "Quote pending",
      owner: "Laura Perez",
      channel: "WhatsApp",
      linked_case: "CAS-3811 · Trotadora con falla",
      linked_opportunity: "OPP-1008 · Home Gym Pro - Cotización",
      source_systems: [
        { label: "WhatsApp", value: "Directo", tone: "green" },
        { label: "SAP", value: "Pendiente sync", tone: "amber" },
        { label: "CRM Brain", value: "Preview", tone: "amber" }
      ],
      notes: ["Descuento especial requiere revisión humana.", "Alta probabilidad de cierre si se responde hoy."],
      signals: [
        { label: "Intent", value: "Cotización formal", tone: "blue" },
        { label: "Risk", value: "Medio", tone: "amber" },
        { label: "Approval", value: "Requerida", tone: "red" }
      ],
      messages: [
        { id: "msg-1", direction: "inbound", author: "Camila Rojas", body: "Necesito el borrador de cotización con descuento especial.", time: "10:14", tone: "gray", chips: [{ label: "inbound", tone: "gray" }] },
        { id: "msg-2", direction: "system", author: "CRM Brain", body: "El descuento excede el umbral operativo, requiere revisión humana.", time: "10:15", tone: "amber", chips: [{ label: "approval", tone: "red" }] }
      ],
      action_queue: [
        { id: "aq-1", title: "Revisar descuento", due: "now", status: "review", preview: "Validar margen y política comercial.", disabled: true },
        { id: "aq-2", title: "Preparar cotización", due: "30m", status: "preview", preview: "Borrador condicionado a aprobación.", disabled: true }
      ],
      copilot: {
        summary: "La oportunidad necesita aprobación antes de enviar borrador.",
        next_action: "Revisar margen y aprobar o rechazar el descuento.",
        rationale: "El precio solicitado toca un guardrail de aprobación.",
        evidence: ["Descuento especial solicitado.", "Oportunidad en quote pending.", "Riesgo medio."],
        missing: ["Aprobación del supervisor", "Margen mínimo aceptable"],
        guardrails: ["No enviar propuesta real", "No aprobar automáticamente", "No alterar pricing"]
      },
      composer: {
        templates: ["Pedir aprobación", "Responder con espera", "Escalar a supervisor"],
        quick_actions: ["Abrir oportunidad", "Ver caso", "Ver cliente"]
      }
    },
    "demo-conversation-3": {
      id: "demo-conversation-3",
      customer: "Vanessa Reyes",
      identity: "56984567890",
      status: "Revisión requerida",
      owner: "Admin User",
      channel: "Email",
      linked_case: "CAS-7709 · Seguimiento catálogo",
      linked_opportunity: "OPP-7709 · Envío actualizado",
      source_systems: [
        { label: "Email", value: "Entrante", tone: "blue" },
        { label: "Marketing", value: "Segmento activo", tone: "green" },
        { label: "CRM Brain", value: "Preview", tone: "amber" }
      ],
      notes: ["Solicita catálogo actualizado.", "Potencial campaña de seguimiento."],
      signals: [
        { label: "Intent", value: "Actualización", tone: "blue" },
        { label: "Risk", value: "Bajo", tone: "green" },
        { label: "Approval", value: "No requerida", tone: "green" }
      ],
      messages: [
        { id: "msg-1", direction: "inbound", author: "Vanessa Reyes", body: "¿Podemos enviar catálogo actualizado y condiciones de pago?", time: "11:02", tone: "gray" },
        { id: "msg-2", direction: "system", author: "CRM Brain", body: "Sugerencia: enviar catálogo y pedir confirmación de presupuesto.", time: "11:03", tone: "blue" }
      ],
      action_queue: [
        { id: "aq-1", title: "Enviar catálogo", due: "1h", status: "preview", preview: "Compartir versión actualizada del catálogo.", disabled: true },
        { id: "aq-2", title: "Registrar preferencia", due: "1h", status: "preview", preview: "Marcar interés por condiciones de pago.", disabled: true }
      ],
      copilot: {
        summary: "Conviene responder con catálogo y una pregunta de calificación.",
        next_action: "Preparar respuesta de catálogo.",
        rationale: "No hay guardrail de aprobación para este caso, pero la acción sigue en preview.",
        evidence: ["Solicitud de catálogo.", "Interés por condiciones de pago."],
        missing: ["Fecha ideal de compra", "Volumen de unidades"],
        guardrails: ["No enviar correo real", "No generar campaña automática", "No mutar datos"]
      },
      composer: {
        templates: ["Enviar catálogo", "Preguntar presupuesto", "Escalar a marketing"],
        quick_actions: ["Ver oportunidad", "Ver cliente", "Crear seguimiento"]
      }
    }
  } satisfies Record<string, ConversationWorkspace>
} as const;

export const customerDirectoryFixture = {
  metrics: [
    { key: "resolved", title: "Identidades resueltas", value: "1,248", description: "88%", icon: "badge", tone: "green" },
    { key: "provisional", title: "Candidatos provisionales", value: "172", description: "12%", icon: "person_search", tone: "amber" },
    { key: "conflicts", title: "Conflictos de identidad", value: "23", description: "Revisión", icon: "merge_type", tone: "red" },
    { key: "activity", title: "Última actividad", value: "2m", description: "Actualizado", icon: "update", tone: "blue" }
  ] satisfies MetricCard[],
  rows: [
    { id: "demo-customer-1", client: "Camila Rojas", identity_state: "Provisional", source: "WhatsApp + PrestaShop", activity: "2m", status: "Activo", region: "Santiago", ltv: "CLP $2.7M", risk: "Medio", href: "/customers/demo-customer-1" },
    { id: "demo-customer-2", client: "Gimnasio Pacific", identity_state: "Resuelto", source: "PrestaShop + SAP", activity: "15m", status: "Atención", region: "Valparaíso", ltv: "CLP $8.4M", risk: "Bajo", href: "/customers/demo-customer-2" },
    { id: "demo-customer-3", client: "Mauricio Lopez", identity_state: "Conflicto", source: "WhatsApp + Email", activity: "1h", status: "Revisión", region: "Rancagua", ltv: "CLP $1.8M", risk: "Alto", href: "/customers/demo-customer-3" },
    { id: "demo-customer-4", client: "Renata Soto", identity_state: "Provisional", source: "WhatsApp + PrestaShop", activity: "28m", status: "Atención", region: "Santiago", ltv: "CLP $1.2M", risk: "Medio", href: "/customers/demo-customer-1" },
    { id: "demo-customer-5", client: "Andrés Ibarra", identity_state: "Resuelto", source: "Email + SAP", activity: "1.2h", status: "Activo", region: "Concepción", ltv: "CLP $4.6M", risk: "Bajo", href: "/customers/demo-customer-2" },
    { id: "demo-customer-6", client: "Marta León", identity_state: "Conflicto", source: "WhatsApp + POS", activity: "3h", status: "Revisión", region: "Puerto Montt", ltv: "CLP $1.5M", risk: "Alto", href: "/customers/demo-customer-3" },
    { id: "demo-customer-7", client: "José Fuentes", identity_state: "Provisional", source: "WhatsApp", activity: "5h", status: "Activo", region: "Talca", ltv: "CLP $900K", risk: "Medio", href: "/customers/demo-customer-1" },
    { id: "demo-customer-8", client: "Valentina Cruz", identity_state: "Resuelto", source: "Email + PrestaShop", activity: "8h", status: "Activo", region: "Viña del Mar", ltv: "CLP $6.1M", risk: "Bajo", href: "/customers/demo-customer-2" }
  ] satisfies CustomerRow[],
  selectedId: "demo-customer-1",
  profiles: {
    "demo-customer-1": {
      id: "demo-customer-1",
      name: "Camila Rojas",
      identity: "Customer candidate",
      contact: "56987554321 · camila@homegympro.cl",
      source: "WhatsApp + PrestaShop",
      rut: "12.345.678-9",
      region: "Santiago",
      last_activity: "2m",
      ltv: "CLP $2.7M",
      operational_health: "Alta",
      summary: "Cliente con identidad provisional pero alta confianza operativa.",
      commercial_summary: "Interés por equipamiento profesional y cotización formal.",
      notes: ["No existe customer master todavía.", "Confirmar vínculo entre WhatsApp y orden PrestaShop."],
      missing_data: ["Dirección exacta", "Factura principal"],
      source_systems: [
        { label: "WhatsApp", value: "Activo", tone: "green" },
        { label: "PrestaShop", value: "Orden #1021", tone: "blue" },
        { label: "SAP", value: "Pendiente", tone: "amber" }
      ],
      conversations: [
        { id: "conv-c1", title: "Conversación WhatsApp", subtitle: "Solicitud de cotización formal", time: "2m ago", tone: "green" },
        { id: "conv-c2", title: "Email", subtitle: "Catálogo actualizado", time: "1h ago", tone: "blue" },
        { id: "conv-c5", title: "WhatsApp seguimiento", subtitle: "Pide banco ajustable", time: "3h ago", tone: "amber" }
      ],
      opportunities: [
        { id: "opp-c1", title: "Home Gym Pro", subtitle: "Quote pending", time: "hoy", tone: "amber" },
        { id: "opp-c2", title: "Accesorios compatibles", subtitle: "Cross-sell sugerido", time: "3h ago", tone: "blue" }
      ],
      cases: [
        { id: "case-c1", title: "Trotadora con falla", subtitle: "Postventa", time: "ayer", tone: "red" },
        { id: "case-c2", title: "Garantía de motor", subtitle: "En revisión", time: "3d ago", tone: "amber" }
      ],
      actions: [
        { id: "action-c1", title: "Preparar cotización", subtitle: "Preview only", time: "15m", tone: "blue" },
        { id: "action-c2", title: "Validar stock", subtitle: "Preview only", time: "1h", tone: "amber" }
      ]
    },
    "demo-customer-2": {
      id: "demo-customer-2",
      name: "Gimnasio Pacific",
      identity: "Resolved customer",
      contact: "56981234567 · contacto@gimnasiopacific.cl",
      source: "PrestaShop + SAP",
      rut: "76.543.210-5",
      region: "Valparaíso",
      last_activity: "15m",
      ltv: "CLP $8.4M",
      operational_health: "Alta",
      summary: "Cliente resuelto con trazabilidad clara entre venta y postventa.",
      commercial_summary: "Cuenta con oportunidad activa y caso en progreso.",
      notes: ["Alinear inventario con despacho.", "Mantener un solo registro principal."],
      missing_data: ["Teléfono alternativo"],
      source_systems: [
        { label: "PrestaShop", value: "Conectado", tone: "green" },
        { label: "SAP", value: "Conectado", tone: "green" },
        { label: "WhatsApp", value: "Conectado", tone: "green" }
      ],
      conversations: [{ id: "conv-c3", title: "Inbox de soporte", subtitle: "Trotadora con falla", time: "15m ago", tone: "red" }],
      opportunities: [{ id: "opp-c2", title: "Mantenimiento anual", subtitle: "Negotiation", time: "hoy", tone: "blue" }],
      cases: [{ id: "case-c2", title: "Trotadora con falla", subtitle: "Abierto", time: "15m", tone: "amber" }],
      actions: [{ id: "action-c2", title: "Escalar soporte", subtitle: "Human required", time: "30m", tone: "red" }]
    },
    "demo-customer-3": {
      id: "demo-customer-3",
      name: "Mauricio Lopez",
      identity: "Conflict customer",
      contact: "56983456789 · mauro@lopez.cl",
      source: "WhatsApp + Email",
      rut: "77.123.456-1",
      region: "Rancagua",
      last_activity: "1h",
      ltv: "CLP $1.8M",
      operational_health: "Atención",
      summary: "Se detectó conflicto entre señales de contacto y order mapping.",
      commercial_summary: "Requiere revisión de identidad antes de nuevas acciones.",
      notes: ["Duplicado posible.", "Necesita merge review."],
      missing_data: ["Confirmación de email", "Número de pedido principal"],
      source_systems: [
        { label: "WhatsApp", value: "Activa", tone: "blue" },
        { label: "Email", value: "Activa", tone: "blue" },
        { label: "PrestaShop", value: "Con conflicto", tone: "red" }
      ],
      conversations: [{ id: "conv-c4", title: "Consulta de stock", subtitle: "Sin resolver", time: "1h ago", tone: "amber" }],
      opportunities: [],
      cases: [{ id: "case-c3", title: "Identidad duplicada", subtitle: "Revisión", time: "1h", tone: "red" }],
      actions: [{ id: "action-c3", title: "Revisar identidad", subtitle: "Blocked", time: "1h", tone: "red" }]
    }
  } satisfies Record<string, CustomerProfile>
} as const;

export const opportunityInboxFixture = {
  metrics: [
    { key: "pipeline", title: "Pipeline comercial", value: "CLP $14.2M", description: "Resumen", icon: "payments", tone: "green" },
    { key: "pending", title: "Quote pending", value: "05", description: "Activas", icon: "receipt_long", tone: "amber" },
    { key: "approvals", title: "Aprobaciones", value: "03", description: "Requeridas", icon: "verified_user", tone: "red" },
    { key: "wins", title: "Won", value: "14", description: "Cerradas", icon: "task_alt", tone: "blue" }
  ] satisfies MetricCard[],
  rows: [
    { id: "demo-opportunity-1", customer: "Camila Rojas", stage: "Quote pending", status: "Revisión requerida", estimated_value: "CLP $2.7M", activity: "2m", next_action: "Aprobar cotización", owner: "Admin User", risk: "Medio", href: "/opportunities/demo-opportunity-1" },
    { id: "demo-opportunity-2", customer: "Home Gym Pro", stage: "Qualifying", status: "En progreso", estimated_value: "CLP $3.4M", activity: "15m", next_action: "Validar inventario", owner: "Laura Perez", risk: "Bajo", href: "/opportunities/demo-opportunity-2" },
    { id: "demo-opportunity-3", customer: "Equipamiento CrossFit", stage: "Negotiation", status: "Esperando cliente", estimated_value: "CLP $2.0M", activity: "1h", next_action: "Enviar propuesta", owner: "Admin User", risk: "Medio", href: "/opportunities/demo-opportunity-3" },
    { id: "demo-opportunity-4", customer: "Renata Soto", stage: "New", status: "En progreso", estimated_value: "CLP $1.4M", activity: "5m", next_action: "Calificar necesidad", owner: "Laura Perez", risk: "Bajo", href: "/opportunities/demo-opportunity-2" },
    { id: "demo-opportunity-5", customer: "Andrés Ibarra", stage: "Engaged", status: "En progreso", estimated_value: "CLP $1.8M", activity: "25m", next_action: "Enviar comparativa", owner: "Admin User", risk: "Bajo", href: "/opportunities/demo-opportunity-3" },
    { id: "demo-opportunity-6", customer: "Marta León", stage: "Quote pending", status: "Revisión requerida", estimated_value: "CLP $2.1M", activity: "45m", next_action: "Solicitar aprobación", owner: "Laura Perez", risk: "Medio", href: "/opportunities/demo-opportunity-1" },
    { id: "demo-opportunity-7", customer: "José Fuentes", stage: "Waiting customer", status: "Esperando cliente", estimated_value: "CLP $1.1M", activity: "3h", next_action: "Recordatorio", owner: "Admin User", risk: "Medio", href: "/opportunities/demo-opportunity-2" },
    { id: "demo-opportunity-8", customer: "Valentina Cruz", stage: "Won", status: "Cerrada", estimated_value: "CLP $4.0M", activity: "1d", next_action: "Upsell", owner: "Laura Perez", risk: "Bajo", href: "/opportunities/demo-opportunity-3" }
  ] satisfies OpportunityRow[],
  selectedId: "demo-opportunity-1",
  workspaces: {
    "demo-opportunity-1": {
      id: "demo-opportunity-1",
      customer: "Camila Rojas",
      stage: "Quote pending",
      status: "Revisión requerida",
      amount: "CLP $2.7M",
      source: "WhatsApp + PrestaShop",
      owner: "Admin User",
      last_activity: "2m",
      needs: ["Cotización formal", "Descuento especial", "Despacho rápido"],
      products: ["Trotadora profesional", "Banco de pesas", "Accesorios"],
      budget: "$2.7M",
      location: "Santiago",
      objections: ["Precio", "Tiempo de entrega"],
      requirements: ["Aprobación de descuento", "Confirmar stock"],
      next_step: "Revisar descuento y generar borrador de cotización",
      timeline: [
        { id: "opp-t1", title: "Lead recibido", subtitle: "WhatsApp inbound", time: "09:10", tone: "green" },
        { id: "opp-t2", title: "Stage actualizado", subtitle: "Quote pending", time: "09:14", tone: "blue" },
        { id: "opp-t3", title: "Revisión humana", subtitle: "Discount guardrail hit", time: "09:16", tone: "amber" },
        { id: "opp-t4", title: "Borrador preparado", subtitle: "Cotización condicionada", time: "09:22", tone: "blue" },
        { id: "opp-t5", title: "Follow-up programado", subtitle: "Recordatorio de aprobación", time: "09:40", tone: "gray" },
        { id: "opp-t6", title: "Propuesta revisada", subtitle: "Pendiente de envío", time: "10:05", tone: "amber" }
      ],
      quote: { number: "Q-1008", status: "Draft", amount: "CLP $2.7M", issued: "Hoy", expiry: "48h" },
      copilot: {
        summary: "La oportunidad está lista para revisión de descuento.",
        next_action: "Aprobar o rechazar el borrador.",
        risk: "Medio",
        approval: "Requerida",
        evidence: ["Solicitud de cotización formal", "Descuento especial", "Oportunidad en quote pending"]
      },
      actions: [
        { label: "Revisar", state: "preview", disabled: true },
        { label: "Aprobar", state: "blocked", disabled: true },
        { label: "Rechazar", state: "blocked", disabled: true },
        { label: "Programar", state: "preview", disabled: true }
      ]
    },
    "demo-opportunity-2": {
      id: "demo-opportunity-2",
      customer: "Home Gym Pro",
      stage: "Qualifying",
      status: "En progreso",
      amount: "CLP $3.4M",
      source: "Web + WhatsApp",
      owner: "Laura Perez",
      last_activity: "15m",
      needs: ["Cotización final", "Instalación", "Garantía extendida"],
      products: ["Elíptica", "Banca ajustable"],
      budget: "$3.4M",
      location: "Viña del Mar",
      objections: ["Tiempo de despacho"],
      requirements: ["Confirmar dirección", "Validar pago"],
      next_step: "Enviar resumen comercial",
      timeline: [
        { id: "opp2-t1", title: "Lead recibido", subtitle: "Campaign", time: "hoy", tone: "blue" },
        { id: "opp2-t2", title: "Calificación", subtitle: "Needs confirmed", time: "15m", tone: "green" }
      ],
      quote: { number: "Q-2001", status: "Preview", amount: "CLP $3.4M", issued: "Hoy", expiry: "72h" },
      copilot: {
        summary: "Oportunidad con alto potencial y pocas objeciones.",
        next_action: "Preparar cotización preliminar.",
        risk: "Bajo",
        approval: "No requerida",
        evidence: ["Interés confirmado", "Presupuesto compatible"],
      },
      actions: [
        { label: "Revisar", state: "preview", disabled: true },
        { label: "Aprobar", state: "preview", disabled: true },
        { label: "Rechazar", state: "preview", disabled: true },
        { label: "Programar", state: "preview", disabled: true }
      ]
    },
    "demo-opportunity-3": {
      id: "demo-opportunity-3",
      customer: "Equipamiento CrossFit",
      stage: "Negotiation",
      status: "Esperando cliente",
      amount: "CLP $2.0M",
      source: "WhatsApp",
      owner: "Admin User",
      last_activity: "1h",
      needs: ["Cierre", "Instalación", "Condiciones de pago"],
      products: ["Rack", "Mancuernas", "Suelos de goma"],
      budget: "$2.0M",
      location: "Concepción",
      objections: ["Condiciones", "Plazo"],
      requirements: ["Respuesta en 24h"],
      next_step: "Enviar propuesta final",
      timeline: [
        { id: "opp3-t1", title: "Propuesta enviada", subtitle: "Draft", time: "1h", tone: "amber" }
      ],
      quote: { number: "Q-3003", status: "Pending", amount: "CLP $2.0M", issued: "Ayer", expiry: "24h" },
      copilot: {
        summary: "Falta respuesta del cliente para cerrar.",
        next_action: "Recordatorio de seguimiento.",
        risk: "Medio",
        approval: "No requerida",
        evidence: ["Propuesta enviada", "Cliente en negociación"]
      },
      actions: [
        { label: "Revisar", state: "preview", disabled: true },
        { label: "Aprobar", state: "preview", disabled: true },
        { label: "Rechazar", state: "preview", disabled: true },
        { label: "Programar", state: "preview", disabled: true }
      ]
    }
  } satisfies Record<string, OpportunityWorkspace>
} as const;

export const actionQueueFixture = {
  metrics: [
    { key: "pending", title: "Pendientes", value: "21", description: "Por revisar", icon: "queue", tone: "amber" },
    { key: "review", title: "Requieren revisión", value: "07", description: "Approval", icon: "verified_user", tone: "red" },
    { key: "blocked", title: "Blocked", value: "03", description: "Guardrails", icon: "block", tone: "red" },
    { key: "scheduled", title: "Programadas", value: "11", description: "Hoy", icon: "schedule", tone: "blue" }
  ] satisfies MetricCard[],
  rows: [
    { id: "demo-action-1", client: "Camila Rojas", related_entity: "OPP-1008", status: "Revisión requerida", risk: "Medio", approval: "Requerida", origin: "AI SDR", schedule: "Ahora", owner: "Admin User", href: "/actions/demo-action-1" },
    { id: "demo-action-2", client: "Mauricio Lopez", related_entity: "CONV-5567", status: "Preview", risk: "Bajo", approval: "No requerida", origin: "Follow-up planner", schedule: "15m", owner: "Laura Perez", href: "/actions/demo-action-2" },
    { id: "demo-action-3", client: "Vanessa Reyes", related_entity: "ACT-7709", status: "Blocked", risk: "Bajo", approval: "No requerida", origin: "Marketing", schedule: "1h", owner: "Admin User", href: "/actions/demo-action-3" },
    { id: "demo-action-4", client: "Renata Soto", related_entity: "OPP-2010", status: "Preview", risk: "Bajo", approval: "No requerida", origin: "AI SDR", schedule: "30m", owner: "Laura Perez", href: "/actions/demo-action-1" },
    { id: "demo-action-5", client: "Andrés Ibarra", related_entity: "CONV-7712", status: "Revisión requerida", risk: "Medio", approval: "Requerida", origin: "Campaign manager", schedule: "45m", owner: "Admin User", href: "/actions/demo-action-1" },
    { id: "demo-action-6", client: "Marta León", related_entity: "CASE-4470", status: "Blocked", risk: "Alto", approval: "Requerida", origin: "Case bot", schedule: "1h", owner: "Laura Perez", href: "/actions/demo-action-3" },
    { id: "demo-action-7", client: "José Fuentes", related_entity: "OPP-2011", status: "Preview", risk: "Bajo", approval: "No requerida", origin: "Follow-up planner", schedule: "2h", owner: "Admin User", href: "/actions/demo-action-2" },
    { id: "demo-action-8", client: "Valentina Cruz", related_entity: "KB-101", status: "Programada", risk: "Bajo", approval: "No requerida", origin: "Knowledge", schedule: "Hoy 18:00", owner: "Laura Perez", href: "/actions/demo-action-2" }
  ] satisfies ActionRow[],
  selectedId: "demo-action-1",
  details: {
    "demo-action-1": {
      id: "demo-action-1",
      client: "Camila Rojas",
      related_entity: "OPP-1008 · Home Gym Pro - Cotización",
      lifecycle: ["Draft", "Ready for review", "Awaiting approval", "Scheduled"],
      rationale: "La acción prepara un borrador de cotización con guardrail de aprobación.",
      evidence: ["Solicitud explícita de cotización", "Descuento especial", "Opportunity en quote pending"],
      missing: ["Aprobación supervisor", "Margen mínimo"],
      eligibility: ["Preview only", "No write", "No send"],
      guardrails: ["No enviar propuesta real", "No mutar opportunity", "No persistir approval"],
      preview: "Borrador de cotización con descuento condicionado a revisión humana."
    },
    "demo-action-2": {
      id: "demo-action-2",
      client: "Mauricio Lopez",
      related_entity: "CONV-5567 · Consulta stock",
      lifecycle: ["Draft", "Planned"],
      rationale: "Seguimiento automático sugerido por la conversación.",
      evidence: ["Interés por stock", "Esperando respuesta del cliente"],
      missing: ["SKU exacto"],
      eligibility: ["Preview only", "No write"],
      guardrails: ["No programar envío real"],
      preview: "Recordatorio de seguimiento en caso de no recibir respuesta."
    },
    "demo-action-3": {
      id: "demo-action-3",
      client: "Vanessa Reyes",
      related_entity: "ACT-7709 · Catálogo actualizado",
      lifecycle: ["Blocked", "Needs review"],
      rationale: "La acción queda bloqueada por falta de aprobación de marketing.",
      evidence: ["Solicita catálogo", "Campaña asociada"],
      missing: ["Aprobación de segmento"],
      eligibility: ["Preview only"],
      guardrails: ["No envío real", "No crear campaña real"],
      preview: "Borrador de envío de catálogo con estado bloqueado."
    }
  } satisfies Record<string, ActionDetail>
} as const;
