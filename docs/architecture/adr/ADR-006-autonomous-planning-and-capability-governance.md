---
title: ADR-006 - Autonomous Planning and Capability Governance
doc_id: adr-006-autonomous-planning-and-capability-governance
status: approved
version: "1.0.0"
owner: architecture
last_reviewed: 2026-07-08
source_of_truth_for:
  - autonomous planning
  - capability governance
  - replanning limits
depends_on:
  - product/autonomous-commerce-prd
supersedes: []
tags:
  - adr
---
# ADR-006: Autonomous Planning and Capability Governance

## Relaciones

- Gobernado por: [Autonomous Commerce PRD](../../product/autonomous-commerce-prd.md)
- Depende de: [ACTIVE_RELEASE](../../ACTIVE_RELEASE.md)
- Implementa: gobierno de capacidades y replanning autonomo
- Evidencia: [CAPABILITY_MATRIX](../../CAPABILITY_MATRIX.md)
- Context pack: [ACS-R1-01.1](../../context-packs/ACS-R1-01.1.md)
- Reemplaza: none

## Estado

Accepted

## Contexto

El producto debe operar como vendedor 24/7 con libertad para comprender, definir objetivos, contrastar estrategias, proponer acciones, replanificar, reactivar oportunidades, negociar dentro de polÃ­ticas y escalar.

## DecisiÃ³n

Se adopta:

```text
AIPlan
â†’ AIProposal
â†’ CapabilityEvaluation
â†’ replanificar o aceptar
â†’ CommercialDecision
â†’ CommercialAction
```

## AIPlan

Incluye:

- assessment;
- objetivo;
- estrategia;
- acciÃ³n principal;
- alternativas;
- capabilities;
- outcomes esperados;
- condiciones de replanteamiento;
- stop conditions;
- escalamiento;
- reactivaciÃ³n;
- evidencia;
- idempotencia.

El plan puede ser amplio, pero solo una acciÃ³n principal se acepta por ciclo.

## Capability Gateway

El Brain informa:

- capabilities existentes;
- disponibilidad;
- argumentos;
- polÃ­ticas;
- informaciÃ³n faltante;
- restricciones;
- alternativas disponibles.

No decide la estrategia comercial.

## CapabilityEvaluation

```text
available
unavailable
denied
requires_approval
missing_information
temporarily_blocked
invalid_arguments
failed
```

## Gobernanza inversa

El sistema se define principalmente por lo que no puede hacer.

### Prohibiciones absolutas

- inventar productos, precio, disponibilidad, dimensiones, compatibilidad o fechas;
- modificar precios;
- conceder descuentos no autorizados;
- contactar tras opt-out;
- omitir handoff exclusivo;
- ejecutar SQL;
- llamar APIs no registradas;
- ejecutar capabilities inexistentes;
- autoaprobar acciones restringidas;
- afirmar efectos sin evidencia.

### Requieren aprobaciÃ³n inicial

- envÃ­o de cotizaciones;
- descuentos/promociones no automÃ¡ticas;
- excepciones comerciales;
- condiciones especiales.

### Fuera de alcance inicial

- reserva de stock;
- modificaciÃ³n de inventario;
- devoluciÃ³n de dinero;
- cancelaciÃ³n automÃ¡tica de pedidos;
- garantÃ­as autÃ³nomas.

## Replanning

MÃ¡ximo tres iteraciones. La cuarta produce salida segura o escalamiento.

Una tool denegada no se vuelve a pedir sin cambio de contexto.

## Facultades del vendedor

Puede proponer responder, preguntar, buscar, recomendar, comparar, cross-sell, upsell, preparar cotizaciÃ³n, solicitar aprobaciÃ³n, crear carrito, crear checkout, calcular despacho, informar pagos, follow-up, reactivar, escalar, llamar cuando exista capability, cerrar oportunidades y crear oportunidades relacionadas.

## ReactivaciÃ³n

Distingue retomar dormant, crear oportunidad relacionada, cross-sell, upgrade, replacement, quote recovery y no contactar.

Una oportunidad won/lost no se reabre silenciosamente.

## Idempotencia

La IA no necesita repetir exactamente el mismo plan. El sistema evita duplicados en eventos, ciclos, decisiones, acciones, cotizaciones, outbox y efectos.

## Criterio de validaciÃ³n

- capability inexistente produce replanning;
- backend deniega sin decidir estrategia alternativa;
- solo acciÃ³n aceptada produce efectos;
- tres rechazos terminan en salida segura o escalamiento;
- mismo evento no duplica efectos.
