import type { KeyValueField, MetricCard, TableRow } from "../types";

type IntegrationRow = TableRow & {
  type: string;
  status: string;
  synced: string;
  coverage: string;
  latency: string;
  warning: string;
  data: string;
};

export const integrationsFixture = {
  metrics: [
    { key: "connected", title: "Conectadas", value: "5", description: "Activas", icon: "hub", tone: "green" },
    { key: "partial", title: "Parciales", value: "1", description: "Con warning", icon: "schedule", tone: "amber" },
    { key: "delayed", title: "Retrasadas", value: "1", description: "Requiere atención", icon: "warning", tone: "red" },
    { key: "data", title: "Cobertura", value: "92%", description: "Datos disponibles", icon: "database", tone: "blue" }
  ] satisfies MetricCard[],
  rows: [
    { id: "int-1", name: "PrestaShop", type: "E-commerce", status: "Connected", synced: "2m", coverage: "98%", latency: "12m", warning: "Ninguna", data: "Órdenes, clientes, carritos", href: "/integrations?integration=int-1" },
    { id: "int-2", name: "WhatsApp / Meta", type: "Mensajería", status: "Connected", synced: "5m", coverage: "100%", latency: "3m", warning: "Ninguna", data: "Mensajes y plantillas", href: "/integrations?integration=int-2" },
    { id: "int-3", name: "SAP Business One", type: "ERP", status: "Delayed", synced: "12m", coverage: "76%", latency: "12m", warning: "Retraso de sincronización", data: "Stock, órdenes, facturas", href: "/integrations?integration=int-3" },
    { id: "int-4", name: "POS", type: "Punto de venta", status: "Connected", synced: "3m", coverage: "88%", latency: "6m", warning: "Ninguna", data: "Ventas y devolución", href: "/integrations?integration=int-4" },
    { id: "int-5", name: "Preventa", type: "Front office", status: "Connected", synced: "5m", coverage: "90%", latency: "4m", warning: "Ninguna", data: "Leads y oportunidades", href: "/integrations?integration=int-5" },
    { id: "int-6", name: "CRM Brain", type: "Core", status: "Connected", synced: "Now", coverage: "Preview", latency: "0m", warning: "Sandbox", data: "Read models y fixtures", href: "/integrations?integration=int-6" }
  ] satisfies IntegrationRow[],
  selected: {
    name: "SAP Business One",
    status: "Delayed",
    coverage: "76%",
    synced: "12m",
    latency: "12m",
    warning: "Retraso de sincronización",
    data: ["Stock", "Órdenes", "Facturas", "Clientes"],
    notes: ["No fingir conectividad real.", "El retraso es visible para el operador.", "No hay write path en esta fase."]
  }
} as const;

export const settingsFixture = {
  users: [
    { label: "Operador", value: "28", tone: "green" },
    { label: "Supervisor", value: "8", tone: "blue" },
    { label: "Administrador", value: "4", tone: "amber" },
    { label: "AI SDR Operator", value: "3", tone: "blue" }
  ] as KeyValueField[],
  channels: [
    { label: "WhatsApp", value: "Activo" },
    { label: "Email", value: "Activo" },
    { label: "Web / Preventa", value: "Activo" },
    { label: "PrestaShop", value: "Activo" },
    { label: "Telefonía", value: "Parcial" }
  ] as KeyValueField[],
  environment: [
    { label: "Producción", value: "Activo" },
    { label: "Sandbox", value: "Inactivo" },
    { label: "Último deploy", value: "22-06-26, 8:15 a. m." },
    { label: "Versión", value: "v2.14.3" }
  ] as KeyValueField[],
  governance: [
    { label: "Acciones automáticas", value: "Permitidas con restricciones" },
    { label: "Aprobación requerida", value: "Casos de riesgo medio y alto" },
    { label: "Ventana de ejecución", value: "08:00 - 20:00 (Lun - Vie)" },
    { label: "Reintentos por error", value: "3 intentos con backoff exponencial" }
  ] as KeyValueField[],
  featureFlags: [
    { label: "AI SDR Copilot", value: "Activo" },
    { label: "Follow-up Planner", value: "Activo" },
    { label: "Sandbox Eligibility", value: "Activo" },
    { label: "Shadow Review", value: "Preview" },
    { label: "Voice Channel", value: "Parcial" }
  ] as KeyValueField[],
  modules: [
    { label: "Home", value: "Activo" },
    { label: "Conversaciones", value: "Activo" },
    { label: "Clientes", value: "Activo" },
    { label: "Oportunidades", value: "Activo" },
    { label: "Casos", value: "Activo" },
    { label: "Acciones", value: "Preview" },
    { label: "Knowledge", value: "Preview" },
    { label: "Analytics", value: "Preview" },
    { label: "Integraciones", value: "Parcial" }
  ] as KeyValueField[],
  security: [
    { label: "SSO", value: "SAML 2.0" },
    { label: "2FA obligatorio", value: "Activo" },
    { label: "Cifrado en tránsito", value: "TLS 1.2+" },
    { label: "Cifrado en reposo", value: "AES-256" },
    { label: "Auditoría", value: "Registro completo de actividad" }
  ] as KeyValueField[],
  notifications: [
    { label: "Email", value: "Alertas críticas y reportes" },
    { label: "WhatsApp", value: "Alertas operativas" },
    { label: "In-App", value: "Tareas y menciones" },
    { label: "Webhook", value: "Integraciones y eventos" }
  ] as KeyValueField[],
  dataIdentity: [
    { label: "CRM fuente", value: "PrestaShop API" },
    { label: "Base de datos", value: "PostgreSQL (CRM Brain)" },
    { label: "Sincronización global", value: "14:02:11 (hace 2 min)" },
    { label: "Identidad unificada", value: "Activa" },
    { label: "Resolución de identidad", value: "Automática por email, teléfono y RUT" }
  ] as KeyValueField[]
};
