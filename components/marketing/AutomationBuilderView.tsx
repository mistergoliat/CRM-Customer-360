import { StatusChip } from "@/components/ui/StatusChip";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";

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
  };
};

export function AutomationBuilderView({ automation }: AutomationBuilderViewProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
      <SectionCard title={automation.name} eyebrow="Automation builder" description="Representación visual del workflow.">
        <div className="space-y-4">
          <InfoGrid
            items={[
              { label: "Trigger", value: automation.trigger },
              { label: "Wait", value: automation.wait },
              { label: "Condition", value: automation.condition },
              { label: "Owner", value: automation.owner }
            ]}
          />
          <div className="grid gap-3 md:grid-cols-2">
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

      <SectionCard title="Governance" eyebrow="Config" description="Límites de seguridad y modo preview.">
        <ul className="list-disc space-y-2 pl-5 text-body-md text-slate-700">
          {automation.governance.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <div className="mt-4 grid gap-2">
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
      </SectionCard>
    </div>
  );
}
