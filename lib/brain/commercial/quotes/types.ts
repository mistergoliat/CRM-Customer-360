import type { AddressSnapshot } from "@/lib/domains/customer-addresses";

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected", "expired", "superseded"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export type QuoteItem = {
  /** Catalog snapshot at quote time - never a live reference. */
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type QuoteTotals = {
  subtotal: number;
  shipping: number | null;
  total: number;
  currency: string;
};

export type CommercialQuote = {
  contractName: "CommercialQuote";
  schemaVersion: "1.0.0";
  quoteId: string;
  requestId: string;
  conversationId: number;
  opportunityId: number | null;
  customerId: number | null;
  createdByActionId: string | null;
  version: number;
  status: QuoteStatus;
  items: QuoteItem[];
  totals: QuoteTotals;
  addressSnapshot: AddressSnapshot | null;
  expiryAt: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  decidedAt: string | null;
};

export type CreateQuoteDraftInput = {
  requestId: string;
  items: QuoteItem[];
  totals: QuoteTotals;
  addressSnapshot?: AddressSnapshot | null;
  expiryAt?: string | null;
  opportunityId?: number | null;
  customerId?: number | null;
  createdByActionId?: string | null;
};

export type CreateQuoteDraftResult =
  | { ok: true; status: "created" | "duplicate"; quote: CommercialQuote }
  | { ok: false; status: "request_not_found" | "invalid_input" | "conflict" | "error"; quote: null; warning: string };

export type QuoteMutationResult =
  | { ok: true; quote: CommercialQuote }
  | { ok: false; status: "not_found" | "conflict" | "error"; quote: CommercialQuote | null; warning: string };
