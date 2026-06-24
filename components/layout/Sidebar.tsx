"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { modules } from "@/lib/modules";
import { labelForModuleStatus } from "@/lib/status";
import { Icon } from "@/components/ui/Icon";

const groups = [
  { key: "operations", label: "Operación" },
  { key: "crm", label: "CRM" },
  { key: "growth", label: "Crecimiento" },
  { key: "intelligence", label: "Inteligencia" },
  { key: "system", label: "Sistema" }
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-sidebar-width flex-col border-r border-white/10 bg-sidebar text-white shadow-[12px_0_40px_-28px_rgba(15,23,42,0.7)] lg:flex">
      <div className="px-5 pb-5 pt-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-white shadow-lg shadow-primary/35">
            <Icon name="hub" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-headline-md text-white">PesasChile HUB</h1>
              <span className="rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-200">
                P1M
              </span>
            </div>
            <p className="mt-0.5 text-body-md font-medium text-surface-variant/80">AI Operations</p>
          </div>
        </div>
      </div>

      <nav className="mt-6 flex-1 space-y-6 overflow-y-auto px-2">
        {groups.map((group) => {
          const visibleModules = modules.filter((module) => module.group === group.key && module.navVisible !== false);
          if (visibleModules.length === 0) return null;

          return (
            <div key={group.key}>
              <p className="mb-2 px-4 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{group.label}</p>
              <div className="space-y-1">
                {visibleModules.map((module) => {
                  const active = pathname === module.href || pathname.startsWith(`${module.href}/`);
                  return (
                    <Link
                      key={module.key}
                      href={module.href}
                      className={clsx(
                        "flex items-center gap-3 rounded-2xl px-4 py-3 text-body-md transition",
                        active ? "bg-primary text-white shadow-lg shadow-primary/25" : "text-tertiary-fixed-dim hover:bg-white/10 hover:text-white"
                      )}
                    >
                      <Icon name={module.icon} />
                      <span className="min-w-0 flex-1 font-bold">{module.label}</span>
                      {module.status !== "active" ? (
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-200">
                          {labelForModuleStatus(module.status)}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="mx-4 mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
        <p className="text-label-bold uppercase text-slate-300">Continuidad operacional</p>
        <p className="mt-2 text-label-sm text-slate-400">Webapp independiente de flujos n8n para casos críticos.</p>
      </div>

      <div className="mx-4 my-4 rounded-2xl border border-white/10 bg-sidebar-soft px-4 py-3">
        <p className="text-label-bold uppercase text-slate-300">Usuario</p>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div>
            <p className="text-body-md font-semibold text-white">Admin User</p>
            <p className="text-label-sm text-slate-400">Operador · Producción</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-fixed text-primary font-bold">AU</div>
        </div>
      </div>
    </aside>
  );
}
