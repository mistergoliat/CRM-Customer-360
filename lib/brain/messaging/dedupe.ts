import crypto from "node:crypto";
import type { BrainExecutionActionType, BrainExecutionSource } from "./types";

export type BrainDedupeKeyInput = {
  source: BrainExecutionSource;
  actionType: BrainExecutionActionType;
  channel?: "whatsapp";
  waId?: string;
  phoneNumberId?: string;
  messageId?: string;
  conversationCaseId?: string | number;
  messageText?: string;
  sourceRequestId?: string | null;
};

export type BrainDedupeCheckResult = {
  checked: boolean;
  duplicate_detected: boolean;
  dedupe_key: string;
  reason: string;
};

function normalizePart(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function hashMessageText(messageText: string) {
  const normalized = messageText
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function buildDedupeKey(input: BrainDedupeKeyInput) {
  const messageHash = input.messageText ? hashMessageText(input.messageText) : "";
  const hash = crypto
    .createHash("sha256")
    .update(
      [
        normalizePart(input.channel ?? "whatsapp"),
        normalizePart(input.actionType),
        normalizePart(input.waId),
        normalizePart(input.phoneNumberId),
        normalizePart(input.conversationCaseId),
        messageHash,
        normalizePart(input.sourceRequestId)
      ].join("|")
    )
    .digest("hex")
    .slice(0, 24);

  return `brain-outbox-${hash}`;
}

export function checkDuplicateNoop(input: BrainDedupeKeyInput): BrainDedupeCheckResult {
  return {
    checked: false,
    duplicate_detected: false,
    dedupe_key: buildDedupeKey(input),
    reason: "duplicate check skipped in dry-run"
  };
}
