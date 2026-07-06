import { notFound } from "next/navigation";
import { getCustomerById } from "@/lib/domains/customers";
import { loadNativeConversationDetailByPublicId } from "@/lib/brain/native-whatsapp/service";
import { loadConversationThread, deriveAiControlMode } from "@/lib/domains/conversations/thread";
import { loadConversationAutonomousState } from "@/lib/domains/conversations/autonomous-state";
import { isWhatsAppWindowOpen } from "@/lib/domains/conversations/control";
import { isDbWriteEnabled } from "@/lib/write-access";
import { ConversationWorkspace } from "@/components/conversations/workspace/ConversationWorkspace";
import type { ConversationWorkspaceData } from "@/components/conversations/workspace/types";

export const dynamic = "force-dynamic";

type ConversationDetailProps = {
  params: Promise<{ id: string }>;
};

const CLOSED_STATUSES = ["closed", "resolved", "done", "archived"];

function toBool(value: number | string | null | undefined): boolean {
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.trim() !== "" && value.trim() !== "0" && value.trim().toLowerCase() !== "false";
  return false;
}

export default async function ConversationDetailPage({ params }: ConversationDetailProps) {
  const { id } = await params;
  const detail = await loadNativeConversationDetailByPublicId(id);
  if (!detail) notFound();

  const conversation = detail.conversation;
  const [thread, autonomous] = await Promise.all([
    loadConversationThread(conversation.id),
    loadConversationAutonomousState(conversation.id)
  ]);
  const customerDetail = detail.customer?.id != null ? await getCustomerById(String(detail.customer.id)) : null;

  const aiEnabled = toBool(conversation.ai_enabled);
  const humanOwnerActive = toBool(conversation.human_owner_active);
  const status = conversation.status ?? "";
  const closed = CLOSED_STATUSES.includes(status.toLowerCase());
  // Meta's 24h window opens with the last CUSTOMER message, not any message.
  const windowOpen = isWhatsAppWindowOpen(conversation.last_inbound_at);
  const priority = humanOwnerActive ? "high" : aiEnabled ? "normal" : "low";
  const contactName = detail.customer ? `${detail.customer.firstname ?? ""} ${detail.customer.lastname ?? ""}`.trim() || null : null;
  const writeEnabled = isDbWriteEnabled();

  const resolutionStatus = detail.customer ? "linked" : conversation.customer_id ? "found" : "unresolved";

  const data: ConversationWorkspaceData = {
    header: {
      conversationPublicId: conversation.public_id,
      contactName,
      waId: conversation.external_contact_id,
      channel: conversation.channel,
      status: status || "desconocido",
      ownerType: conversation.owner_type,
      priority,
      windowOpen,
      controlMode: deriveAiControlMode(aiEnabled, humanOwnerActive),
      closed,
      writeEnabled
    },
    messages: thread.messages,
    threadError: thread.error,
    truncated: thread.truncated,
    writeEnabled,
    canReply: writeEnabled && !closed,
    context: {
      summary: {
        status: status || "desconocido",
        priority,
        owner: conversation.owner_type,
        department: humanOwnerActive ? "human_handoff" : "ai_sdr",
        windowOpen,
        summary: detail.opportunity?.currentSummary ?? null,
        intent: detail.opportunity?.primaryIntent ?? null,
        waitingFor: detail.opportunity?.waitingFor ?? null,
        nextActionType: detail.opportunity?.nextActionType ?? null,
        nextActionDueAt: detail.opportunity?.nextActionDueAt ?? null
      },
      customer: {
        resolutionStatus,
        name: contactName,
        waId: conversation.external_contact_id,
        email: detail.customer?.email ?? null,
        platformOrigin: detail.customer?.platform_origin ?? null,
        customerId: detail.customer?.id != null ? String(detail.customer.id) : null
      },
      commercial: {
        opportunity: detail.opportunity
          ? {
              opportunityKey: detail.opportunity.opportunityKey,
              status: detail.opportunity.status,
              stage: detail.opportunity.stage,
              currentSummary: detail.opportunity.currentSummary
            }
          : null,
        salesNeedProfile: detail.profile
          ? {
              useCase: detail.profile.useCase,
              customerType: detail.profile.customerType,
              budgetMin: detail.profile.budgetMin,
              budgetMax: detail.profile.budgetMax,
              purchaseUrgency: detail.profile.purchaseUrgency,
              decisionReadiness: detail.profile.decisionReadiness,
              experienceLevel: detail.profile.experienceLevel,
              missingInformation: detail.profile.missingInformation ?? []
            }
          : null
      },
      autonomous,
      customerDetail
    }
  };

  return <ConversationWorkspace data={data} />;
}
