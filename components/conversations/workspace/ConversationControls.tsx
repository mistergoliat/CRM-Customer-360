"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { AiControlMode } from "@/lib/domains/conversations/thread";

type ConversationControlsProps = {
  conversationPublicId: string;
  controlMode: AiControlMode;
  closed: boolean;
  writeEnabled: boolean;
};

type ControlAction = "take" | "release" | "pause" | "close" | "reopen";

/**
 * Operator control actions. The buttons only trigger backend transitions
 * (POST /control); the authoritative state lives in the conversation row and
 * is re-read via router.refresh() after each change.
 */
export function ConversationControls({ conversationPublicId, controlMode, closed, writeEnabled }: ConversationControlsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<ControlAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function apply(action: ControlAction) {
    if (pending) return;
    setPending(action);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationPublicId}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message || data?.error || `Error ${res.status}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red.");
    } finally {
      setPending(null);
    }
  }

  if (!writeEnabled) return null;

  const button = (action: ControlAction, label: string, primary = false) => (
    <button
      key={action}
      type="button"
      className={clsx(primary ? "hub-button-primary" : "hub-button-secondary", pending && "opacity-50")}
      disabled={pending !== null}
      onClick={() => void apply(action)}
    >
      {pending === action ? "…" : label}
    </button>
  );

  const buttons: React.ReactNode[] = [];
  if (closed) {
    buttons.push(button("reopen", "Reabrir", true));
  } else {
    if (controlMode === "ai_autonomous") {
      buttons.push(button("take", "Tomar control", true), button("pause", "Pausar IA"));
    } else if (controlMode === "human") {
      buttons.push(button("release", "Devolver a IA", true));
    } else {
      buttons.push(button("take", "Tomar control", true), button("release", "Reactivar IA"));
    }
    buttons.push(button("close", "Finalizar"));
  }

  return (
    <div className="flex items-center gap-2">
      {buttons}
      {error ? <span className="text-label-sm text-red-600">{error}</span> : null}
    </div>
  );
}
