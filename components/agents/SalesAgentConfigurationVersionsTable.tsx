"use client";

import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusChip } from "@/components/ui/StatusChip";
import { asText, formatDateTime } from "@/lib/format";
import { describeConfigurationStatus } from "@/lib/domains/sales-agent-config/form";
import type { SalesAgentConfigurationRecord } from "@/lib/brain/commercial/sales-agent-configuration/types";

type Props = {
  versions: SalesAgentConfigurationRecord[];
  writeEnabled: boolean;
  pendingKey: string | null;
  onEdit: (id: number) => void;
  onClone: (id: number) => void;
  onPublish: (id: number) => void;
  onArchive: (id: number) => void;
};

export function SalesAgentConfigurationVersionsTable({ versions, writeEnabled, pendingKey, onEdit, onClone, onPublish, onArchive }: Props) {
  if (versions.length === 0) {
    return <EmptyState title="Sin versiones todavia" description="Crea el primer borrador desde las pestanas de arriba." icon="history" />;
  }

  return (
    <DataTable headers={["Version", "Nombre", "Estado", "Autor", "Creado", "Publicado", "Hash", "Parent", "Acciones"]}>
      {versions.map((version) => {
        const statusInfo = describeConfigurationStatus(version.status);
        const busy = pendingKey?.startsWith(`${version.id}:`) ?? false;
        return (
          <tr key={version.id}>
            <td>v{version.version}</td>
            <td className="max-w-[220px] truncate">{version.name}</td>
            <td>
              <StatusChip label={statusInfo.label} tone={statusInfo.tone} />
            </td>
            <td>{asText(version.createdBy)}</td>
            <td>{formatDateTime(version.createdAt)}</td>
            <td>{version.publishedAt ? formatDateTime(version.publishedAt) : "-"}</td>
            <td className="font-mono text-label-sm">{version.configurationHash.slice(0, 8)}</td>
            <td>{version.parentConfigurationId ? `v${version.parentConfigurationId}` : "-"}</td>
            <td>
              <div className="flex flex-wrap gap-2">
                {version.status === "draft" ? (
                  <button className="hub-button-secondary" type="button" disabled={busy} onClick={() => onEdit(version.id)}>
                    Editar
                  </button>
                ) : null}
                {version.status === "draft" ? (
                  <button
                    className="hub-button-secondary"
                    type="button"
                    disabled={!writeEnabled || busy}
                    title={!writeEnabled ? "Requiere DB_WRITE_ENABLED" : "Publicar esta version"}
                    onClick={() => onPublish(version.id)}
                  >
                    Publicar
                  </button>
                ) : null}
                <button
                  className="hub-button-secondary"
                  type="button"
                  disabled={!writeEnabled || busy}
                  title={!writeEnabled ? "Requiere DB_WRITE_ENABLED" : "Clonar como nuevo borrador"}
                  onClick={() => onClone(version.id)}
                >
                  Clonar
                </button>
                {version.status === "draft" ? (
                  <button
                    className="hub-button-secondary"
                    type="button"
                    disabled={!writeEnabled || busy}
                    title={!writeEnabled ? "Requiere DB_WRITE_ENABLED" : "Archivar este borrador"}
                    onClick={() => onArchive(version.id)}
                  >
                    Archivar
                  </button>
                ) : null}
              </div>
            </td>
          </tr>
        );
      })}
    </DataTable>
  );
}
