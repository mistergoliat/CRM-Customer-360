export type CustomerAddress = {
  contractName: "CustomerAddress";
  schemaVersion: "1.0.0";
  addressId: string;
  customerId: number;
  createdByActionId: string | null;
  addressLabel: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  streetName: string;
  streetNumber: string;
  unit: string | null;
  commune: string;
  city: string | null;
  region: string;
  postalCode: string | null;
  deliveryNotes: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * Immutable copy embedded in quotes/orders/dispatches: editing the master
 * address afterwards never alters a document that already carried it.
 */
export type AddressSnapshot = {
  addressId: string;
  recipientName: string | null;
  recipientPhone: string | null;
  streetName: string;
  streetNumber: string;
  unit: string | null;
  commune: string;
  city: string | null;
  region: string;
  postalCode: string | null;
  deliveryNotes: string | null;
};

export type CreateCustomerAddressInput = {
  customerId: number;
  createdByActionId?: string | null;
  addressLabel?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  streetName: string;
  streetNumber: string;
  unit?: string | null;
  commune: string;
  city?: string | null;
  region: string;
  postalCode?: string | null;
  deliveryNotes?: string | null;
};

export type CreateCustomerAddressResult =
  | { ok: true; status: "created" | "duplicate"; address: CustomerAddress }
  | { ok: false; status: "error"; address: null; warning: string };

export type UpdateCustomerAddressInput = Partial<Omit<CreateCustomerAddressInput, "customerId" | "createdByActionId">>;

export type AddressMutationResult =
  | { ok: true; address: CustomerAddress }
  | { ok: false; status: "not_found" | "not_owner" | "inactive" | "error"; address: null; warning: string };

export type AddressRequestSelectionResult =
  | { ok: true; status: "selected" | "confirmed"; addressId: string }
  | { ok: false; status: "not_found" | "not_owner" | "inactive" | "no_selection" | "selection_mismatch" | "error"; warning: string };

export type AddressReadinessResult = {
  ready: boolean;
  reasons: string[];
  address: CustomerAddress | null;
};
