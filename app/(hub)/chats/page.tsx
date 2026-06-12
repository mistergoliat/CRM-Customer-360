import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChip } from "@/components/ui/StatusChip";
import { ChatInbox } from "@/components/chats/ChatInbox";
import { getInitialChatView } from "@/lib/chats";
import { isDbWriteEnabled } from "@/lib/write-access";

type ChatsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getParam(searchParams: Record<string, string | string[] | undefined>, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function ChatsPage({ searchParams }: ChatsPageProps) {
  const sp = await searchParams;
  const caseId = getParam(sp, "caseId") || null;
  const q = getParam(sp, "q") || "";
  const writeEnabled = isDbWriteEnabled();
  const data = await getInitialChatView(caseId, q);

  return (
    <>
      <PageHeader
        eyebrow="Live Chats"
        title="Inbox operativo"
        description="Bandeja de conversaciones WhatsApp en vivo con lista priorizada, timeline por polling y contexto del caso en modo read-only."
        status="Parcial"
        actions={<StatusChip label={writeEnabled ? "writer enabled" : "read only"} tone={writeEnabled ? "green" : "amber"} />}
      />
      <ChatInbox
        initialList={data.list}
        initialSelectedCaseId={data.selectedCaseId}
        initialContext={data.context.ok ? data.context.row : null}
        initialMessages={data.messages.ok ? data.messages.rows : []}
        initialSource={data.messages.source}
        writeEnabled={writeEnabled}
        initialQuery={q}
      />
    </>
  );
}
