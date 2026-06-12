import { modules } from "@/lib/modules";
import { StatusChip } from "@/components/ui/StatusChip";

type TopbarProps = {
  pathname?: string;
};

export function Topbar({ pathname = "" }: TopbarProps) {
  const active = modules.find((module) => pathname === module.href || pathname.startsWith(`${module.href}/`));
  return (
    <div className="sticky top-0 z-20 border-b border-slate-200 bg-hub-canvas/95 px-4 py-3 backdrop-blur lg:px-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-label-bold uppercase text-primary">{active?.label ?? "PesasChile HUB"}</p>
          <p className="text-label-sm text-slate-500">Ops Dashboard</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip label={active?.status === "active" ? "Activo" : active?.status ?? "HUB"} tone={active?.status === "active" ? "green" : "amber"} />
        </div>
      </div>
    </div>
  );
}
