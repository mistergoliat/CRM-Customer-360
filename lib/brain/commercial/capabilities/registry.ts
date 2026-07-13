import { hasTable, safeQueryRows } from "@/lib/db";
import { createPrestashopProductRepository } from "../sales-consultative/catalogRepository";
import type { SalesConsultativeProduct, SalesNeedProfile } from "../sales-consultative/types";
import { getCustomerAddress, listCustomerAddresses } from "@/lib/domains/customer-addresses";
import { findMasterCustomerByEmail, getIdentityStatus } from "@/lib/domains/customer-identity-onboarding";
import type { CapabilityDefinition, CapabilityExecutionResult } from "./types";

function succeeded(capability: string, data: Record<string, unknown>, warning: string | null = null): CapabilityExecutionResult {
  return { capability, status: "succeeded", data, warning };
}

function unavailable(capability: string, warning: string): CapabilityExecutionResult {
  return { capability, status: "unavailable", data: null, warning };
}

function invalidInput(capability: string, warning: string): CapabilityExecutionResult {
  return { capability, status: "invalid_input", data: null, warning };
}

function asInputText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asInputNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Trimmed projection so tool outputs stay minimal (no raw rows into prompts). */
function toProductSummary(product: SalesConsultativeProduct) {
  return {
    id: product.id,
    reference: product.reference,
    name: product.name,
    category: product.category,
    price: product.price,
    currency: product.currency,
    stockQuantity: product.stockQuantity,
    dimensions: product.dimensions,
    features: product.features.slice(0, 8),
    manufacturer: product.manufacturer
  };
}

const catalog = createPrestashopProductRepository();

// The repository contract demands a need profile; a capability search has no
// consultative profile yet, so it passes an explicitly empty one (the
// Prestashop implementation only uses query/limit).
const EMPTY_NEED_PROFILE: SalesNeedProfile = {
  useCase: null,
  customerType: null,
  goals: [],
  requiredFeatures: [],
  preferredFeatures: [],
  budgetMin: null,
  budgetMax: null,
  availableSpace: null,
  location: null,
  deliveryDeadline: null,
  experienceLevel: null,
  purchaseUrgency: null,
  decisionReadiness: null,
  missingInformation: [],
  lastUpdatedAt: new Date(0).toISOString()
};

async function catalogAvailable(): Promise<boolean> {
  return hasTable("ps_product");
}

async function ordersAvailable(): Promise<boolean> {
  return hasTable("ps_orders");
}

type OrderRow = {
  id_order?: number | string;
  reference?: string;
  current_state?: number | string;
  total_paid?: number | string;
  date_add?: Date | string;
  state_name?: string;
};

async function findOrderRow(identifier: string): Promise<OrderRow | null> {
  const stateJoin = (await hasTable("ps_order_state_lang"))
    ? "LEFT JOIN ps_order_state_lang osl ON osl.id_order_state = o.current_state AND osl.id_lang = (SELECT MIN(id_lang) FROM ps_order_state_lang)"
    : "";
  const stateField = stateJoin ? ", osl.name AS state_name" : "";
  const result = await safeQueryRows<OrderRow>(
    `SELECT o.id_order, o.reference, o.current_state, o.total_paid, o.date_add${stateField}
       FROM ps_orders o ${stateJoin}
      WHERE o.reference = ? OR o.id_order = ?
      ORDER BY o.id_order DESC
      LIMIT 1`,
    [identifier, identifier]
  );
  if (!result.ok || !result.rows[0]) return null;
  return result.rows[0];
}

function toOrderSummary(row: OrderRow) {
  return {
    orderId: asInputText(row.id_order),
    reference: asInputText(row.reference),
    currentStateId: asInputNumber(row.current_state),
    stateName: asInputText(row.state_name),
    totalPaid: asInputNumber(row.total_paid),
    createdAt: row.date_add instanceof Date ? row.date_add.toISOString() : asInputText(row.date_add)
  };
}

/**
 * Read capabilities for the multi-request runtime. Real sources only:
 * Prestashop catalog/orders when their tables exist (explicitly `unavailable`
 * when they do not), customer addresses from migration 018. Capabilities
 * without a source of truth are declared implemented: false and always return
 * `unavailable` - never fake data.
 */
export const READ_CAPABILITY_REGISTRY: readonly CapabilityDefinition[] = [
  {
    capability: "search_products",
    description: "Search the product catalog by free text.",
    riskLevel: "read",
    implemented: true,
    async execute(input) {
      const query = asInputText(input.query);
      if (!query) return invalidInput("search_products", "query_required");
      if (!(await catalogAvailable())) return unavailable("search_products", "catalog_source_unavailable");
      const limit = asInputNumber(input.limit) ?? 8;
      const products = await catalog.searchProducts({ query, limit, profile: EMPTY_NEED_PROFILE });
      return succeeded("search_products", { products: products.map(toProductSummary) }, products.length === 0 ? "no_products_found" : null);
    }
  },
  {
    capability: "get_product_information",
    description: "Read verified details for one product.",
    riskLevel: "read",
    implemented: true,
    async execute(input) {
      const productId = asInputText(input.productId);
      if (!productId) return invalidInput("get_product_information", "productId_required");
      if (!(await catalogAvailable())) return unavailable("get_product_information", "catalog_source_unavailable");
      const product = await catalog.getProductDetails(productId);
      return succeeded("get_product_information", { product: product ? toProductSummary(product) : null }, product ? null : "product_not_found");
    }
  },
  {
    capability: "get_product_price",
    description: "Read the current verified price for one product.",
    riskLevel: "read",
    implemented: true,
    async execute(input) {
      const productId = asInputText(input.productId);
      if (!productId) return invalidInput("get_product_price", "productId_required");
      if (!(await catalogAvailable())) return unavailable("get_product_price", "catalog_source_unavailable");
      const price = await catalog.getProductPrice(productId);
      // price unknown stays unknown - it is never presented as zero or invented.
      return succeeded("get_product_price", { productId, price, currency: price === null ? null : "CLP" }, price === null ? "price_unknown" : null);
    }
  },
  {
    capability: "find_order",
    description: "Find an order by reference or id.",
    riskLevel: "read",
    implemented: true,
    async execute(input) {
      const identifier = asInputText(input.orderIdentifier ?? input.reference ?? input.orderId);
      if (!identifier) return invalidInput("find_order", "orderIdentifier_required");
      if (!(await ordersAvailable())) return unavailable("find_order", "orders_source_unavailable");
      const row = await findOrderRow(identifier);
      return succeeded("find_order", { order: row ? toOrderSummary(row) : null }, row ? null : "order_not_found");
    }
  },
  {
    capability: "get_order_status",
    description: "Read the current status of an order.",
    riskLevel: "read",
    implemented: true,
    async execute(input) {
      const identifier = asInputText(input.orderIdentifier ?? input.reference ?? input.orderId);
      if (!identifier) return invalidInput("get_order_status", "orderIdentifier_required");
      if (!(await ordersAvailable())) return unavailable("get_order_status", "orders_source_unavailable");
      const row = await findOrderRow(identifier);
      if (!row) return succeeded("get_order_status", { order: null }, "order_not_found");
      return succeeded("get_order_status", { order: toOrderSummary(row) });
    }
  },
  {
    capability: "identify_equipment",
    description: "Identify a serviceable equipment model. No service catalog exists yet.",
    riskLevel: "read",
    implemented: false,
    async execute() {
      return unavailable("identify_equipment", "service_catalog_not_available");
    }
  },
  {
    capability: "get_service_price",
    description: "Read maintenance/service pricing. No service catalog exists yet.",
    riskLevel: "read",
    implemented: false,
    async execute() {
      return unavailable("get_service_price", "service_catalog_not_available");
    }
  },
  {
    capability: "list_customer_addresses",
    description: "List the active addresses of a customer.",
    riskLevel: "read",
    implemented: true,
    async execute(input) {
      const customerId = asInputNumber(input.customerId);
      if (customerId === null) return invalidInput("list_customer_addresses", "customerId_required");
      const addresses = await listCustomerAddresses(customerId);
      return succeeded("list_customer_addresses", { addresses }, addresses.length === 0 ? "no_addresses_registered" : null);
    }
  },
  {
    capability: "get_customer_address",
    description: "Read one address, validating customer ownership.",
    riskLevel: "read",
    implemented: true,
    async execute(input) {
      const addressId = asInputText(input.addressId);
      if (!addressId) return invalidInput("get_customer_address", "addressId_required");
      const address = await getCustomerAddress(addressId);
      if (!address) return succeeded("get_customer_address", { address: null }, "address_not_found");
      const customerId = asInputNumber(input.customerId);
      if (customerId !== null && address.customerId !== customerId) {
        return invalidInput("get_customer_address", "address_not_owned_by_customer");
      }
      return succeeded("get_customer_address", { address });
    }
  },
  {
    capability: "find_customer_by_email",
    description: "Read the exact customer match result for one email.",
    riskLevel: "read",
    implemented: true,
    async execute(input) {
      const email = asInputText(input.email ?? input.query);
      if (!email) return invalidInput("find_customer_by_email", "email_required");
      const result = await findMasterCustomerByEmail(email);
      if (result.status === "error") return unavailable("find_customer_by_email", "customer_lookup_failed");
      return succeeded("find_customer_by_email", { match: result }, result.status === "not_found" ? "customer_not_found" : null);
    }
  },
  {
    capability: "get_identity_status",
    description: "Read the durable identity onboarding status for one conversation or case.",
    riskLevel: "read",
    implemented: true,
    async execute(input) {
      const rawConversationCaseId = input.conversationCaseId ?? input.conversationId ?? input.requestId ?? null;
      const conversationCaseId = typeof rawConversationCaseId === "string" || typeof rawConversationCaseId === "number"
        ? rawConversationCaseId
        : null;
      const status = await getIdentityStatus(conversationCaseId);
      return succeeded("get_identity_status", { status }, null);
    }
  }
];

const CAPABILITIES_BY_NAME = new Map(READ_CAPABILITY_REGISTRY.map((definition) => [definition.capability, definition]));

export function resolveReadCapability(capability: string): CapabilityDefinition | null {
  return CAPABILITIES_BY_NAME.get(capability) ?? null;
}
