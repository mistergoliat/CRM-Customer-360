"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatInbox = ChatInbox;
const react_1 = require("react");
const navigation_1 = require("next/navigation");
const action_policy_1 = require("@/lib/action-policy");
const format_1 = require("@/lib/format");
const StatusChip_1 = require("@/components/ui/StatusChip");
const Icon_1 = require("@/components/ui/Icon");
const EmptyState_1 = require("@/components/ui/EmptyState");
function isTruthy(value) {
    return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}
function directionTone(direction) {
    if (direction === "inbound")
        return "gray";
    if (direction === "system")
        return "amber";
    return "blue";
}
function bubbleClass(direction) {
    if (direction === "inbound")
        return "max-w-[82%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3";
    if (direction === "system")
        return "max-w-[82%] rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3";
    return "ml-auto max-w-[82%] rounded-2xl rounded-br-sm border border-sky-100 bg-sky-50 px-4 py-3";
}
function ChatInbox({ initialList, initialSelectedCaseId, initialContext, initialMessages, initialSource, writeEnabled, initialQuery }) {
    const router = (0, navigation_1.useRouter)();
    const pathname = (0, navigation_1.usePathname)();
    const searchParams = (0, navigation_1.useSearchParams)();
    const viewportRef = (0, react_1.useRef)(null);
    const [list, setList] = (0, react_1.useState)(initialList);
    const [selectedCaseId, setSelectedCaseId] = (0, react_1.useState)(initialSelectedCaseId);
    const [context, setContext] = (0, react_1.useState)(initialContext);
    const [messages, setMessages] = (0, react_1.useState)(initialMessages);
    const [source, setSource] = (0, react_1.useState)(initialSource);
    const [query, setQuery] = (0, react_1.useState)(initialQuery);
    const [draftQuery, setDraftQuery] = (0, react_1.useState)(initialQuery);
    const [loadingChat, setLoadingChat] = (0, react_1.useState)(false);
    const [page, setPage] = (0, react_1.useState)(initialList.page);
    const [error, setError] = (0, react_1.useState)("");
    async function fetchList(targetPage = page, targetQuery = query) {
        const params = new URLSearchParams();
        params.set("page", String(targetPage));
        if (targetQuery)
            params.set("q", targetQuery);
        const response = await fetch(`/api/chats?${params.toString()}`, { cache: "no-store" });
        const data = (await response.json());
        if (!response.ok)
            throw new Error(data.error || "No se pudo cargar la lista de chats");
        return data;
    }
    async function fetchContext(caseId) {
        const response = await fetch(`/api/chats/${caseId}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok)
            throw new Error(data.error || "No se pudo cargar el contexto");
        return data;
    }
    async function fetchMessages(caseId) {
        const response = await fetch(`/api/chats/${caseId}/messages`, { cache: "no-store" });
        const data = (await response.json());
        if (!response.ok)
            throw new Error(data.error || "No se pudo cargar la conversacion");
        return data;
    }
    async function hydrateChat(caseId, listSnapshot) {
        setLoadingChat(true);
        setError("");
        try {
            const [nextContext, nextMessages] = await Promise.all([fetchContext(caseId), fetchMessages(caseId)]);
            (0, react_1.startTransition)(() => {
                if (listSnapshot)
                    setList(listSnapshot);
                setSelectedCaseId(caseId);
                setContext(nextContext);
                setMessages(nextMessages.rows);
                setSource(nextMessages.source);
            });
        }
        catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el chat");
        }
        finally {
            setLoadingChat(false);
        }
    }
    function pushSelection(nextCaseId, nextPage = page, nextQuery = query) {
        const params = new URLSearchParams();
        if (nextCaseId)
            params.set("caseId", nextCaseId);
        if (nextPage > 1)
            params.set("page", String(nextPage));
        if (nextQuery)
            params.set("q", nextQuery);
        router.replace(params.toString() ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
    }
    (0, react_1.useEffect)(() => {
        if (!viewportRef.current)
            return;
        viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }, [messages]);
    (0, react_1.useEffect)(() => {
        const interval = window.setInterval(async () => {
            try {
                const nextList = await fetchList(page, query);
                (0, react_1.startTransition)(() => setList(nextList));
                const currentCaseId = selectedCaseId || (nextList.rows[0] ? String(nextList.rows[0].conversation_case_id) : null);
                if (!currentCaseId)
                    return;
                const [nextContext, nextMessages] = await Promise.all([fetchContext(currentCaseId), fetchMessages(currentCaseId)]);
                (0, react_1.startTransition)(() => {
                    setSelectedCaseId(currentCaseId);
                    setContext(nextContext);
                    setMessages(nextMessages.rows);
                    setSource(nextMessages.source);
                });
            }
            catch {
                // Keep polling quiet in read-only inbox.
            }
        }, 8000);
        return () => window.clearInterval(interval);
    }, [page, query, selectedCaseId]);
    async function selectChat(caseId) {
        pushSelection(caseId);
        await hydrateChat(caseId);
    }
    async function submitSearch(event) {
        event.preventDefault();
        setPage(1);
        setQuery(draftQuery);
        pushSelection(selectedCaseId, 1, draftQuery);
        try {
            const nextList = await fetchList(1, draftQuery);
            const fallbackCaseId = selectedCaseId && nextList.rows.some((row) => String(row.conversation_case_id) === selectedCaseId)
                ? selectedCaseId
                : nextList.rows[0]
                    ? String(nextList.rows[0].conversation_case_id)
                    : null;
            (0, react_1.startTransition)(() => setList(nextList));
            if (fallbackCaseId) {
                pushSelection(fallbackCaseId, 1, draftQuery);
                await hydrateChat(fallbackCaseId, nextList);
            }
            else {
                setSelectedCaseId(null);
                setContext(null);
                setMessages([]);
                setSource("empty");
            }
        }
        catch (searchError) {
            setError(searchError instanceof Error ? searchError.message : "No se pudo filtrar la bandeja");
        }
    }
    async function goToPage(nextPage) {
        const bounded = Math.max(1, nextPage);
        setPage(bounded);
        pushSelection(selectedCaseId, bounded, query);
        try {
            const nextList = await fetchList(bounded, query);
            (0, react_1.startTransition)(() => setList(nextList));
        }
        catch (pageError) {
            setError(pageError instanceof Error ? pageError.message : "No se pudo paginar");
        }
    }
    const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize));
    return (<div className="grid min-h-[78vh] gap-4 xl:grid-cols-[360px_minmax(0,1fr)_320px]">
      <section className="hub-card flex min-h-0 flex-col overflow-hidden">
        <div className="border-b border-slate-200 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-headline-md text-on-surface">Inbox en vivo</p>
              <p className="text-label-sm text-slate-500">{list.total} conversaciones detectadas</p>
            </div>
            <StatusChip_1.StatusChip label={writeEnabled ? "writer enabled" : "read only"} tone={writeEnabled ? "green" : "amber"}/>
          </div>
          <form className="flex gap-2" onSubmit={submitSearch}>
            <input className="hub-input flex-1" value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder="Buscar cliente, wa_id, orden, factura"/>
            <button className="hub-button-secondary" type="submit">
              Filtrar
            </button>
          </form>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.rows.length === 0 ? (<div className="p-4">
              <EmptyState_1.EmptyState title="Sin chats" description="No hay conversaciones para estos filtros." icon="chat"/>
            </div>) : (<div className="divide-y divide-slate-100">
              {list.rows.map((chat) => {
                const active = String(chat.conversation_case_id) === selectedCaseId;
                return (<button key={chat.conversation_case_id} className={`w-full border-l-4 px-4 py-4 text-left transition ${active ? "border-primary-container bg-primary-fixed/40" : "border-transparent hover:bg-slate-50"}`} onClick={() => void selectChat(String(chat.conversation_case_id))}>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-body-md font-semibold text-on-surface">{(0, format_1.asText)(chat.contact_name, "sin nombre")}</p>
                        <p className="truncate text-label-sm text-slate-500">{(0, format_1.asText)(chat.wa_id)}</p>
                      </div>
                      <p className="shrink-0 text-label-sm text-slate-500">{(0, format_1.formatDateTime)(chat.last_message_at || chat.updated_at)}</p>
                    </div>
                    <p className="mb-3 text-body-md text-slate-600">{(0, format_1.truncate)(chat.last_message, 88)}</p>
                    <div className="flex flex-wrap gap-1">
                      <StatusChip_1.StatusChip label={(0, format_1.asText)(chat.status)}/>
                      {chat.department ? <StatusChip_1.StatusChip label={chat.department} tone="gray"/> : null}
                      {chat.service_code ? <StatusChip_1.StatusChip label={chat.service_code} tone="gray"/> : null}
                      {isTruthy(chat.requires_human) ? <StatusChip_1.StatusChip label="humano" tone="red"/> : null}
                      {chat.priority ? <StatusChip_1.StatusChip label={chat.priority}/> : null}
                      <StatusChip_1.StatusChip label={isTruthy(chat.whatsapp_window_open) ? "24h abierta" : "24h cerrada"} tone={isTruthy(chat.whatsapp_window_open) ? "green" : "amber"}/>
                      {chat.message_count !== null ? <StatusChip_1.StatusChip label={`${chat.message_count} msg`} tone="gray"/> : null}
                    </div>
                  </button>);
            })}
            </div>)}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <p className="text-label-sm text-slate-500">
            Pagina {list.page} de {totalPages}
          </p>
          <div className="flex gap-2">
            <button className="hub-button-secondary" disabled={list.page <= 1} onClick={() => void goToPage(list.page - 1)}>
              Anterior
            </button>
            <button className="hub-button-secondary" disabled={list.page >= totalPages} onClick={() => void goToPage(list.page + 1)}>
              Siguiente
            </button>
          </div>
        </div>
      </section>

      <section className="hub-card flex min-h-0 flex-col overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-headline-md text-on-surface">{context?.contact_name || "Conversacion"}</p>
              <p className="text-label-sm text-slate-500">
                {context?.wa_id || "sin wa_id"} · Fuente timeline: {source}
              </p>
            </div>
            {loadingChat ? <StatusChip_1.StatusChip label="actualizando" tone="amber"/> : <StatusChip_1.StatusChip label="live" tone="green"/>}
          </div>
        </div>

        <div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 px-5 py-5">
          {messages.length === 0 ? (<EmptyState_1.EmptyState title="Sin mensajes" description="No hay mensajes para esta conversacion." icon="chat_bubble"/>) : (<div className="space-y-4">
              {messages.map((message) => (<div key={message.key}>
                  <div className={bubbleClass(message.direction)}>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <StatusChip_1.StatusChip label={message.direction} tone={directionTone(message.direction)}/>
                      {message.status ? <StatusChip_1.StatusChip label={message.status}/> : null}
                      {message.intent ? <StatusChip_1.StatusChip label={message.intent} tone="amber"/> : null}
                      {message.department ? <StatusChip_1.StatusChip label={message.department} tone="gray"/> : null}
                    </div>
                    <p className="whitespace-pre-wrap text-body-md text-on-surface">{message.body}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-label-sm text-slate-500">
                      <span>{(0, format_1.formatDateTime)(message.occurredAt)}</span>
                      {message.providerMessageId ? <span>Provider: {message.providerMessageId}</span> : null}
                    </div>
                  </div>
                </div>))}
            </div>)}
        </div>

        <div className="border-t border-slate-200 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Icon_1.Icon name="edit_square" className="text-slate-500"/>
            <p className="text-label-bold uppercase text-slate-500">Composer</p>
          </div>
          <textarea className="hub-textarea min-h-24 w-full resize-none bg-slate-50" placeholder="Respuesta operacional" disabled value="" readOnly/>
          <p className="mt-3 text-body-md text-slate-500">
            Respuesta deshabilitada: requiere credencial writer y trazabilidad DB antes de enviar por Meta.
          </p>
          {!writeEnabled ? (<div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-label-sm text-amber-900">
              {action_policy_1.DB_WRITE_DISABLED_MESSAGE}
            </div>) : null}
        </div>
      </section>

      <aside className="hub-card flex min-h-0 flex-col overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4">
          <p className="text-headline-md text-on-surface">Contexto</p>
          <p className="text-label-sm text-slate-500">Caso y señales operativas del chat seleccionado.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!context ? (<EmptyState_1.EmptyState title="Sin contexto" description="Selecciona una conversacion para ver su detalle." icon="info"/>) : (<div className="grid gap-3">
              {[
                ["Case ID", context.conversation_case_id],
                ["Active case key", context.active_case_key],
                ["Status", context.status],
                ["Department", context.department],
                ["Service code", context.service_code],
                ["Priority", context.priority],
                ["Requires human", isTruthy(context.requires_human) ? "si" : "no"],
                ["Bot replied", isTruthy(context.bot_replied) ? "si" : "no"],
                ["Final action", context.final_action],
                ["Order", context.id_order],
                ["Invoice", context.invoice_number],
                ["Source table", context.source_table],
                ["Source ID", context.source_id],
                ["Phone number ID", context.phone_number_id],
                ["WhatsApp window", isTruthy(context.whatsapp_window_open) ? "abierta" : "cerrada"]
            ].map(([label, value]) => (<div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-label-bold uppercase text-slate-500">{label}</p>
                  <p className="mt-1 break-words text-body-md font-semibold text-on-surface">{(0, format_1.asText)(value)}</p>
                </div>))}
            </div>)}
          {error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-body-md text-red-700">{error}</p> : null}
        </div>
      </aside>
    </div>);
}
