"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SettingsPage;
const PageHeader_1 = require("@/components/ui/PageHeader");
const ModulePreview_1 = require("@/components/ui/ModulePreview");
function SettingsPage() {
    return (<>
      <PageHeader_1.PageHeader eyebrow="Settings" title="Configuración" description="Configuración parcial para fase 1." status="Parcial"/>
      <ModulePreview_1.ModulePreview title="Settings" icon="settings" description="La configuración avanzada queda planificada. En fase 1 se usan variables de entorno server-side para DB, Meta, sesión y n8n." planned={["Gestión de usuarios", "Permisos por rol", "Configuración Meta avanzada", "Preferencias de módulos"]} partial="Parcial: configuración por .env"/>
    </>);
}
