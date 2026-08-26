import type { CustomerCommercialHistoryContext } from "../customer-profile-context";

// SALES-AGENT-R2-ID-R2-A10. The single, safe result vocabulary for
// consuming Customer Profile from R2. `AVAILABLE` here means the identity
// gate passed (LEVEL_3_PRESTASHOP_LINKED, live-confirmed by A05) AND
// Customer Profile returned data (possibly partial - see
// CustomerCommercialHistoryContext.status) - never "the HTTP call was
// attempted." `commercialHistory` reuses the already-typed, already
// prompt-safe shape the existing customer-profile-context loader produces
// (PARTE 7's own sketch is illustrative, not literal - see the release doc's
// "boundary reuse" section) rather than re-declaring profile/rfm/
// purchaseBehavior as a second, duplicate set of types.
export type CommercialCustomerContextResult =
  | {
      readonly status: "AVAILABLE";
      readonly prestashopCustomerId: string;
      readonly commercialHistory: CustomerCommercialHistoryContext;
    }
  | {
      // Identity is not (yet) LEVEL_3_PRESTASHOP_LINKED, live-confirmed -
      // Customer Profile is never called. Never degrades to
      // RuntimeIdentityContext.masterCustomerId, never re-triggers discovery.
      readonly status: "IDENTITY_INSUFFICIENT";
      readonly requiredLevel: "LEVEL_3_PRESTASHOP_LINKED";
    }
  | {
      // Identity WAS sufficient and the lookup ran - Customer Profile itself
      // reported no profile for this prestashopCustomerId (404). Never
      // conflated with IDENTITY_INSUFFICIENT and never re-opens onboarding.
      readonly status: "PROFILE_NOT_FOUND";
      readonly prestashopCustomerId: string;
    }
  | {
      // Customer Profile is down, disabled, or returned a contract we don't
      // trust. Identity is unchanged; catalog/shipping/quote are unaffected.
      readonly status: "SYSTEM_UNAVAILABLE";
      readonly retryable: boolean;
      readonly prestashopCustomerId: string | null;
    };
