"use strict";
"use client";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaseConsoleHeader = CaseConsoleHeader;
const link_1 = __importDefault(require("next/link"));
const navigation_1 = require("next/navigation");
const format_1 = require("@/lib/format");
const StatusChip_1 = require("@/components/ui/StatusChip");
const Icon_1 = require("@/components/ui/Icon");
function CaseConsoleHeader({ caseId, serviceCode, department, updatedAt }) {
    const router = (0, navigation_1.useRouter)();
    return (<section className="hub-card border-l-4 border-l-primary-container px-5 py-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-headline-lg text-on-surface">Caso #{caseId}</p>
            {serviceCode ? <StatusChip_1.StatusChip label={String(serviceCode)} tone="gray"/> : null}
            {department ? <StatusChip_1.StatusChip label={String(department)} tone="gray"/> : null}
          </div>
          <p className="mt-2 text-body-md text-slate-500">Actualizado: {(0, format_1.formatDateTime)(updatedAt)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <link_1.default href="/cases" className="hub-button-secondary">
            <Icon_1.Icon name="arrow_back"/>
            Volver a casos
          </link_1.default>
          <button className="hub-button-secondary" onClick={() => router.refresh()}>
            <Icon_1.Icon name="refresh"/>
            Recargar
          </button>
        </div>
      </div>
    </section>);
}
