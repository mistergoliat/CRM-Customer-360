export type ModuleStatus = "active" | "partial" | "preview" | "disabled";

export type HubModule = {
  key: string;
  label: string;
  href: string;
  status: ModuleStatus;
  icon: string;
  group: "operations" | "crm" | "growth" | "intelligence" | "system" | "legacy";
  navVisible?: boolean;
};

export const modules: HubModule[] = [
  { key: "dashboard", label: "Home", href: "/dashboard", status: "active", icon: "home", group: "operations", navVisible: true },
  { key: "conversations", label: "Conversaciones", href: "/conversations", status: "preview", icon: "forum", group: "operations", navVisible: true },
  { key: "cases", label: "Casos", href: "/cases", status: "active", icon: "assignment", group: "operations", navVisible: true },
  { key: "customers", label: "Clientes", href: "/customers", status: "preview", icon: "groups", group: "crm", navVisible: true },
  { key: "opportunities", label: "Oportunidades", href: "/opportunities", status: "preview", icon: "point_of_sale", group: "crm", navVisible: true },
  { key: "actions", label: "Acciones", href: "/actions", status: "preview", icon: "playlist_add_check", group: "crm", navVisible: true },
  { key: "marketing", label: "Marketing", href: "/marketing", status: "preview", icon: "campaign", group: "growth", navVisible: true },
  { key: "knowledge", label: "Knowledge", href: "/knowledge", status: "preview", icon: "book_5", group: "intelligence", navVisible: true },
  { key: "analytics", label: "Analytics", href: "/analytics", status: "preview", icon: "monitoring", group: "intelligence", navVisible: true },
  { key: "integrations", label: "Integraciones", href: "/integrations", status: "partial", icon: "hub", group: "system", navVisible: true },
  { key: "settings", label: "Settings", href: "/settings", status: "partial", icon: "settings", group: "system", navVisible: true },
  { key: "chats", label: "Chats", href: "/chats", status: "partial", icon: "chat", group: "legacy", navVisible: false },
  { key: "whatsapp", label: "WhatsApp", href: "/whatsapp", status: "partial", icon: "sms", group: "legacy", navVisible: false },
  { key: "customer-master", label: "Customer Master", href: "/customer-master", status: "preview", icon: "badge", group: "legacy", navVisible: false },
  { key: "mailing", label: "Mailing", href: "/mailing", status: "preview", icon: "mail_lock", group: "legacy", navVisible: false },
  { key: "agents", label: "Agents", href: "/agents", status: "preview", icon: "smart_toy", group: "legacy", navVisible: false },
  { key: "audit", label: "Audit", href: "/audit", status: "active", icon: "policy", group: "legacy", navVisible: false },
  { key: "system", label: "System", href: "/system", status: "active", icon: "health_and_safety", group: "legacy", navVisible: false }
];

export function getModuleByHref(pathname: string) {
  return modules.find((module) => pathname === module.href || pathname.startsWith(`${module.href}/`));
}
