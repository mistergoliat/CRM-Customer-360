# ADR-006: Autonomous Planning and Capability Governance

## Estado

Accepted

## Contexto

El producto debe operar como vendedor 24/7 con libertad para comprender, definir objetivos, contrastar estrategias, proponer acciones, replanificar, reactivar oportunidades, negociar dentro de políticas y escalar.

## Decisión

Se adopta:

```text
AIPlan
→ AIProposal
→ CapabilityEvaluation
→ replanificar o aceptar
→ CommercialDecision
→ CommercialAction
```

## AIPlan

Incluye:

- assessment;
- objetivo;
- estrategia;
- acción principal;
- alternativas;
- capabilities;
- outcomes esperados;
- condiciones de replanteamiento;
- stop conditions;
- escalamiento;
- reactivación;
- evidencia;
- idempotencia.

El plan puede ser amplio, pero solo una acción principal se acepta por ciclo.

## Capability Gateway

El Brain informa:

- capabilities existentes;
- disponibilidad;
- argumentos;
- políticas;
- información faltante;
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

### Requieren aprobación inicial

- envío de cotizaciones;
- descuentos/promociones no automáticas;
- excepciones comerciales;
- condiciones especiales.

### Fuera de alcance inicial

- reserva de stock;
- modificación de inventario;
- devolución de dinero;
- cancelación automática de pedidos;
- garantías autónomas.

## Replanning

Máximo tres iteraciones. La cuarta produce salida segura o escalamiento.

Una tool denegada no se vuelve a pedir sin cambio de contexto.

## Facultades del vendedor

Puede proponer responder, preguntar, buscar, recomendar, comparar, cross-sell, upsell, preparar cotización, solicitar aprobación, crear carrito, crear checkout, calcular despacho, informar pagos, follow-up, reactivar, escalar, llamar cuando exista capability, cerrar oportunidades y crear oportunidades relacionadas.

## Reactivación

Distingue retomar dormant, crear oportunidad relacionada, cross-sell, upgrade, replacement, quote recovery y no contactar.

Una oportunidad won/lost no se reabre silenciosamente.

## Idempotencia

La IA no necesita repetir exactamente el mismo plan. El sistema evita duplicados en eventos, ciclos, decisiones, acciones, cotizaciones, outbox y efectos.

## Criterio de validación

- capability inexistente produce replanning;
- backend deniega sin decidir estrategia alternativa;
- solo acción aceptada produce efectos;
- tres rechazos terminan en salida segura o escalamiento;
- mismo evento no duplica efectos.
