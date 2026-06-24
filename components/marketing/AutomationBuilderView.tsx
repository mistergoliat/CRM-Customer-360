import { StatusChip } from "@/components/ui/StatusChip";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { Icon } from "@/components/ui/Icon";

type AutomationBuilderViewProps = {
  automation: {
    id: string;
    name: string;
    trigger: string;
    wait: string;
    condition: string;
    email: string;
    whatsapp: string;
    branches: string[];
    suppression: string;
    owner: string;
    governance: string[];
    status?: string;
    executions?: string;
    conversions?: string;
    channel?: string;
    nodes?: { id: string; label: string; tone?: "green" | "amber" | "red" | "blue" | "gray"; branches?: string[] }[];
  };
};

export function AutomationBuilderView({ automation }: AutomationBuilderViewProps) {
  const nodes = automation.nodes ?? [
    { id: "node-1", label: automation.trigger, tone: "blue" },
    { id: "node-2", label: `Esperar ${automation.wait}`, tone: "gray" },
    { id: "node-3", label: automation.condition, tone: "amber", branches: ["Sí", "No"] },
    { id: "node-4", label: automation.email, tone: "blue" },
    { id: "node-5", label: "Enviar WhatsApp", tone: "blue" }
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
      <SectionCard title="Biblioteca" eyebrow="Blocks" description="Triggers, waits y acciones disponibles.">
        <div className="space-y-2">
          {["Trigger", "Condition", "Wait", "Email", "WhatsApp", "SMS", "Tarea", "Actualizar campo"].map((item, index) => (
            <div key={item} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-fixed text-primary">
                <Icon name={index % 2 === 0 ? "add" : "drag_indicator"} />
              </div>
              <div>
                <p className="text-body-md font-semibold text-on-surface">{item}</p>
                <p className="text-label-sm text-slate-500">Arrastrable en preview</p>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title={automation.name} eyebrow="Automation builder" description="Representación visual del workflow.">
        <div className="space-y-5">
          <InfoGrid
            items={[
              { label: "Trigger", value: automation.trigger },
              { label: "Wait", value: automation.wait },
              { label: "Condition", value: automation.condition },
              { label: "Owner", value: automation.owner },
              { label: "Status", value: automation.status ?? "Preview" },
              { label: "Ejecuciones", value: automation.executions ?? "—" }
            ]}
            columns={3}
          />

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-label-bold uppercase text-slate-500">Canvas</p>
                <p className="text-body-md text-slate-600">Nodos conectados y ramas visibles.</p>
              </div>
              <StatusChip label={automation.channel ?? "Preview only"} tone="amber" />
            </div>
            <div className="mt-4 space-y-3">
              {nodes.map((node, index) => (
                <div key={node.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-fixed text-primary font-bold">{index + 1}</div>
                      <div>
                        <p className="text-label-bold uppercase text-slate-500">{index === 0 ? "Trigger" : index === nodes.length - 1 ? "Final" : "Paso"}</p>
                        <p className="mt-1 text-body-md font-semibold text-on-surface">{node.label}</p>
                      </div>
                    </div>
                    <StatusChip label={node.tone === "amber" ? "Revisión" : node.tone === "green" ? "OK" : node.tone === "red" ? "Bloqueada" : "Preview"} tone={node.tone} />
                  </div>
                  {index < nodes.length - 1 ? (
                    <div className="mt-3 flex items-center gap-2 text-slate-500">
                      <span className="material-symbols-outlined">south</span>
                      <span className="text-label-sm uppercase">Siguiente</span>
                    </div>
                  ) : null}
                  {node.branches?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {node.branches.map((branch) => (
                        <StatusChip key={branch} label={branch} tone="blue" />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Email</p>
              <p className="mt-2 text-body-md text-slate-700">{automation.email}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">WhatsApp</p>
              <p className="mt-2 text-body-md text-slate-700">{automation.whatsapp}</p>
            </div>
          </div>

          <div>
            <p className="text-label-bold uppercase text-slate-500">Branches</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {automation.branches.map((branch) => <StatusChip key={branch} label={branch} tone="blue" />)}
            </div>
          </div>

          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <p className="text-label-bold uppercase text-slate-500">Suppression</p>
            <p className="mt-2 text-body-md text-slate-700">{automation.suppression}</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Inspector" eyebrow="Config" description="Configuración del nodo y controles preview.">
        <div className="space-y-4">
          <InfoGrid
            items={[
              { label: "Owner", value: automation.owner },
              { label: "Ejecuciones", value: automation.executions ?? "—" },
              { label: "Conversión", value: automation.conversions ?? "—" },
              { label: "Canal", value: automation.channel ?? "Preview" }
            ]}
          />
          <div>
            <p className="text-label-bold uppercase text-slate-500">Governance</p>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-body-md text-slate-700">
              {automation.governance.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <div className="grid gap-2">
            <button className="hub-button-primary" type="button" disabled>
              Guardar
            </button>
            <button className="hub-button-secondary" type="button" disabled>
              Solicitar aprobación
            </button>
            <button className="hub-button-secondary" type="button" disabled>
              Activar
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
