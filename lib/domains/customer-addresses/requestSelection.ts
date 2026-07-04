import { appendRequestEvent, linkMessageToRequest } from "@/lib/brain/commercial/conversation-request";
import { confirmRequestFact, getActiveRequestFact, upsertRequestFact } from "@/lib/brain/commercial/request-facts";
import { validateCustomerAddressOwnership } from "./repository";
import type { AddressReadinessResult, AddressRequestSelectionResult, AddressSnapshot, CustomerAddress } from "./types";

export const DELIVERY_ADDRESS_FACT_KEY = "delivery_address_id";

/**
 * Selecting an address proposes it for THIS request only (fact stays
 * `inferred`). It never confirms: registering, selecting and confirming are
 * three distinct actions by design.
 */
export async function selectAddressForRequest(input: {
  requestId: string;
  customerId: number;
  addressId: string;
  sourceMessageId?: string | null;
}): Promise<AddressRequestSelectionResult> {
  const owned = await validateCustomerAddressOwnership(input.customerId, input.addressId);
  if (!owned.ok) return { ok: false, status: owned.status, warning: owned.warning };

  const current = await getActiveRequestFact(input.requestId, DELIVERY_ADDRESS_FACT_KEY);
  if (!current || current.value !== input.addressId) {
    const upsert = await upsertRequestFact({
      requestId: input.requestId,
      factKey: DELIVERY_ADDRESS_FACT_KEY,
      value: input.addressId,
      sourceMessageId: input.sourceMessageId ?? null
    });
    if (!upsert.ok) return { ok: false, status: "error", warning: upsert.warning };
  }

  await appendRequestEvent({
    dedupeKey: `request:${input.requestId}:address:${input.addressId}:address_selected`,
    requestId: input.requestId,
    eventType: "address_selected",
    sourceType: "system",
    sourceId: input.addressId,
    payload: { addressId: input.addressId },
    occurredAt: new Date().toISOString()
  });

  return { ok: true, status: "selected", addressId: input.addressId };
}

/**
 * Confirmation is the customer's explicit approval for THIS request. The fact
 * must already point at the same address - confirming an address nobody
 * selected, or a different one, is a hard error, never a silent fix.
 */
export async function confirmAddressForRequest(input: {
  requestId: string;
  customerId: number;
  addressId: string;
  sourceMessageId?: string | null;
}): Promise<AddressRequestSelectionResult> {
  const owned = await validateCustomerAddressOwnership(input.customerId, input.addressId);
  if (!owned.ok) return { ok: false, status: owned.status, warning: owned.warning };

  const current = await getActiveRequestFact(input.requestId, DELIVERY_ADDRESS_FACT_KEY);
  if (!current) return { ok: false, status: "no_selection", warning: `Request ${input.requestId} has no selected address to confirm.` };
  if (current.value !== input.addressId) {
    return {
      ok: false,
      status: "selection_mismatch",
      warning: `Request ${input.requestId} has ${String(current.value)} selected, not ${input.addressId}.`
    };
  }

  if (current.status !== "confirmed" && current.status !== "verified") {
    const confirmed = await confirmRequestFact(input.requestId, DELIVERY_ADDRESS_FACT_KEY);
    if (!confirmed.ok) return { ok: false, status: "error", warning: confirmed.warning };
  }

  await appendRequestEvent({
    dedupeKey: `request:${input.requestId}:address:${input.addressId}:address_confirmed`,
    requestId: input.requestId,
    eventType: "address_confirmed",
    sourceType: input.sourceMessageId ? "customer_message" : "system",
    sourceId: input.sourceMessageId ?? input.addressId,
    payload: { addressId: input.addressId },
    occurredAt: new Date().toISOString()
  });

  if (input.sourceMessageId) {
    await linkMessageToRequest({
      requestId: input.requestId,
      messageId: input.sourceMessageId,
      relationType: "confirmed",
      linkedBy: "deterministic"
    });
  }

  return { ok: true, status: "confirmed", addressId: input.addressId };
}

/**
 * The gate every location-dependent physical action must pass: a confirmed
 * fact for THIS request, pointing at an address that belongs to the customer,
 * is active, and is complete. Anything missing means waiting_customer, never
 * a silent fill-in from another request.
 */
export async function validateAddressReadyForPhysicalAction(input: {
  requestId: string;
  customerId: number;
}): Promise<AddressReadinessResult> {
  const reasons: string[] = [];
  const fact = await getActiveRequestFact(input.requestId, DELIVERY_ADDRESS_FACT_KEY);

  if (!fact) return { ready: false, reasons: ["no_address_selected"], address: null };
  if (fact.status !== "confirmed" && fact.status !== "verified") reasons.push("address_not_confirmed");

  const addressId = typeof fact.value === "string" ? fact.value : null;
  if (!addressId) return { ready: false, reasons: [...reasons, "invalid_address_reference"], address: null };

  const owned = await validateCustomerAddressOwnership(input.customerId, addressId);
  if (!owned.ok) return { ready: false, reasons: [...reasons, owned.status], address: null };

  const address = owned.address;
  if (!address.streetName || !address.streetNumber || !address.commune || !address.region) {
    reasons.push("address_incomplete");
  }

  return { ready: reasons.length === 0, reasons, address };
}

export function createAddressSnapshot(address: CustomerAddress): AddressSnapshot {
  return {
    addressId: address.addressId,
    recipientName: address.recipientName,
    recipientPhone: address.recipientPhone,
    streetName: address.streetName,
    streetNumber: address.streetNumber,
    unit: address.unit,
    commune: address.commune,
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
    deliveryNotes: address.deliveryNotes
  };
}
