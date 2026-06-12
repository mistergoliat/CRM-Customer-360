export type ModuleStatus = "active" | "partial" | "preview" | "disabled";

export type HubModule = {
  key: string;
  label: string;
  href: string;
  status: ModuleStatus;
  icon: string;
  group: "core" | "future" | "ops";
  navVisible?: boolean;
};

export const modules: HubModule[] = [
  { key: "dashboard", label: "Home", href: "/dashboard", status: "active", icon: "home", group: "core", navVisible: true },
  { key: "cases", label: "Casos", href: "/cases", status: "active", icon: "assignment", group: "core", navVisible: true },
  { key: "chats", label: "Chats", href: "/chats", status: "partial", icon: "forum", group: "core", navVisible: false },
  { key: "whatsapp", label: "WhatsApp", href: "/whatsapp", status: "partial", icon: "chat", group: "core", navVisible: false },
  { key: "customers", label: "Customers", href: "/customers", status: "preview", icon: "groups", group: "future", navVisible: true },
  { key: "customer-master", label: "Customer Master", href: "/customer-master", status: "preview", icon: "badge", group: "future", navVisible: false },
  { key: "mailing", label: "Mailing", href: "/mailing", status: "preview", icon: "mail_lock", group: "future", navVisible: false },
  { key: "knowledge", label: "Knowledge", href: "/knowledge", status: "preview", icon: "database", group: "future", navVisible: true },
  { key: "agents", label: "Agents", href: "/agents", status: "preview", icon: "smart_toy", group: "future", navVisible: false },
  { key: "analytics", label: "Analytics", href: "/analytics", status: "preview", icon: "monitoring", group: "future", navVisible: true },
  { key: "audit", label: "Audit", href: "/audit", status: "active", icon: "policy", group: "ops", navVisible: false },
  { key: "system", label: "System", href: "/system", status: "active", icon: "health_and_safety", group: "ops", navVisible: false },
  { key: "settings", label: "Settings", href: "/settings", status: "partial", icon: "settings", group: "ops", navVisible: true }
];

export function getModuleByHref(pathname: string) {
  return modules.find((module) => pathname === module.href || pathname.startsWith(`${module.href}/`));
}
