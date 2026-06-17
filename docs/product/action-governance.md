# Action Governance

Este documento describe la capa deterministica de Commercial Policy que opera sobre una salida del Sales Agent ya validada.

## Boundary

La secuencia contractual es:

```text
buildCommercialContext
  -> runSalesAgentDryRun
    -> provider
    -> rawOutput (unknown)
    -> validateSalesAgentOutput
  -> evaluateCommercialPolicy
```

La policy nunca ejecuta herramientas, nunca escribe DB, nunca envía outbound y nunca reemplaza al validator.

## Responsabilidad

Commercial Policy responde una sola pregunta:

`¿Esta propuesta comercial está permitida bajo las reglas del producto?`

No responde si el output está bien formado. Eso corresponde a `validateSalesAgentOutput()`.

## Resultados

La salida de policy conserva o bloquea:

- claims
- proposed actions
- tool requests
- entity proposals

El resultado puede quedar en:

- `allowed`
- `allowed_with_restrictions`
- `requires_review`
- `blocked`
- `failed_safe`

## Estado del roadmap

- `P1K-007A` DONE
- `P1K-007B` DONE
- `P1K-007C` DONE
- `P1K-007D` ACTIVE
- `P1K-007E` NEXT
- `P1K-007F` PENDING
