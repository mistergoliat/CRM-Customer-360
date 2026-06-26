# Autonomous Commerce Tool Catalog

This catalog separates capability classes from implementation status.

## Implemented tools

| Tool | Work | Input | Output | Source of truth | Preconditions | Validation | Side effects | Idempotency | Retry | Errors | Audit | Approval | Current implementation | Related files | Missing data |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `get_customer_context` | context recovery | customer/conversation refs | customer summary | `master_customer`, conversation read model | customer id or external id | conversation/customer existence | none | yes | yes | not found | audit logs | backend | `lib/domains/conversations/repository.ts` | canonical customer master relationships |
| `get_recent_conversation` | context recovery | conversation id | recent messages | `conversation_message` | conversation exists | pagination and message shape | none | yes | yes | not found | audit logs | backend | `lib/brain/native-whatsapp/service.ts`, conversations repo | none |
| `get_active_opportunity` | context recovery | conversation id | active opportunity | `crm_opportunities` | conversation linked | active row check | none | yes | yes | not found | audit logs | backend | consultative repo/service | final stage policy |
| `get_sales_need_profile` | context recovery | conversation/opportunity refs | need profile | `crm_sales_need_profiles` | active opportunity or thread | profile shape | none | yes | yes | not found | audit logs | backend | consultative repo/service | canonical profile completeness rules |
| `search_products` | catalog | need profile/query | candidate list | `CatalogService` boundary, Prestashop adapter today | catalog available | filters, stock, compatibility | read only | yes | yes | empty set | audit logs | backend | consultative product repository / catalog service | canonical catalog service boundary |
| `get_product_details` | catalog | product id | details | `CatalogService` boundary | product exists | id valid | read only | yes | yes | not found | audit logs | backend | product repository / catalog service | product master normalization |
| `get_product_price` | catalog | product id | price | `CatalogService` boundary | product exists | currency and price valid | read only | yes | yes | not found | audit logs | backend | product repository / catalog service | exact commercial pricing source |
| `get_product_stock` | catalog | product id | stock | `CatalogService` boundary | product exists | stock non-negative | read only | yes | yes | not found | audit logs | backend | product repository / catalog service | live stock source |
| `get_product_dimensions` | catalog | product id | dimensions | `CatalogService` boundary | product exists | dimensions numeric | read only | yes | yes | not found | audit logs | backend | product repository / catalog service | canonical size source |
| `get_product_compatibility` | catalog | product id | compatibility list | `CatalogService` boundary | product exists | compatibility rules | read only | yes | yes | not found | audit logs | backend | product repository / catalog service | compatibility model |
| `get_related_products` | catalog | product id | related products | `CatalogService` boundary | product exists | relation valid | read only | yes | yes | empty set | audit logs | backend | product repository / catalog service | related product graph |
| `create_opportunity` | CRM | customer/context | opportunity row | `crm_opportunities` | valid customer/conversation | stage/status rules | writes CRM | yes by key | yes | validation error | audit logs | backend | consultative repo/service | final opportunity ownership policy |
| `update_opportunity` | CRM | opportunity patch | updated opportunity | `crm_opportunities` | existing opportunity | state transition rules | writes CRM | yes by key | yes | invalid transition | audit logs | backend | consultative repo/service | terminal state policy |
| `save_sales_need_profile` | CRM | profile | profile row | `crm_sales_need_profiles` | active conversation/opportunity | profile shape | writes CRM | yes by key | yes | validation error | audit logs | backend | consultative repo/service | canonical missing-info taxonomy |
| `record_product_interest` | CRM | product + reason | interest row/event | CRM tables | opportunity exists | entity refs valid | writes CRM | should be yes | yes | validation error | audit logs | backend | consultative repo/service | interest schema normalization |
| `record_objection` | CRM | objection type/text | objection row/event | CRM tables | objection detected | objection enum | writes CRM | should be yes | yes | validation error | audit logs | backend | consultative repo/service | objection taxonomy completeness |
| `create_follow_up_action` | CRM | due date, reason, message | action row | `crm_agent_actions` | opportunity not terminal | policy and timing checks | writes CRM | yes by idempotency key | yes | blocked/validation | audit logs | backend | consultative repo/service | final scheduling policy |
| `cancel_follow_up_action` | CRM | action ref, reason | canceled action | `crm_agent_actions` | existing action | state transition rules | writes CRM | yes | yes | not found | audit logs | backend | consultative repo/service | cancellation policy |
| `request_human_handoff` | CRM | reason | handoff state change | `conversation`, `crm_opportunities` | live conversation/opportunity | handoff policy | writes CRM | yes | yes | blocked | audit logs | backend | consultative repo/service | specialized alias for `create_escalation` |
| `queue_customer_message` | communication | message text, wa id | outbox row | `brain_message_outbox` | eligible send | policy and dedupe | writes outbox | yes by dedupe key | yes | blocked | audit logs | backend | consultative repo/service (`queueCustomerMessageRecord`) | canonical message command contract |
| `calculate_shipping` | operations | products, destination | shipping estimate | external ops service | address/product known | business rules | none yet | yes | yes | unavailable | audit logs | backend | planned only | integration source |
| `get_delivery_estimate` | operations | product/address | delivery estimate | operations service | route known | policy | none yet | yes | yes | unavailable | audit logs | backend | planned only | delivery oracle |
| `get_payment_options` | operations | customer/order | payment options | checkout/payment service | checkout context | policy and availability | none yet | yes | yes | unavailable | audit logs | backend | planned only | payment source |
| `get_business_policy` | operations | policy request | policy text | policy store | configured policy | policy version | none | yes | yes | unavailable | audit logs | backend | planned only | policy store |
## Capability classification

| Tool | Classification | Note |
| --- | --- | --- |
| `get_customer_context` | implemented_as_internal_function | read-only context recovery |
| `get_recent_conversation` | implemented_as_internal_function | read-only context recovery |
| `get_active_opportunity` | implemented_as_internal_function | read-only context recovery |
| `get_sales_need_profile` | implemented_as_internal_function | read-only context recovery |
| `search_products` | implemented_as_internal_function | catalog lookup behind `CatalogService` |
| `get_product_details` | implemented_as_internal_function | catalog lookup behind `CatalogService` |
| `get_product_price` | implemented_as_internal_function | catalog lookup behind `CatalogService` |
| `get_product_stock` | implemented_as_internal_function | catalog lookup behind `CatalogService` |
| `get_product_dimensions` | implemented_as_internal_function | catalog lookup behind `CatalogService` |
| `get_product_compatibility` | implemented_as_internal_function | catalog lookup behind `CatalogService` |
| `get_related_products` | implemented_as_internal_function | catalog lookup behind `CatalogService` |
| `create_opportunity` | implemented_as_internal_function | CRM write path |
| `update_opportunity` | implemented_as_internal_function | CRM write path |
| `save_sales_need_profile` | implemented_as_internal_function | CRM write path |
| `record_product_interest` | implemented_as_internal_function | CRM write path |
| `record_objection` | implemented_as_internal_function | CRM write path |
| `create_follow_up_action` | implemented_as_internal_function | CRM write path |
| `cancel_follow_up_action` | implemented_as_internal_function | CRM write path |
| `request_human_handoff` | implemented_as_internal_function | specialized alias for `create_escalation` |
| `queue_customer_message` | implemented_as_internal_function | outbox command, not direct Meta send |
| `compare_products` | available_as_domain_data | derived from catalog data, not a dedicated capability |
| `get_active_promotions` | planned | no verified source wired yet |
| `calculate_shipping` | planned | operations integration not yet productized |
| `get_delivery_estimate` | planned | operations integration not yet productized |
| `get_payment_options` | planned | checkout/payment integration not yet productized |
| `get_business_policy` | available_as_domain_data | policy text is domain data when wired |
| `create_escalation` | planned | canonical escalation capability; `request_human_handoff` is the current alias |
| `send_whatsapp` | prohibited | product must use queue + worker + Meta adapter |
| `queue_email` | planned | email outbound not yet productized |
| `place_sales_call` | planned | voice/calls remain future scope |
| `create_checkout_link` | planned | native checkout capability not yet productized |
| `mark_won` | planned | requires explicit policy and terminal validation |
| `mark_lost` | planned | requires explicit policy and terminal validation |
| `pause_opportunity` | planned | state-machine finalization still pending |
| `reactivate_opportunity` | planned | terminal-state reactivation rules still pending |

## Not implemented as product tools yet

| Tool | Reason not available |
| --- | --- |
| `send_whatsapp` | Product must use queue + worker + Meta adapter, not direct send. |
| `queue_email` | Email outbound is not yet productized in the native autonomous flow. |
| `place_sales_call` | Voice/calls remain future scope. |
| `create_checkout_link` | Not yet a native product capability in the autonomous core. |
| `mark_won` | Needs explicit commercial policy and terminal-state validation. |
| `mark_lost` | Needs explicit commercial policy and terminal-state validation. |
| `pause_opportunity` | Needs policy and state machine finalization. |
| `reactivate_opportunity` | Needs terminal-state and reactivation rules. |
| `compare_products` | Can be derived from catalog data, but no dedicated implemented capability boundary exists yet. |
| `get_active_promotions` | No verified product source is wired into the current slice. |

## Notes

- A tool is only considered product available if there is a real implementation path in the repo.
- Documentation alone does not make a tool available.
- `implemented_as_capability` means the capability is registered and reachable through the Capability Gateway.
- `implemented_as_internal_function` means the code path exists but is not yet exposed as a product capability.
- `available_as_domain_data` means the product can read the data, but it is not a callable capability boundary.
- `planned` means documented but not yet product available.
- `prohibited` means the product must not expose it as a capability.
- `processInbound`, `processNativeWhatsAppInbound`, and the consultative engine can orchestrate tools, but they do not make missing integrations real.
- The canonical catalog boundary is `CatalogService`; the current Prestashop repository is one concrete adapter behind that boundary.
- Domain code must not reach into Prestashop SQL directly; only the adapter layer may do that.
- `AIPlan` and `CapabilityEvaluation` are domain contracts, not tools.
- `unknown` values must be preserved and not coerced into false or zero.
