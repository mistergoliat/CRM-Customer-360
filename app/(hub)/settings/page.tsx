import { PageHeader } from "@/components/ui/PageHeader";
import { ModulePreview } from "@/components/ui/ModulePreview";

export default function SettingsPage() {
  return (
    <>
      <PageHeader eyebrow="Settings" title="Configuración" description="Configuración parcial para fase 1." status="Parcial" />
      <ModulePreview
        title="Settings"
        icon="settings"
        description="La configuración avanzada queda planificada. En fase 1 se usan variables de entorno server-side para DB, Meta, sesión y n8n."
        planned={["Gestión de usuarios", "Permisos por rol", "Configuración Meta avanzada", "Preferencias de módulos"]}
        partial="Parcial: configuración por .env"
      />
    </>
  );
}
