import type { BrainContextResolveResponse } from "@/lib/brain/context/types";
import type { BrainNormalizedProcessInboundRequest } from "@/lib/brain/inbound/types";
import type { CustomerOnboardingContext, CustomerOnboardingCustomerContext, CustomerConversationLinkRecord, CustomerOnboardingStateRecord } from "./types";

const EXPLICIT_CONFIRMATION_PHRASES = [
  "si",
  "sí",
  "sí, creala",
  "si, creala",
  "crear cuenta",
  "dale",
  "ok, creala",
  "quiero crearla",
  "confirmo",
  "confirmo la creacion",
  "confirmo la creacion de la cuenta"
];

const NEGATIVE_CONFIRMATION_PHRASES = ["quizas", "quizás", "despues", "después", "no se", "no sé", "veamos", "puede ser"];

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

export function extractEmailCandidates(text: string) {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  const normalized = [...new Set(matches.map((email) => email.trim().toLowerCase()))];
  if (normalized.length === 0) return { status: "absent" as const, emails: [] as string[] };
  if (normalized.length > 1) return { status: "ambiguous" as const, emails: normalized };
  return { status: "single" as const, emails: normalized };
}

export function isExplicitCustomerConfirmation(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return { status: "absent" as const, value: false };
  if (NEGATIVE_CONFIRMATION_PHRASES.some((phrase) => normalized === normalizeText(phrase) || normalized.includes(` ${normalizeText(phrase)} `))) {
    return { status: "negative" as const, value: false };
  }
  if (EXPLICIT_CONFIRMATION_PHRASES.some((phrase) => normalized === normalizeText(phrase) || normalized.includes(normalizeText(phrase)))) {
    return { status: "explicit" as const, value: true };
  }
  return { status: "implicit" as const, value: false };
}

function buildCustomerContext(input: BrainContextResolveResponse): CustomerOnboardingCustomerContext | null {
  const customer = input.customer_context ?? null;
  if (!customer) return null;

  return {
    customer: {
      id: asText(customer.id_customer ?? null) ?? "",
      firstname: asText(customer.contact_name ?? null) ?? "",
      lastname: "",
      email: asText(customer.email ?? null) ?? "",
      platformOrigin: "unknown"
    },
    recentConversations: [],
    openCases: [],
    recentOrders: [],
    warnings: [],
    dataQuality: {
      status: customer.id_customer || customer.email ? "partial" : "unavailable",
      warnings: [],
      source: "brain_context"
    }
  };
}

export function buildCustomerOnboardingContext(input: {
  inboundMessage: BrainNormalizedProcessInboundRequest;
  brainContext: BrainContextResolveResponse;
  currentState: CustomerOnboardingStateRecord | null;
  currentLink: CustomerConversationLinkRecord | null;
  customerContext: CustomerOnboardingCustomerContext | null;
}): CustomerOnboardingContext {
  const emails = extractEmailCandidates(input.inboundMessage.messageText);
  const confirmation = isExplicitCustomerConfirmation(input.inboundMessage.messageText);
  const normalizedMessage = normalizeText(input.inboundMessage.messageText);

  return {
    conversationCaseId: input.inboundMessage.conversationCaseId ?? input.brainContext.case_context?.active_case?.conversation_case_id ?? null,
    waId: input.inboundMessage.waId ?? input.brainContext.customer_context?.wa_id ?? null,
    messageText: input.inboundMessage.messageText,
    normalizedMessage,
    messageId: input.inboundMessage.messageId ?? null,
    emails: emails.emails,
    emailStatus: emails.status,
    confirmationStatus: confirmation.status,
    currentState: input.currentState,
    currentLink: input.currentLink,
    customerContext: input.customerContext ?? buildCustomerContext(input.brainContext),
    platformOrigin: input.currentState?.customerPlatformOrigin ?? null,
    pendingAction: input.currentState?.pendingAction ?? null
  };
}

export function getCustomerOnboardingDisplayName(customer: { firstname: string | null; lastname: string | null; email: string | null } | null) {
  if (!customer) return null;
  const fullName = [customer.firstname, customer.lastname].filter(Boolean).join(" ").trim();
  return fullName.length > 0 ? fullName : customer.email ?? null;
}
