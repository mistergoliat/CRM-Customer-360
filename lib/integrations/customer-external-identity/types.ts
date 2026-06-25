export type CustomerExternalIdentityRow = {
  id: number;
  customer_id: number;
  provider: string;
  identity_type: string;
  external_id: string;
  normalized_value: string;
  is_verified: number | string;
  created_at: string;
  updated_at: string;
};

export type CustomerExternalIdentityInput = {
  customerId: number;
  provider: string;
  identityType: string;
  externalId: string;
  normalizedValue: string;
  isVerified?: boolean;
};
