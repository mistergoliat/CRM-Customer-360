"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ChatsPage;
const PageHeader_1 = require("@/components/ui/PageHeader");
const StatusChip_1 = require("@/components/ui/StatusChip");
const ChatInbox_1 = require("@/components/chats/ChatInbox");
const chats_1 = require("@/lib/chats");
const write_access_1 = require("@/lib/write-access");
function getParam(searchParams, key) {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
}
async function ChatsPage({ searchParams }) {
    const sp = await searchParams;
    const caseId = getParam(sp, "caseId") || null;
    const q = getParam(sp, "q") || "";
    const writeEnabled = (0, write_access_1.isDbWriteEnabled)();
    const data = await (0, chats_1.getInitialChatView)(caseId, q);
    return (<>
      <PageHeader_1.PageHeader eyebrow="Live Chats" title="Inbox operativo" description="Bandeja de conversaciones WhatsApp en vivo con lista priorizada, timeline por polling y contexto del caso en modo read-only." status="Parcial" actions={<StatusChip_1.StatusChip label={writeEnabled ? "writer enabled" : "read only"} tone={writeEnabled ? "green" : "amber"}/>}/>
      <ChatInbox_1.ChatInbox initialList={data.list} initialSelectedCaseId={data.selectedCaseId} initialContext={data.context.ok ? data.context.row : null} initialMessages={data.messages.ok ? data.messages.rows : []} initialSource={data.messages.source} writeEnabled={writeEnabled} initialQuery={q}/>
    </>);
}
