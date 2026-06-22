"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModulePreview = ModulePreview;
const Icon_1 = require("./Icon");
const StatusChip_1 = require("./StatusChip");
function ModulePreview({ title, icon, description, planned, partial }) {
    return (<div className="space-y-5">
      <div className="hub-card overflow-hidden">
        <div className="border-l-4 border-primary-container p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                <Icon_1.Icon name={icon}/>
              </div>
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h2 className="text-headline-lg text-on-surface">{title}</h2>
                  <StatusChip_1.StatusChip label="Preview" tone="red"/>
                  <StatusChip_1.StatusChip label="Próximamente" tone="amber"/>
                  <StatusChip_1.StatusChip label="No conectado" tone="gray"/>
                </div>
                <p className="max-w-3xl text-body-md text-slate-600">{description}</p>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-label-sm text-slate-500">
              Módulo planificado
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="hub-card p-5 lg:col-span-2">
          <p className="text-label-bold uppercase text-slate-500">Funcionalidades planificadas</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {planned.map((item) => (<div key={item} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="mb-2 h-1 w-12 rounded-full bg-primary-container"/>
                <p className="text-body-md font-semibold text-on-surface">{item}</p>
              </div>))}
          </div>
        </div>
        <div className="hub-card p-5">
          <p className="text-label-bold uppercase text-slate-500">Estado de conexión</p>
          <p className="mt-4 text-headline-md text-on-surface">{partial ?? "Backend no implementado en fase 1"}</p>
          <p className="mt-2 text-body-md text-slate-500">
            Visible para mostrar la arquitectura modular del HUB sin inventar métricas ni fuentes conectadas.
          </p>
        </div>
      </div>
    </div>);
}
