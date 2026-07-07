import Link from "next/link";
import { listCustomers, getCustomerById } from "@/lib/domains/customers";
import { platformOriginLabel } from "@/lib/domains/customers/platform-origin";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { DataTable } from "@/components/ui/DataTable";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { SectionCard } from "@/components/p1m/SectionCard";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { CustomerCreateForm } from "@/components/customers/CustomerCreateForm";

type CustomersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function param(searchParams: Record<string, string | string[] | undefined>, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function surfaceKindForMode(mode: string) {
  if (mode === "real") return "real" as const;
  if (mode === "partial") return "preview" as const;
  return "notAvailable" as const;
}

export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const sp = await searchParams;
  const search = param(sp, "search") || "";
  const page = Number(param(sp, "page") || 1);
  const selectedId = param(sp, "id");
  const data = await listCustomers({ search, page, pageSize: 25 });
  const selected = selectedId ? await getCustomerById(selectedId) : data.items[0] ? await getCustomerById(data.items[0].id) : null;
  const badgeKind = surfaceKindForMode(data.meta.mode);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM"
        title="Clientes"
        description="Directorio real sobre `master_customer` con perfil consolidado y creación funcional."
        status={data.meta.mode}
        actions={<SurfaceBadge kind={badgeKind} />}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Clientes" value={data.pagination.total} description="Registros en master_customer" icon="person" state="ok" />
        <StatCard title="Modo" value={data.meta.mode} description={data.meta.source} icon="dataset" state={data.meta.mode === "real" ? "ok" : "warning"} />
        <StatCard title="Warnings" value={data.meta.warnings.length} description={data.meta.warnings.length > 0 ? data.meta.warnings.join(", ") : "Sin warnings"} icon="report" state={data.meta.warnings.length > 0 ? "warning" : "muted"} />
        <StatCard title="Search" value={search || "—"} description="Filtro actual" icon="search" state="muted" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <SectionCard title="Directorio" eyebrow="Lista" description="Búsqueda real por nombre o email." actions={<StatusChip label="real" tone="green" />}>
          <form className="mb-4 flex flex-wrap gap-2" action="/customers">
            <input className="hub-input min-w-[260px] flex-1" name="search" defaultValue={search} placeholder="Buscar nombre o email" />
            <button className="hub-button-primary" type="submit">
              Buscar
            </button>
          </form>

          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <DataTable headers={["ID", "Nombre", "Email", "Origen", "Estado", "Fuente", "Última actividad"]}>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link href={`/customers/${row.id}`} className="font-semibold text-primary hover:underline">
                      {row.id}
                    </Link>
                  </td>
                  <td>{row.displayName}</td>
                  <td>{row.email}</td>
                  <td>{platformOriginLabel(row.platformOrigin)}</td>
                  <td>
                    <StatusChip label={row.identityState} tone={row.identityState === "real" ? "green" : row.identityState === "partial" ? "amber" : "gray"} />
                  </td>
                  <td>{row.source}</td>
                  <td>{row.lastActivity ?? "—"}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Perfil" eyebrow="Customer 360" description={selected?.customer?.firstname ? `${selected.customer.firstname} ${selected.customer.lastname}` : "Sin selección"}>
            {selected?.customer ? (
              <div className="space-y-4">
                <InfoGrid
                  items={[
                    { label: "ID", value: selected.customer.id },
                    { label: "Firstname", value: selected.customer.firstname },
                    { label: "Lastname", value: selected.customer.lastname },
                    { label: "Email", value: selected.customer.email },
                    { label: "Plataforma de origen", value: platformOriginLabel(selected.customer.platformOrigin) },
                    { label: "Identity", value: selected.identity.state },
                    { label: "Source", value: selected.identity.source }
                  ]}
                  columns={3}
                />
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-label-bold uppercase text-slate-500">Warnings</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(selected.warnings.length > 0 ? selected.warnings : ["sin warnings"]).map((warning) => (
                      <StatusChip key={warning} label={warning} tone={warning === "sin warnings" ? "green" : "amber"} />
                    ))}
                  </div>
                </div>
                <div className="grid gap-2">
                  <Link href={`/customers/${selected.customer.id}`} className="hub-button-primary">
                    Abrir perfil completo
                  </Link>
                </div>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="Crear cliente" eyebrow="Write path" description="POST /api/customers con validación real.">
            <CustomerCreateForm redirectTo="/customers/:id" />
          </SectionCard>
        </div>
      </section>
    </div>
  );
}
