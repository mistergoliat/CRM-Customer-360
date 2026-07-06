"use client";

import { useCallback, useEffect, useState } from "react";
import { ConversationHeader } from "./ConversationHeader";
import { ConversationThread } from "./ConversationThread";
import { ConversationComposer } from "./ConversationComposer";
import { ConversationContextPanel } from "./ConversationContextPanel";
import type { ConversationWorkspaceData } from "./types";
import type { ConversationThreadMessage } from "@/lib/domains/conversations/thread";

function dedupeSort(messages: ConversationThreadMessage[]): ConversationThreadMessage[] {
  const byKey = new Map<string, ConversationThreadMessage>();
  for (const message of messages) byKey.set(message.key, message);
  return [...byKey.values()].sort((a, b) => {
    const at = a.occurredAt ? Date.parse(a.occurredAt) : 0;
    const bt = b.occurredAt ? Date.parse(b.occurredAt) : 0;
    if (at !== bt) return at - bt;
    return a.key.localeCompare(b.key);
  });
}

export function ConversationWorkspace({ data }: { data: ConversationWorkspaceData }) {
  const [messages, setMessages] = useState<ConversationThreadMessage[]>(data.messages);
  const [contextOpen, setContextOpen] = useState(false);
  const [truncated, setTruncated] = useState(data.truncated);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Wide screens open the context panel by default; medium/small stay closed (drawer).
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches) {
      setContextOpen(true);
    }
  }, []);

  const handleSent = useCallback((message: ConversationThreadMessage) => {
    setMessages((prev) => dedupeSort([...prev, message]));
  }, []);

  const handleLoadOlder = useCallback(async () => {
    const oldest = messages[0]?.occurredAt;
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await fetch(`/api/conversations/${data.header.conversationPublicId}/messages?before=${encodeURIComponent(oldest)}`);
      const payload = await res.json().catch(() => null);
      const older = Array.isArray(payload?.messages) ? (payload.messages as ConversationThreadMessage[]) : [];
      if (older.length > 0) {
        setMessages((prev) => dedupeSort([...older, ...prev]));
      }
      setTruncated(Boolean(payload?.truncated) && older.length > 0);
    } catch {
      setTruncated(false);
    } finally {
      setLoadingOlder(false);
    }
  }, [messages, loadingOlder, data.header.conversationPublicId]);

  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <ConversationHeader data={data.header} contextOpen={contextOpen} onToggleContext={() => setContextOpen((v) => !v)} />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <ConversationThread
            messages={messages}
            error={data.threadError}
            canLoadOlder={truncated}
            loadingOlder={loadingOlder}
            onLoadOlder={() => void handleLoadOlder()}
          />
          <ConversationComposer
            conversationPublicId={data.header.conversationPublicId}
            writeEnabled={data.writeEnabled}
            closed={data.header.closed}
            windowOpen={data.header.windowOpen}
            onSent={handleSent}
          />
        </div>

        {contextOpen ? (
          <>
            <div className="fixed inset-0 z-30 bg-black/30 xl:hidden" onClick={() => setContextOpen(false)} />
            <aside className="fixed right-0 top-0 z-40 h-full w-[360px] border-l border-slate-200 xl:static xl:z-auto xl:w-[380px]">
              <ConversationContextPanel data={data} onClose={() => setContextOpen(false)} />
            </aside>
          </>
        ) : null}
      </div>
    </div>
  );
}
