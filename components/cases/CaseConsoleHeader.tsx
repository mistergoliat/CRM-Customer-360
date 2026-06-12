"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import { StatusChip } from "@/components/ui/StatusChip";
import { Icon } from "@/components/ui/Icon";

export function CaseConsoleHeader({
  caseId,
  serviceCode,
  department,
  updatedAt
}: {
  caseId: string;
  serviceCode: unknown;
  department: unknown;
  updatedAt: unknown;
}) {
  const router = useRouter();

  return (
    <section className="hub-card border-l-4 border-l-primary-container px-5 py-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-headline-lg text-on-surface">Caso #{caseId}</p>
            {serviceCode ? <StatusChip label={String(serviceCode)} tone="gray" /> : null}
            {department ? <StatusChip label={String(department)} tone="gray" /> : null}
          </div>
          <p className="mt-2 text-body-md text-slate-500">Actualizado: {formatDateTime(updatedAt)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/cases" className="hub-button-secondary">
            <Icon name="arrow_back" />
            Volver a casos
          </Link>
          <button className="hub-button-secondary" onClick={() => router.refresh()}>
            <Icon name="refresh" />
            Recargar
          </button>
        </div>
      </div>
    </section>
  );
}
