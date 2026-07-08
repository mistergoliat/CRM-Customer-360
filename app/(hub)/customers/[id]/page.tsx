import { notFound } from "next/navigation";
import { InfoGrid } from "@/components/p1m/InfoGrid";
import { SectionCard } from "@/components/p1m/SectionCard";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";
import { StatCard } from "@/components/ui/StatCard";
import { StatusChip } from "@/components/ui/StatusChip";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatDateTime, truncate } from "@/lib/format";
import { getCustomer360Snapshot } from "@/lib/domains/customer-360";
import { platformOriginLabel } from "@/lib/domains/customers/platform-origin";

type CustomerDetailProps = {
  params: Promise<{ id: string }>;
};

function sectionTone(state: string) {
  if (state === "real") return "green" as const;
  if (state === "partial") return "amber" as const;
  if (state === "error") return "red" as const;
  return "gray" as const;
}

function completenessBadgeKind(state: string) {
  if (state === "complete") return "real" as const;
  if (state === "partial" || state === "minimal") return "provisional" as const;
  return "notAvailable" as const;
}

function renderEmpty(message: string) {
  return <p className="text-body-md text-slate-600">{message}</p>;
}

export default async function CustomerDetailPage({ params }: CustomerDetailProps) {
  const { id } = await params;
  const snapshot = await getCustomer360Snapshot(id);
  if (!snapshot) notFound();

  const identity = snapshot.identity;
  const freshness = snapshot.metadata.freshness;
  const completeness = snapshot.metadata.completeness;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Customer 360"
        title={identity.displayName}
        description={`Read model consolidado del cliente ${snapshot.customerId}. Identidad provisional visible y fuentes nativas consolidadas.`}
        status={completeness.state}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SurfaceBadge kind={completenessBadgeKind(completeness.state)} />
            <StatusChip label={freshness.state} tone={freshness.state === "fresh" ? "green" : freshness.state === "stale" ? "amber" : "gray"} />
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Conversaciones" value={snapshot.sections.conversations.total} description="Threads consolidados" icon="chat" state={snapshot.sections.conversations.total > 0 ? "ok" : "muted"} />
        <StatCard title="Oportunidades" value={snapshot.sections.opportunities.total} description="Commercial ownership" icon="target" state={snapshot.sections.opportunities.total > 0 ? "ok" : "muted"} />
        <StatCard title="Quotes" value={snapshot.sections.quotes.total} description="Versioned drafts" icon="document" state={snapshot.sections.quotes.total > 0 ? "ok" : "muted"} />
        <StatCard title="Direcciones" value={snapshot.sections.addresses.total} description="Múltiples por cliente" icon="pin" state={snapshot.sections.addresses.total > 0 ? "ok" : "muted"} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_360px]">
        <SectionCard title="Identidad provisional" eyebrow="Identity" description={`Fuente: ${identity.source}`}>
          <div className="space-y-4">
            <InfoGrid
              items={[
                { label: "Customer ID", value: snapshot.customerId },
                { label: "Display name", value: identity.displayName },
                { label: "Firstname", value: identity.firstname ?? "No disponible" },
                { label: "Lastname", value: identity.lastname ?? "No disponible" },
                { label: "Email", value: identity.email ?? "No disponible" },
                { label: "Origen", value: platformOriginLabel(identity.platformOrigin) },
                { label: "Identity state", value: identity.state },
                { label: "Linked identities", value: String(identity.linkedIdentities.length) }
              ]}
              columns={3}
            />
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-label-bold uppercase text-slate-500">Linked identities</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {identity.linkedIdentities.length > 0
                  ? identity.linkedIdentities.map((linked) => (
                      <StatusChip key={`${linked.source}-${linked.type}-${linked.value}`} label={`${linked.source}:${linked.type}`} tone={linked.verified ? "green" : "blue"} />
                    ))
                  : [<StatusChip key="no-linked" label="sin identidades vinculadas" tone="gray" />]}
              </div>
            </div>
          </div>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Metadata" eyebrow="Read model" description="Frescura, completitud y fallback visible.">
            <div className="space-y-3">
              <InfoGrid
                items={[
                  { label: "Snapshot version", value: String(snapshot.snapshotVersion) },
                  { label: "Freshness", value: freshness.state },
                  { label: "Completeness", value: `${completeness.state} (${completeness.score}%)` },
                  { label: "Last activity", value: freshness.lastActivityAt ? formatDateTime(freshness.lastActivityAt) : "sin actividad" },
                  { label: "Refreshed at", value: formatDateTime(freshness.lastRefreshedAt) }
                ]}
                columns={2}
              />
              <div className="space-y-2">
                {(snapshot.metadata.warnings.length > 0 ? snapshot.metadata.warnings : ["sin warnings"]).map((warning) => (
                  <StatusChip key={warning} label={warning} tone={warning === "sin warnings" ? "green" : "amber"} />
                ))}
              </div>
            </div>
          </SectionCard>

        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Conversaciones" eyebrow="Conversation Domain" description={snapshot.sections.conversations.source} actions={<StatusChip label={snapshot.sections.conversations.state} tone={sectionTone(snapshot.sections.conversations.state)} />}>
          <div className="space-y-3">
            {snapshot.sections.conversations.items.length > 0
              ? snapshot.sections.conversations.items.map((conversation) => (
                  <div key={conversation.conversationId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-on-surface">{conversation.publicId}</p>
                        <p className="text-label-sm text-slate-500">
                          {conversation.channel} · {conversation.provider} · {conversation.externalContactId}
                        </p>
                      </div>
                      <StatusChip label={conversation.status} tone={conversation.humanOwnerActive ? "amber" : conversation.aiEnabled ? "green" : "gray"} />
                    </div>
                    <p className="mt-2 text-body-md text-slate-600">
                      {conversation.lastMessagePreview ? truncate(conversation.lastMessagePreview, 110) : "Sin ultimo mensaje"}
                    </p>
                    <p className="mt-2 text-label-sm text-slate-500">
                      Última actividad {conversation.lastMessageAt ? formatDateTime(conversation.lastMessageAt) : "sin datos"} · {conversation.messageCount} mensajes
                    </p>
                  </div>
                ))
              : renderEmpty("No hay conversaciones vinculadas a este cliente.")}
          </div>
        </SectionCard>

        <SectionCard title="Mensajes" eyebrow="Timeline" description={snapshot.sections.messages.source} actions={<StatusChip label={snapshot.sections.messages.state} tone={sectionTone(snapshot.sections.messages.state)} />}>
          <div className="space-y-3">
            {snapshot.sections.messages.items.length > 0
              ? snapshot.sections.messages.items.map((message) => (
                  <div key={message.messageId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <StatusChip label={message.direction} tone={message.direction === "outbound" ? "blue" : "green"} />
                      <span className="text-label-sm text-slate-500">{message.occurredAt ? formatDateTime(message.occurredAt) : "sin datos"}</span>
                    </div>
                    <p className="mt-2 font-semibold text-on-surface">{truncate(message.bodyPreview ?? "Sin cuerpo", 120)}</p>
                    <p className="mt-1 text-label-sm text-slate-500">
                      {message.messageType} · {message.status} · {message.publicId}
                    </p>
                  </div>
                ))
              : renderEmpty("No hay mensajes consolidables.")}
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Oportunidades" eyebrow="Autonomous Commerce" description={snapshot.sections.opportunities.source} actions={<StatusChip label={snapshot.sections.opportunities.state} tone={sectionTone(snapshot.sections.opportunities.state)} />}>
          <div className="space-y-3">
            {snapshot.sections.opportunities.items.length > 0
              ? snapshot.sections.opportunities.items.map((opportunity) => (
                  <div key={opportunity.opportunityId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-on-surface">{opportunity.opportunityKey}</p>
                        <p className="text-label-sm text-slate-500">{opportunity.primaryIntent} · {opportunity.sourceRef ?? "sin ref"}</p>
                      </div>
                      <StatusChip label={opportunity.status} tone={opportunity.status === "won" ? "green" : opportunity.status === "lost" ? "red" : "amber"} />
                    </div>
                    <p className="mt-2 text-body-md text-slate-600">{opportunity.currentSummary ? truncate(opportunity.currentSummary, 120) : "Sin resumen"}</p>
                    <p className="mt-2 text-label-sm text-slate-500">
                      Etapa {opportunity.stage ?? "sin etapa"} · Próxima acción {opportunity.nextActionType ?? "sin datos"} · {opportunity.lastActivityAt ? formatDateTime(opportunity.lastActivityAt) : "sin actividad"}
                    </p>
                  </div>
                ))
              : renderEmpty("No hay oportunidades vinculadas.")}
          </div>
        </SectionCard>

        <SectionCard title="Perfiles comerciales" eyebrow="Need profiles" description={snapshot.sections.profiles.source} actions={<StatusChip label={snapshot.sections.profiles.state} tone={sectionTone(snapshot.sections.profiles.state)} />}>
          <div className="space-y-3">
            {snapshot.sections.profiles.items.length > 0
              ? snapshot.sections.profiles.items.map((profileItem) => (
                  <div key={profileItem.profileId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-on-surface">{profileItem.profileKey}</p>
                        <p className="text-label-sm text-slate-500">{profileItem.useCase ?? "Sin use case"}</p>
                      </div>
                      <StatusChip label={profileItem.decisionReadiness ?? "unknown"} tone={profileItem.decisionReadiness === "ready" ? "green" : "amber"} />
                    </div>
                    <p className="mt-2 text-body-md text-slate-600">
                      Presupuesto {profileItem.budgetMin ?? "n/a"} - {profileItem.budgetMax ?? "n/a"}
                    </p>
                    <p className="mt-2 text-label-sm text-slate-500">
                      Urgencia {profileItem.purchaseUrgency ?? "n/a"} · Faltantes {profileItem.missingInformation.length > 0 ? profileItem.missingInformation.join(", ") : "sin faltantes"}
                    </p>
                  </div>
                ))
              : renderEmpty("No hay perfiles comerciales.")}
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Acciones" eyebrow="Governed execution" description={snapshot.sections.actions.source} actions={<StatusChip label={snapshot.sections.actions.state} tone={sectionTone(snapshot.sections.actions.state)} />}>
          <div className="space-y-3">
            {snapshot.sections.actions.items.length > 0
              ? snapshot.sections.actions.items.map((action) => (
                  <div key={action.actionId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-on-surface">{action.actionType}</p>
                        <p className="text-label-sm text-slate-500">{action.actionId}</p>
                      </div>
                      <StatusChip label={action.status} tone={action.status === "completed" ? "green" : action.status === "failed" ? "red" : "amber"} />
                    </div>
                    <p className="mt-2 text-body-md text-slate-600">{action.finalMessage ? truncate(action.finalMessage, 120) : action.draftMessage ? truncate(action.draftMessage, 120) : "Sin mensaje"}</p>
                    <p className="mt-2 text-label-sm text-slate-500">
                      Riesgo {action.riskLevel} · Aprobación {action.approvalRequirement} · Programada {action.scheduledFor ? formatDateTime(action.scheduledFor) : "sin fecha"}
                    </p>
                  </div>
                ))
              : renderEmpty("No hay acciones consolidadas.")}
          </div>
        </SectionCard>

        <SectionCard title="Outcomes" eyebrow="Observed results" description={snapshot.sections.outcomes.source} actions={<StatusChip label={snapshot.sections.outcomes.state} tone={sectionTone(snapshot.sections.outcomes.state)} />}>
          <div className="space-y-3">
            {snapshot.sections.outcomes.items.length > 0
              ? snapshot.sections.outcomes.items.map((outcome) => (
                  <div key={outcome.outcomeId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-on-surface">{outcome.outcomeType}</p>
                        <p className="text-label-sm text-slate-500">{outcome.actionId}</p>
                      </div>
                      <span className="text-label-sm text-slate-500">{formatDateTime(outcome.occurredAt)}</span>
                    </div>
                    <p className="mt-2 text-label-sm text-slate-500">Provider message {outcome.providerMessageId ?? "n/a"}</p>
                  </div>
                ))
              : renderEmpty("No hay outcomes registrados.")}
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Quotes" eyebrow="Commercial docs" description={snapshot.sections.quotes.source} actions={<StatusChip label={snapshot.sections.quotes.state} tone={sectionTone(snapshot.sections.quotes.state)} />}>
          <div className="space-y-3">
            {snapshot.sections.quotes.items.length > 0
              ? snapshot.sections.quotes.items.map((quote) => (
                  <div key={quote.quoteId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-on-surface">{quote.quoteId}</p>
                        <p className="text-label-sm text-slate-500">{quote.requestId} · v{quote.version}</p>
                      </div>
                      <StatusChip label={quote.status} tone={quote.status === "accepted" ? "green" : quote.status === "rejected" ? "red" : "amber"} />
                    </div>
                    <p className="mt-2 text-body-md text-slate-600">
                      Total {quote.total ?? "No disponible"} {quote.currency ?? ""}
                    </p>
                    <p className="mt-2 text-label-sm text-slate-500">
                      Creada {formatDateTime(quote.createdAt)} · Enviada {quote.sentAt ? formatDateTime(quote.sentAt) : "sin envío"} · Decidida {quote.decidedAt ? formatDateTime(quote.decidedAt) : "sin decisión"}
                    </p>
                  </div>
                ))
              : renderEmpty("No hay cotizaciones.")}
          </div>
        </SectionCard>

        <SectionCard title="Orders" eyebrow="Projected orders" description={snapshot.sections.orders.source} actions={<StatusChip label={snapshot.sections.orders.state} tone={sectionTone(snapshot.sections.orders.state)} />}>
          <div className="space-y-3">
            {snapshot.sections.orders.items.length > 0
              ? snapshot.sections.orders.items.map((order) => (
                  <div key={order.orderId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-on-surface">{order.reference ?? order.orderId}</p>
                        <p className="text-label-sm text-slate-500">{order.invoiceNumber ?? "sin invoice"} · {order.orderId}</p>
                      </div>
                      <StatusChip label={order.status ?? "unknown"} tone={order.status === "paid" ? "green" : "amber"} />
                    </div>
                    <p className="mt-2 text-body-md text-slate-600">
                      Estado {order.stateName ?? "n/a"} · Total {order.totalPaid ?? "No disponible"}
                    </p>
                    <p className="mt-2 text-label-sm text-slate-500">{order.createdAt ? formatDateTime(order.createdAt) : "sin fecha"}</p>
                  </div>
                ))
              : renderEmpty("No hay pedidos proyectados.")}
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Direcciones" eyebrow="customer_addresses" description={snapshot.sections.addresses.source} actions={<StatusChip label={snapshot.sections.addresses.state} tone={sectionTone(snapshot.sections.addresses.state)} />}>
          <div className="space-y-3">
            {snapshot.sections.addresses.items.length > 0
              ? snapshot.sections.addresses.items.map((address) => (
                  <div key={address.addressId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-on-surface">{address.addressLabel ?? "Direccion"}</p>
                        <p className="text-label-sm text-slate-500">{address.streetName} {address.streetNumber}{address.unit ? `, ${address.unit}` : ""}</p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <StatusChip label={address.isDefault ? "default" : "not default"} tone={address.isDefault ? "blue" : "gray"} />
                        <StatusChip label={address.isActive ? "active" : "inactive"} tone={address.isActive ? "green" : "red"} />
                      </div>
                    </div>
                    <p className="mt-2 text-body-md text-slate-600">
                      {address.commune}, {address.region}{address.city ? ` · ${address.city}` : ""}{address.postalCode ? ` · ${address.postalCode}` : ""}
                    </p>
                    <p className="mt-2 text-label-sm text-slate-500">{address.recipientName ?? "Sin destinatario"} · Confirmación {address.confirmationState}</p>
                  </div>
                ))
              : renderEmpty("No hay direcciones registradas.")}
          </div>
        </SectionCard>

        <SectionCard title="Lifecycle" eyebrow="Assembler" description={snapshot.lifecycle.source} actions={<StatusChip label={snapshot.lifecycle.state} tone={sectionTone(snapshot.lifecycle.state)} />}>
          <div className="space-y-3">
            {snapshot.lifecycle.items.length > 0
              ? snapshot.lifecycle.items.slice(0, 12).map((event) => (
                  <div key={event.eventId} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-on-surface">{event.eventType}</p>
                        <p className="text-label-sm text-slate-500">{event.source} · {event.entityType}</p>
                      </div>
                      <span className="text-label-sm text-slate-500">{formatDateTime(event.occurredAt)}</span>
                    </div>
                    <p className="mt-2 text-body-md text-slate-600">{event.summary}</p>
                  </div>
                ))
              : renderEmpty("No se pudieron ensamblar eventos de lifecycle.")}
          </div>
        </SectionCard>
      </section>
    </div>
  );
}
