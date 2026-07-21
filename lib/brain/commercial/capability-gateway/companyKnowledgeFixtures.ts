/**
 * ACS-R1-05.1-T02.1. NON-PRODUCTIVE fixture content for `search_company_knowledge`.
 *
 * No verified, published PesasChile business content (real hours, real
 * payment methods, real coverage) exists anywhere in this repository today -
 * confirmed by inspection before writing this file (AGENTS.md: "no inventar
 * fuentes de datos no observadas en el repo"). Every entry below is a
 * clearly-labeled placeholder so the MVP loop can be built and tested; the
 * capability must stay `operational: not_verified` /
 * `state: designed_partial` in CAPABILITY_MATRIX.md until each entry is
 * replaced with content confirmed by the business, at which point
 * `verified` flips to `true` per entry.
 */

export type CompanyKnowledgeEntry = {
  topic: string;
  keywords: string[];
  answer: string;
  source: string;
  /** false = placeholder fixture, never presented to a real customer as fact. */
  verified: boolean;
};

export const COMPANY_KNOWLEDGE_FIXTURES: CompanyKnowledgeEntry[] = [
  {
    topic: "horarios_atencion",
    keywords: ["horario", "hora", "atencion", "abren", "abierto", "cierran", "lunes", "sabado", "domingo"],
    answer: "[FIXTURE NO VERIFICADO] Horario de atencion pendiente de confirmacion por el negocio.",
    source: "fixture:company-knowledge:horarios_atencion",
    verified: false
  },
  {
    topic: "canales_atencion",
    keywords: ["canal", "canales", "contacto", "whatsapp", "telefono", "correo", "email"],
    answer: "[FIXTURE NO VERIFICADO] Canales de atencion pendientes de confirmacion por el negocio.",
    source: "fixture:company-knowledge:canales_atencion",
    verified: false
  },
  {
    topic: "cobertura_ubicacion",
    keywords: ["ubicacion", "direccion", "sucursal", "tienda", "cobertura", "region", "ciudad"],
    answer: "[FIXTURE NO VERIFICADO] Ubicacion y cobertura pendientes de confirmacion por el negocio.",
    source: "fixture:company-knowledge:cobertura_ubicacion",
    verified: false
  },
  {
    topic: "medios_pago",
    keywords: ["pago", "pagos", "tarjeta", "transferencia", "efectivo", "cuotas"],
    answer: "[FIXTURE NO VERIFICADO] Medios de pago pendientes de confirmacion por el negocio.",
    source: "fixture:company-knowledge:medios_pago",
    verified: false
  },
  {
    topic: "politicas_comerciales",
    keywords: ["politica", "politicas", "garantia", "cambio", "devolucion"],
    answer: "[FIXTURE NO VERIFICADO] Politicas comerciales informativas pendientes de confirmacion por el negocio.",
    source: "fixture:company-knowledge:politicas_comerciales",
    verified: false
  },
  {
    topic: "despacho_general",
    keywords: ["despacho", "envio", "envios", "entrega", "delivery"],
    answer: "[FIXTURE NO VERIFICADO] Informacion general de despacho pendiente de confirmacion por el negocio.",
    source: "fixture:company-knowledge:despacho_general",
    verified: false
  },
  {
    topic: "contacto_humano",
    keywords: ["humano", "persona", "operador", "ejecutivo", "hablar con alguien", "agente humano"],
    answer: "[FIXTURE NO VERIFICADO] Procedimiento de contacto humano pendiente de confirmacion por el negocio.",
    source: "fixture:company-knowledge:contacto_humano",
    verified: false
  }
];
