---
title: Lead and Opportunity Model Contract
doc_id: product-lead-opportunity-contract
status: active
version: "1.1.0"
owner: product
last_reviewed: 2026-07-21
source_of_truth_for:
  - Lead/Opportunity domain contract
  - opportunity status and stage vocabulary
depends_on:
  - ../PRODUCT_NORTH_STAR.md
  - ../architecture/adr/ADR-004-next-best-action-ownership.md
supersedes: []
tags:
  - product
  - contract
---

# Lead and Opportunity Model Contract

## Purpose

Este documento define el contrato documental y TypeScript de `Lead` y `Opportunity` para el AI SDR MVP.

Es un contrato de dominio, no una representacion definitiva de tablas SQL, ni una logica de runtime.

El objetivo es permitir que Brain, Sales Agent, Follow-up Engine, Operator Copilot y HUB hablen el mismo lenguaje comercial antes de persistencia o enforcement.

## Lead

### Definition

Lead es una entidad comercial provisional que representa una persona, empresa o contacto con señales de interes, pero sin una oportunidad suficientemente calificada o sin identidad definitiva.

Lead puede existir:

- sin Customer Master,
- con `customerCandidateId`,
- con `waId`,
- con `phone`,
- con `email`,
- con nombre parcial,
- con canal de origen,
- sin compra previa.

### Relationship rules

- Lead puede existir sin Customer.
- Lead puede apuntar a `customerCandidateId` sintético.
- Customer puede tener cero o mas Leads historicos.
- Lead puede generar una o mas Opportunities.

## Opportunity

### Definition

Opportunity representa una posibilidad comercial concreta asociada a una necesidad, intencion o potencial transaccion determinada.

Una misma persona o Customer puede tener multiples Opportunities independientes.

### Relationship rules

Opportunity puede estar vinculada a:

- `customerMasterId` futuro,
- `customerCandidateId`,
- `leadId`,
- `conversationCaseId`,
- `channel/thread`,
- `quoteDraftId` futuro.

Conversation no reemplaza Opportunity. Case no reemplaza Opportunity. Opportunity no depende de un unico canal.

## Statuses

### LeadStatus

- `new`
- `contacted`
- `engaged`
- `qualifying`
- `qualified`
- `unqualified`
- `converted`
- `dormant`
- `archived`

### OpportunityStatus

- `new`
- `engaged`
- `qualifying`
- `quote_pending`
- `quote_ready_for_review`
- `quote_sent`
- `waiting_customer`
- `followup_scheduled`
- `negotiation`
- `stalled`
- `won`
- `lost`
- `cancelled`
- `archived`

### Terminal statuses

- `won`
- `lost`
- `cancelled`
- `archived`

`won` significa venta confirmada mediante evidencia autorizada. El AI SDR no puede marcar `won` solo por interpretacion conversacional.

`lost` requiere razon o evidencia.

`archived` no equivale a `lost`.

`stalled` no es terminal.

## Opportunity stage

`OpportunityStage` se conserva como dimension comercial separada porque aporta claridad operacional sin duplicar completamente el `status`.

### Stage values

- `discovery`
- `qualification`
- `solution_fit`
- `quotation`
- `negotiation`
- `closing`
- `post_sale_handoff`

### Rule

`status` representa estado operativo y control.

`stage` representa posicion comercial gruesa dentro del funnel.

Ambos no deben usarse como sinonimos. Si el estado ya expresa suficiente informacion, `stage` puede quedar derivado o nulo en implementaciones futuras.

## Operational loop contract

A durable operational loop governs `Opportunity`.

Rules:

- `Case` is not the commercial state store.
- `Conversation` is not a lead substitute.
- `crm_opportunities` holds the current durable state.
- `crm_agent_decisions` holds immutable append-only decisions.
- `opportunity_key` must be stable and idempotent.
- a message never creates a new opportunity by default.
- terminal opportunities are not reopened automatically.
- `won` still requires authorized evidence.

This loop is governed separately from Case detail and from the read-only shadow review surface.

## Lead source

- `whatsapp_inbound`
- `whatsapp_outbound`
- `ecommerce`
- `pos`
- `manual_hub`
- `referral`
- `campaign`
- `email`
- `phone_call`
- `appsheet_import`
- `legacy_import`
- `unknown`

## Commercial intent

- `product_inquiry`
- `product_recommendation`
- `price_request`
- `stock_request`
- `quote_request`
- `delivery_request`
- `discount_request`
- `bulk_purchase`
- `equipment_project`
- `maintenance_request`
- `assembly_request`
- `post_sale_request`
- `general_information`
- `unknown`

## Commercial signal

- `replied`
- `no_reply`
- `left_on_seen`
- `high_intent`
- `medium_intent`
- `low_intent`
- `asks_price`
- `asks_stock`
- `asks_delivery`
- `asks_discount`
- `asks_quote`
- `shares_requirements`
- `shares_budget`
- `shares_deadline`
- `objection_price`
- `objection_timing`
- `objection_trust`
- `objection_product_fit`
- `human_requested`
- `purchase_confirmed`
- `rejection_explicit`
- `conversation_inactive`

## Commercial temperature and priority

`CommercialTemperature` representa intensidad observable de interes:

- `cold`
- `warm`
- `hot`
- `unknown`

`CommercialPriority` representa urgencia operacional:

- `low`
- `normal`
- `high`
- `urgent`

No son lo mismo. Una oportunidad puede ser `hot` y `normal`, o `warm` y `urgent`.

## Commercial value estimate

Debe evitar falsa precision.

```json
{
  "mode": "range",
  "currency": "CLP",
  "minimum": 500000,
  "maximum": 800000
}
```

Modos:

- `exact`
- `range`
- `unknown`

No se asume que el agente puede fijar una venta exacta sin cotizacion.

## Product interest

Un Opportunity puede contener uno o mas intereses de producto.

Cada interes debe permitir:

- `productId` opcional,
- `productReference` opcional,
- `productNameSnapshot`,
- `category` opcional,
- `requestedQuantity` opcional,
- `confidence`,
- `source`,
- `notes` opcionales.

## Requirement model

`OpportunityRequirement` puede representar:

- budget,
- quantity,
- dimensions,
- location,
- deliveryDeadline,
- useCase,
- installationRequired,
- maintenanceRequired,
- preferredChannel,
- custom.

## Objection model

`OpportunityObjection` incluye:

- `type`
- `description`
- `status`
- `detectedAt`
- `source`
- `confidence`
- `resolvedAt` opcional

Tipos minimos:

- `price`
- `timing`
- `trust`
- `stock`
- `delivery`
- `product_fit`
- `approval_required`
- `competitor`
- `unknown`

## Invariants

- Opportunity siempre debe tener `primaryIntent`.
- Opportunity no necesita Customer Master definitivo.
- Opportunity debe tener al menos una referencia comercial: Lead, Customer Candidate, Customer futuro o Conversation.
- `won` exige evidencia de venta.
- `lost` debe incluir `lostReason`.
- `quote_sent` debe tener referencia a QuoteDraft/Quote futura.
- No se deben mezclar oportunidades distintas del mismo Customer.
- Una conversation puede alimentar varias opportunities.
- Una opportunity puede continuar por distintos canales.

## Conceptual transitions

### Permitted examples

- `new -> engaged`
- `engaged -> qualifying`
- `qualifying -> quote_pending`
- `quote_sent -> waiting_customer`
- `waiting_customer -> followup_scheduled`
- `followup_scheduled -> negotiation`
- `negotiation -> won`
- `stalled -> engaged`
- `stalled -> lost`

### Evidence or approval required

- cualquier estado -> `won`
- cualquier estado -> `lost`
- `quote_pending -> quote_sent`
- `waiting_customer -> cancelled`

No se impone enforcement runtime en esta etapa.

## What is out of scope

- scoring predictivo ML,
- persistencia DB,
- deduplicacion automatica,
- Customer Master,
- quote engine real,
- descuentos,
- stock confirmation,
- delivery commitment,
- campaign automation,
- call execution,
- SaaS multi-tenant.

## TypeScript contract

Los tipos y constantes de este contrato viven en `lib/brain/commercial/types.ts`, `lib/brain/commercial/constants.ts` e `lib/brain/commercial/index.ts`.

Estos contratos definen dominio, no tablas SQL definitivas.

