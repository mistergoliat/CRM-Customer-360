export type CustomerIdentityMutationApprovalRequirement = "none" | "operator_review" | "explicit_operator_approval" | "blocked";

export type CustomerIdentityMutationContract = {
  mutation: string;
  riskLevel: "low" | "medium" | "high";
  approvalRequirement: CustomerIdentityMutationApprovalRequirement;
  idempotencyKey: string;
  requestId: string | null;
  conversationId: string | number | null;
  sourceMessageId: string | null;
  correlationId: string | null;
};

export const CUSTOMER_IDENTITY_MUTATION_CONTRACTS: readonly CustomerIdentityMutationContract[] = [
  {
    mutation: "record_customer_creation_consent",
    riskLevel: "medium",
    approvalRequirement: "operator_review",
    idempotencyKey: "conversationCaseId:sourceMessageId:consent",
    requestId: null,
    conversationId: null,
    sourceMessageId: null,
    correlationId: null
  },
  {
    mutation: "create_customer_with_consent",
    riskLevel: "high",
    approvalRequirement: "explicit_operator_approval",
    idempotencyKey: "conversationCaseId:email:create",
    requestId: null,
    conversationId: null,
    sourceMessageId: null,
    correlationId: null
  },
  {
    mutation: "link_external_identity",
    riskLevel: "medium",
    approvalRequirement: "operator_review",
    idempotencyKey: "provider:externalId:identity-link",
    requestId: null,
    conversationId: null,
    sourceMessageId: null,
    correlationId: null
  },
  {
    mutation: "create_customer_address",
    riskLevel: "medium",
    approvalRequirement: "operator_review",
    idempotencyKey: "conversationCaseId:address:create",
    requestId: null,
    conversationId: null,
    sourceMessageId: null,
    correlationId: null
  },
  {
    mutation: "select_delivery_address",
    riskLevel: "low",
    approvalRequirement: "none",
    idempotencyKey: "requestId:address:select",
    requestId: null,
    conversationId: null,
    sourceMessageId: null,
    correlationId: null
  },
  {
    mutation: "confirm_delivery_address",
    riskLevel: "low",
    approvalRequirement: "none",
    idempotencyKey: "requestId:address:confirm",
    requestId: null,
    conversationId: null,
    sourceMessageId: null,
    correlationId: null
  }
] as const;
