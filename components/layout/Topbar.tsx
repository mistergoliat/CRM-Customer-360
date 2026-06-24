import { modules } from "@/lib/modules";
import { StatusChip } from "@/components/ui/StatusChip";
import { Icon } from "@/components/ui/Icon";

type TopbarProps = {
  pathname?: string;
};

export function Topbar({ pathname = "" }: TopbarProps) {
  const active = modules.find((module) => pathname === module.href || pathname.startsWith(`${module.href}/`));

  return (
    <div className="sticky top-0 z-20 border-b border-slate-200 bg-hub-canvas/95 px-4 py-3 backdrop-blur lg:px-8">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-label-bold uppercase text-primary">{active?.label ?? "PesasChile HUB"}</p>
            <p className="text-label-sm text-slate-500">AI Operations</p>
          </div>
        </div>

        <div className="hidden min-w-0 flex-1 justify-center px-6 xl:flex">
          <label className="flex w-full max-w-[660px] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <Icon name="search" className="text-slate-500" />
            <input
              className="w-full border-0 bg-transparent p-0 text-body-md text-slate-700 outline-none placeholder:text-slate-400"
              placeholder="Buscar cliente, teléfono, email, RUT, orden, factura, oportunidad o caso..."
              readOnly
            />
            <span className="rounded-lg border border-slate-200 px-2 py-0.5 text-[11px] font-bold uppercase text-slate-500">⌘K</span>
          </label>
        </div>

        <div className="flex items-center gap-3 self-end xl:self-auto">
          <StatusChip label="Producción" tone="green" />
          <button className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm" type="button" aria-label="Notifications">
            <Icon name="notifications" />
          </button>
          <button className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm" type="button" aria-label="Help">
            <Icon name="help" />
          </button>
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-fixed text-primary font-bold">AU</div>
            <div className="leading-tight">
              <p className="text-label-bold text-on-surface">Admin User</p>
              <p className="text-label-sm text-slate-500">Operador</p>
            </div>
            <Icon name="expand_more" className="text-slate-500" />
          </div>
        </div>
      </div>
    </div>
  );
}
