"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { modules } from "@/lib/modules";
import { labelForModuleStatus } from "@/lib/status";
import { Icon } from "@/components/ui/Icon";

const groups = [
  { key: "core", label: "Operación" },
  { key: "future", label: "CRM futuro" },
  { key: "ops", label: "Sistema" }
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-sidebar-width flex-col bg-sidebar py-6 text-white lg:flex">
      <div className="px-6">
        <h1 className="text-headline-lg text-white">PesasChile HUB</h1>
        <p className="text-body-md text-surface-variant/70">AI Operations</p>
      </div>

      <nav className="mt-8 flex-1 space-y-6 overflow-y-auto px-2">
        {groups.map((group) => (
          (() => {
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
                          "flex items-center gap-3 rounded-lg px-4 py-3 text-body-md transition",
                          active
                            ? "bg-primary text-white shadow-lg"
                            : "text-tertiary-fixed-dim hover:bg-white/10 hover:text-white"
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
          })()
        ))}
      </nav>

      <div className="mx-4 mt-6 rounded-lg border border-white/10 bg-white/5 p-4">
        <p className="text-label-bold uppercase text-slate-300">Continuidad operacional</p>
        <p className="mt-2 text-label-sm text-slate-400">Webapp independiente de flujos n8n para casos críticos.</p>
      </div>
    </aside>
  );
}
