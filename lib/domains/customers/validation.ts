import { normalizeEmail } from "@/lib/customer-identity/normalize";
import { isPlatformOrigin, type PlatformOrigin } from "./platform-origin";

type PlainObject = Record<string, unknown>;

function pickString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export type ValidatedCreateCustomerInput = {
  firstname: string;
  lastname: string;
  email: string;
  platformOrigin: PlatformOrigin;
};

export type ValidationFailure = {
  error: string;
  status: number;
};

export function validateCreateCustomerPayload(payload: unknown):
  | { ok: true; data: ValidatedCreateCustomerInput }
  | { ok: false; failure: ValidationFailure } {
  if (!isPlainObject(payload)) {
    return { ok: false, failure: { error: "invalid_json", status: 400 } };
  }

  const allowedKeys = new Set(["firstname", "lastname", "email", "platformOrigin"]);
  const payloadKeys = Object.keys(payload);
  if (payloadKeys.some((key) => !allowedKeys.has(key))) {
    return { ok: false, failure: { error: "unknown_payload_fields", status: 400 } };
  }

  const firstname = pickString(payload.firstname);
  const lastname = pickString(payload.lastname);
  const email = normalizeEmail(pickString(payload.email));
  const platformOriginRaw = pickString(payload.platformOrigin).toLowerCase();

  if (!firstname) return { ok: false, failure: { error: "firstname_required", status: 400 } };
  if (!lastname) return { ok: false, failure: { error: "lastname_required", status: 400 } };
  if (!email || !isValidEmail(email)) return { ok: false, failure: { error: "invalid_email", status: 400 } };
  if (!platformOriginRaw) return { ok: false, failure: { error: "platform_origin_required", status: 400 } };
  if (!isPlatformOrigin(platformOriginRaw)) return { ok: false, failure: { error: "invalid_platform_origin", status: 400 } };

  return {
    ok: true,
    data: {
      firstname,
      lastname,
      email,
      platformOrigin: platformOriginRaw
    }
  };
}
