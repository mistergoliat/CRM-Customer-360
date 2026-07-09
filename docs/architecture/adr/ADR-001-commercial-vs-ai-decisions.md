---
title: ADR-001 - Commercial Decisions vs AI Decisions
doc_id: adr-001-commercial-vs-ai-decisions
status: approved
version: "1.0.0"
owner: architecture
last_reviewed: 2026-07-08
source_of_truth_for:
  - commercial decision boundary
  - AI decision boundary
  - accepted decision semantics
depends_on:
  - product/autonomous-commerce-prd
supersedes: []
tags:
  - adr
---
# ADR-001: Commercial Decisions vs AI Decisions

## Relaciones

- Gobernado por: [Autonomous Commerce PRD](../../product/autonomous-commerce-prd.md)
- Depende de: [ACTIVE_RELEASE](../../ACTIVE_RELEASE.md)
- Implementa: separacion entre propuesta de IA y decision comercial aceptada
- Evidencia: [CAPABILITY_MATRIX](../../CAPABILITY_MATRIX.md)
- Context pack: [ACS-R1-01.1](../../context-packs/ACS-R1-01.1.md)
- Reemplaza: none

## Estado

Accepted

## Contexto

El Autonomous Commerce System distingue entre propuestas de IA, validaciÃ³n del Brain, decisiones comerciales aceptadas, acciones durables, ejecuciones tÃ©cnicas y resultados observados.

La IA debe tener libertad para interpretar, contrastar alternativas, definir estrategia y proponer acciones. El backend no decide cÃ³mo vender mediante un Ã¡rbol rÃ­gido: valida si la propuesta puede ejecutarse con las capacidades, datos, polÃ­ticas y condiciones disponibles.

## Problema

Si propuesta y decisiÃ³n aceptada comparten semÃ¡ntica:

- una propuesta rechazada puede aparecer como decisiÃ³n efectiva;
- un fallo del modelo puede contaminar el estado comercial;
- una capability inexistente puede bloquear el ciclo;
- se pierde trazabilidad entre propuesta, rechazo, replanteamiento y acciÃ³n final;
- una propuesta no validada puede producir efectos.

## Alternativas evaluadas

1. `ai_agent_decision` como verdad comercial.
2. Doble verdad entre `crm_agent_decisions` y `ai_agent_decision`.
3. `crm_agent_decisions` como verdad comercial aceptada y `ai_agent_decision` como evidencia tÃ©cnica.
4. Backend determinÃ­stico que decide la estrategia y usa IA solo para redactar.

## DecisiÃ³n

Se adopta la alternativa 3 y el patrÃ³n:

```text
planificador abierto
â†’ ejecutor cerrado
```

### `ai_agent_decision`

Registra evidencia tÃ©cnica de la deliberaciÃ³n:

- interpretaciÃ³n;
- estrategia propuesta;
- acciÃ³n propuesta;
- capabilities solicitadas;
- rechazos;
- replanteamientos;
- modelo, versiÃ³n, latencia, tokens, validaciÃ³n y errores.

### `crm_agent_decisions`

Registra la decisiÃ³n comercial finalmente aceptada despuÃ©s de validar:

- datos;
- capabilities;
- polÃ­ticas;
- autorizaciÃ³n;
- precondiciones;
- argumentos.

Puede originarse desde IA, regla, humano o workflow. No toda propuesta genera una decisiÃ³n comercial.

## Flujo canÃ³nico

```text
AIPlan
â†’ AIProposal #1
â†’ CapabilityEvaluation

si es ejecutable:
  â†’ AcceptedCommercialDecision

si no es ejecutable:
  â†’ AIProposal #2
  â†’ CapabilityEvaluation

si vuelve a fallar:
  â†’ AIProposal #3
  â†’ CapabilityEvaluation

si no puede avanzar:
  â†’ salida segura o escalamiento
```

MÃ¡ximo tres iteraciones. La cuarta instancia finaliza el ciclo de forma segura o deriva.

## RelaciÃ³n

```text
CommercialDecision 1
â† 0..N AI proposals / AI executions
```

Una propuesta rechazada:

- queda auditada en `ai_*`;
- no crea `crm_agent_decisions`;
- no crea `crm_agent_actions`;
- no crea outbox;
- no produce efectos.

## Invariantes de implementaciÃ³n

1. `crm_agent_decisions` es append-only.
2. Un cambio de estrategia crea una nueva decisiÃ³n.
3. Puede usarse `supersedes_decision_id`.
4. Toda decisiÃ³n incluye `commercial_cycle_id`, `correlation_id`, `causation_event_id`, `source_type` y `schema_version`.
5. Una decisiÃ³n puede existir sin IA.
6. Un fallo tÃ©cnico no invalida una decisiÃ³n ya aceptada.
7. Una capability no disponible provoca replanteamiento, no fallo fatal.
8. Una acciÃ³n denegada no se persiste como acciÃ³n aceptada.
9. La UI comercial lee `crm_agent_decisions`.
10. La UI tÃ©cnica puede leer `ai_*`.

## Fallos del modelo

Un fallo afecta solo al ciclo actual:

```text
retry limitado
â†’ modelo/proveedor alternativo, si existe
â†’ salida segura
â†’ escalamiento
```

El sistema conserva inbound y oportunidad, registra la falla, la hace visible, no bloquea otras conversaciones y no deja al cliente sin continuidad.

## Consecuencias

### Positivas

- libertad estratÃ©gica de IA;
- gobernanza de efectos;
- propuestas rechazadas auditables;
- replanteamiento ante restricciones;
- fallos aislados.

### Negativas

- correlaciÃ³n entre varias propuestas y una decisiÃ³n aceptada;
- mayor volumen de trazas;
- necesidad de polÃ­tica explÃ­cita de replanteamiento.

## Estrategia de migraciÃ³n

1. Mantener semÃ¡ntica actual.
2. AÃ±adir correlaciÃ³n explÃ­cita despuÃ©s.
3. Persistir propuestas rechazadas solo en runtime tÃ©cnico.
4. Persistir en CRM Ãºnicamente decisiones aceptadas.
5. Retirar dependencias comerciales sobre `ai_agent_decision`.

## Criterio de validaciÃ³n

- propuesta rechazada sin efectos;
- decisiÃ³n comercial sin IA posible;
- tres intentos fallidos terminan en salida segura o escalamiento;
- falla de proveedor no bloquea el sistema;
- UI comercial sin `ai_*`.
