import { PageHeader } from "@/components/ui/PageHeader";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { getSettingsViewModel } from "@/lib/p1m/read-models";
import { StatusChip } from "@/components/ui/StatusChip";

export default function SettingsPage() {
  const data = getSettingsViewModel();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sistema"
        title="Configuración"
        description="Gobernanza visual, usuarios, canales, flags, seguridad y auditoría."
        status="Parcial"
        actions={<SurfaceBadge kind="fixture" />}
      />

      <section className="grid gap-5 xl:grid-cols-3">
        <SectionCard title="Usuarios y roles" eyebrow="Access" description="Gestión visual de usuarios y permisos.">
          <InfoGrid items={data.users} />
          <button className="hub-button-secondary mt-4" type="button" disabled>
            Ver matriz de permisos
          </button>
        </SectionCard>
        <SectionCard title="Canales" eyebrow="Channels" description="Estado operativo por canal.">
          <InfoGrid items={data.channels} />
          <button className="hub-button-secondary mt-4" type="button" disabled>
            Ver configuración de canales
          </button>
        </SectionCard>
        <SectionCard title="Entorno" eyebrow="Environment" description="Estado de producción y sandbox.">
          <InfoGrid items={data.environment} />
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <SectionCard title="Gobernanza" eyebrow="Governance" description="Políticas de ejecución y ventanas operativas.">
          <InfoGrid items={data.governance} />
        </SectionCard>
        <SectionCard title="Feature flags" eyebrow="Flags" description="Capacidades controladas por flags.">
          <div className="space-y-2">
            {data.featureFlags.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-body-md text-slate-700">{item.label}</span>
                <StatusChip label={item.value} tone={item.value === "Activo" ? "green" : item.value === "Preview" ? "amber" : "blue"} />
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Módulos" eyebrow="Modules" description="Estado del sistema y su cobertura.">
          <InfoGrid items={data.modules} />
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <SectionCard title="Datos e identidad" eyebrow="Data" description="Fuentes de datos y sincronización.">
          <InfoGrid items={data.dataIdentity} />
        </SectionCard>
        <SectionCard title="Notificaciones" eyebrow="Notifications" description="Canales y preferencias.">
          <InfoGrid items={data.notifications} />
        </SectionCard>
        <SectionCard title="Seguridad" eyebrow="Security" description="Controles de seguridad y cumplimiento.">
          <InfoGrid items={data.security} />
        </SectionCard>
      </section>
    </div>
  );
}
