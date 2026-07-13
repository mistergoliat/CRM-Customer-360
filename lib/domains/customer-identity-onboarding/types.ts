import type { PlatformOrigin } from "@/lib/domains/customers/platform-origin";
import type { CustomerRecord } from "@/lib/domains/customers/types";

export type CustomerIdentityResolutionStatus =
  | "unresolved"
  | "email_requested"
  | "email_provided"
  | "matching"
  | "matched"
  | "creation_permission_requested"
  | "creation_authorized"
  | "created"
  | "conflict"
  | "human_review_required";

export type CustomerMatchResult =
  | { status: "not_found"; customers: [] }
  | { status: "matched"; customers: [CustomerRecord] }
  | { status: "conflict"; customers: CustomerRecord[] }
  | { status: "error"; customers: [] };

export type CustomerCreationConsent = {
  granted: boolean;
  email: string;
  sourceMessageId: string;
  grantedAt: string;
  channel: string;
};

export type ContactIdentity = {
  identityId: string;
  provider: "whatsapp" | string;
  identityType: "phone" | "email" | string;
  externalId: string;
  normalizedValue: string;
  customerId: number | null;
  verificationStatus: "unverified" | "pending" | "verified" | "conflict";
  createdAt: string;
  updatedAt: string;
};

export type CustomerIdentityOnboardingSnapshot = {
  conversationCaseId: string | number | null;
  identityResolutionStatus: CustomerIdentityResolutionStatus;
  contactIdentity: ContactIdentity | null;
  customer: CustomerRecord | null;
  customerCreationConsent: CustomerCreationConsent | null;
  warnings: string[];
  platformOrigin: PlatformOrigin;
};

export type CustomerIdentityMutationResult =
  | {
      status: "matched" | "created";
      customer: CustomerRecord;
      customers: [CustomerRecord];
      contactIdentity: ContactIdentity | null;
      identityResolutionStatus: CustomerIdentityResolutionStatus;
      warnings: string[];
    }
  | {
      status: "conflict";
      customer: null;
      customers: CustomerRecord[];
      contactIdentity: ContactIdentity | null;
      identityResolutionStatus: CustomerIdentityResolutionStatus;
      warnings: string[];
    }
  | {
      status: "error";
      customer: null;
      customers: [];
      contactIdentity: ContactIdentity | null;
      identityResolutionStatus: CustomerIdentityResolutionStatus;
      warnings: string[];
    };
