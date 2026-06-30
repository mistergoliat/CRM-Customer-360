"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const items = [
  { label: "Resumen", href: "/marketing" },
  { label: "Copilot", href: "/marketing/copilot" },
  { label: "Segmentos", href: "/marketing/segments" },
  { label: "Campañas", href: "/marketing/campaigns" },
  { label: "Automatizaciones", href: "/marketing/automations" },
  { label: "Plantillas", href: "/marketing/templates" },
  { label: "Rendimiento", href: "/marketing/performance" }
];

export function MarketingNav() {
  const pathname = usePathname();
  const activeHref = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <div className="mb-5 flex flex-wrap gap-2">
      {items.map((item) => {
        const active = activeHref === item.href;
        return (
          <Link
            key={item.label}
            href={item.href}
            className={clsx(
              "inline-flex h-10 items-center rounded-xl border px-4 text-label-bold uppercase transition",
              active ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
