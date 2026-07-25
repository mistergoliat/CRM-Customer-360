/**
 * Decision 3 (approved audit): server-side only, fixed format `********1234` -
 * exactly 8 asterisks + the last 4 characters, never the real length. The
 * full wa_id must never reach a client response - this is the only function
 * allowed to render a wa_id for this domain.
 */
export function maskWaId(waId: string | null | undefined): string | null {
  if (typeof waId !== "string") return null;
  const trimmed = waId.trim();
  if (!trimmed) return null;
  const last4 = trimmed.slice(-4);
  return `********${last4}`;
}
