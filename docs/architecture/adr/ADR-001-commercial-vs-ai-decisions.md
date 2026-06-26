# ADR-001: Commercial Decisions vs AI Decisions

## Estado

Accepted

## Contexto

El Autonomous Commerce System distingue entre propuestas de IA, validación del Brain, decisiones comerciales aceptadas, acciones durables, ejecuciones técnicas y resultados observados.

La IA debe tener libertad para interpretar, contrastar alternativas, definir estrategia y proponer acciones. El backend no decide cómo vender mediante un árbol rígido: valida si la propuesta puede ejecutarse con las capacidades, datos, políticas y condiciones disponibles.

## Problema

Si propuesta y decisión aceptada comparten semántica:

- una propuesta rechazada puede aparecer como decisión efectiva;
- un fallo del modelo puede contaminar el estado comercial;
- una capability inexistente puede bloquear el ciclo;
- se pierde trazabilidad entre propuesta, rechazo, replanteamiento y acción final;
- una propuesta no validada puede producir efectos.

## Alternativas evaluadas

1. `ai_agent_decision` como verdad comercial.
2. Doble verdad entre `crm_agent_decisions` y `ai_agent_decision`.
3. `crm_agent_decisions` como verdad comercial aceptada y `ai_agent_decision` como evidencia técnica.
4. Backend determinístico que decide la estrategia y usa IA solo para redactar.

## Decisión

Se adopta la alternativa 3 y el patrón:

```text
planificador abierto
→ ejecutor cerrado
```

### `ai_agent_decision`

Registra evidencia técnica de la deliberación:

- interpretación;
- estrategia propuesta;
- acción propuesta;
- capabilities solicitadas;
- rechazos;
- replanteamientos;
- modelo, versión, latencia, tokens, validación y errores.

### `crm_agent_decisions`

Registra la decisión comercial finalmente aceptada después de validar:

- datos;
- capabilities;
- políticas;
- autorización;
- precondiciones;
- argumentos.

Puede originarse desde IA, regla, humano o workflow. No toda propuesta genera una decisión comercial.

## Flujo canónico

```text
AIPlan
→ AIProposal #1
→ CapabilityEvaluation

si es ejecutable:
  → AcceptedCommercialDecision

si no es ejecutable:
  → AIProposal #2
  → CapabilityEvaluation

si vuelve a fallar:
  → AIProposal #3
  → CapabilityEvaluation

si no puede avanzar:
  → salida segura o escalamiento
```

Máximo tres iteraciones. La cuarta instancia finaliza el ciclo de forma segura o deriva.

## Relación

```text
CommercialDecision 1
← 0..N AI proposals / AI executions
```

Una propuesta rechazada:

- queda auditada en `ai_*`;
- no crea `crm_agent_decisions`;
- no crea `crm_agent_actions`;
- no crea outbox;
- no produce efectos.

## Invariantes de implementación

1. `crm_agent_decisions` es append-only.
2. Un cambio de estrategia crea una nueva decisión.
3. Puede usarse `supersedes_decision_id`.
4. Toda decisión incluye `commercial_cycle_id`, `correlation_id`, `causation_event_id`, `source_type` y `schema_version`.
5. Una decisión puede existir sin IA.
6. Un fallo técnico no invalida una decisión ya aceptada.
7. Una capability no disponible provoca replanteamiento, no fallo fatal.
8. Una acción denegada no se persiste como acción aceptada.
9. La UI comercial lee `crm_agent_decisions`.
10. La UI técnica puede leer `ai_*`.

## Fallos del modelo

Un fallo afecta solo al ciclo actual:

```text
retry limitado
→ modelo/proveedor alternativo, si existe
→ salida segura
→ escalamiento
```

El sistema conserva inbound y oportunidad, registra la falla, la hace visible, no bloquea otras conversaciones y no deja al cliente sin continuidad.

## Consecuencias

### Positivas

- libertad estratégica de IA;
- gobernanza de efectos;
- propuestas rechazadas auditables;
- replanteamiento ante restricciones;
- fallos aislados.

### Negativas

- correlación entre varias propuestas y una decisión aceptada;
- mayor volumen de trazas;
- necesidad de política explícita de replanteamiento.

## Estrategia de migración

1. Mantener semántica actual.
2. Añadir correlación explícita después.
3. Persistir propuestas rechazadas solo en runtime técnico.
4. Persistir en CRM únicamente decisiones aceptadas.
5. Retirar dependencias comerciales sobre `ai_agent_decision`.

## Criterio de validación

- propuesta rechazada sin efectos;
- decisión comercial sin IA posible;
- tres intentos fallidos terminan en salida segura o escalamiento;
- falla de proveedor no bloquea el sistema;
- UI comercial sin `ai_*`.
