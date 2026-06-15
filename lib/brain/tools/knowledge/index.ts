export type BrainKnowledgePolicy = {
  agentName: "knowledge";
  version: string;
  allowedTopics: string[];
  disallowedTopics: string[];
  confidenceFloor: number;
  noPromiseRules: string[];
};

export type BrainStaticBusinessInfo = {
  businessHours: string | null;
  businessLocation: string | null;
  paymentMethods: string[];
  pickupInfo: string | null;
  faq: Array<{
    question: string;
    answer: string;
    sources: string[];
  }>;
  sources: string[];
};

const STATIC_BUSINESS_INFO: BrainStaticBusinessInfo = {
  businessHours: "Lunes a viernes 09:00 a 17:00",
  businessLocation: null,
  paymentMethods: [],
  pickupInfo: null,
  faq: [
    {
      question: "horario de atencion",
      answer: "Atencion humana disponible de lunes a viernes de 09:00 a 17:00.",
      sources: ["docs/sprint-1-postventa-implementation.md"]
    }
  ],
  sources: ["docs/sprint-1-postventa-implementation.md"]
};

const KNOWLEDGE_POLICY: BrainKnowledgePolicy = {
  agentName: "knowledge",
  version: "brain.knowledge.policy.v1",
  allowedTopics: ["horario", "ubicacion", "retiro", "medios de pago", "faq", "politicas generales"],
  disallowedTopics: ["precio", "stock", "descuento", "garantia", "devolucion", "pedido", "armado", "mantencion", "reclamo"],
  confidenceFloor: 0.55,
  noPromiseRules: [
    "No inventar stock, precio, descuentos, garantias ni estados de pedido.",
    "No prometer tiempos de respuesta fuera de lo documentado.",
    "No responder fuera de conocimiento general sin fuente segura."
  ]
};

export function getStaticBusinessInfo() {
  return STATIC_BUSINESS_INFO;
}

export function getKnowledgePolicy() {
  return KNOWLEDGE_POLICY;
}

export function searchKnowledge(query: string) {
  const normalized = query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const hits = STATIC_BUSINESS_INFO.faq.filter((item) => normalized.includes(item.question));
  return {
    query,
    hits,
    sourceCount: hits.length > 0 ? hits.length : 0
  };
}
