# P7.10 - Resumen de resultados (Mutation Semantics & Confirmation Boundary)

Resumen ejecutivo. El detalle completo (preregistro, metricas por brazo, sensibilidad, inspeccion de failures, limitaciones y validacion) esta en `docs/audits/r3-p7-10-mutation-semantics-confirmation-boundary.md` (secciones 16-28). El estado de fase esta en `docs/R3_COMMERCIAL_AGENT_HANDOFF.md` (23.11).

## Veredicto

**P7.10 CLOSED - `CONSEQUENCE_STATEMENT_SUFFICIENT`** (senal preregistrada), con `reversibleSemanticsSupported = false`.

Batch `p7-10-2026-09-21T22-24-07-790Z-live`: 414 corridas planificadas, 414 ejecutadas, 0 fallos de harness. Freeze verificado por el script antes de correr (no se regenero). `NODE_ENV=test`, base `crm_test` local. Los artifacts estan en `benchmark-results/` (ignorado por git).

## Que se probo

Tres superficies model-facing de `select_products`, sobre el mismo harness autonomo de P7.8-R/P7.9 (DeepSeek `deepseek-v4-flash`, temperature 0):

- **S0** contrato actual ("confirmed ... durable, authoritative").
- **S1** primera oracion reemplazada por una declaracion de consecuencia: la seleccion es estado de trabajo provisional y reversible (no crea orden, pago, checkout ni reserva) y no requiere confirmacion adicional solo para guardarla.
- **S2** S1 mas `useWhen`/`doNotUseWhen` sin framing de compra/compromiso.

Corpus de 46 escenarios (D declarativo, I imperativo, Q quote, N informativo, F follow-up, R reemplazo) x 3 corridas x 3 brazos.

## Resultados clave (S0 / S1 / S2)

| Metrica | S0 | S1 | S2 |
|---|---|---|---|
| Declarativo, seleccion (n=36) | 19.4% | 66.7% | 58.3% |
| Declarativo, confirmacion innecesaria | 69.4% | 19.4% | 22.2% |
| Imperativo, seleccion (n=24) | 66.7% | 95.8% | 79.2% |
| Quote, seleccion (n=24) | 58.3% | 87.5% | 87.5% |
| Informativo, sobre-mutacion (n=24) | 0/24 | 0/24 | 0/24 |
| Follow-up (n=15, F01 excluido) | 80.0% | 80.0% | 80.0% |
| Reemplazo correcto (n=12) | 75.0% | 83.3% | 91.7% |
| wrongQuantity / wrongProduct / corrupcion | 0 | 0 | 0 |
| Gateway rejection (por llamada) | 4.9% | 6.1% | 10.1% |

Efecto por paso en declarativos (seleccion / confirmacion): S0->S1 +47.2 pp / -50.0 pp (seguro); S1->S2 -8.3 pp / +2.8 pp (sin mejora); S0->S2 +38.9 pp / -47.2 pp (no cumple la regla de seguridad de Gateway: +5.2 pp).

Latencia por llamada sin cambio (p95 ~1.6 s). Tokens de entrada por turno +11% (S1) y +13% (S2), por mas rondas de tool, no por el texto.

## Interpretacion

Declarar que `select_products` es estado provisional y reversible (S1) basta, en este banco, para reducir la confirmacion redundante en enunciados declarativos sin aumentar la sobre-mutacion ni los errores de producto/cantidad. Quitar ademas el framing distribuido de `useWhen`/`doNotUseWhen` (S2) no agrega mejora.

`reversibleSemanticsSupported = false` se debe solo a que S2 supera en +5.2 pp la regla de Gateway rejection. Ese exceso viene de `create_quote` (Quote Service bloqueado localmente), `search_products_by_semantics` (`registry_mismatch`) y `explore_catalog` (`invalid_response`), no de `select_products`; no es evidencia de que S2 sea insegura respecto de la semantica de seleccion.

## Residuo (no resuelto por la semantica del contrato)

- "una/un" leido como articulo, por lo que el modelo pide cantidad (D09, IM06).
- "Pro" a secas (D03, D05).
- Pedir comuna antes de guardar la seleccion (F03).

## Limitaciones

- S1 combina "informar la consecuencia" con la instruccion explicita "no pidas confirmacion adicional"; no se pueden separar.
- Un solo modelo, harness sintetico de dos productos, 36 turnos declarativos por brazo (intervalos amplios), clasificador por reglas.
- Analisis de failures/traces posterior a la senal y exploratorio.
- No es evidencia de produccion ni un cambio de contrato de produccion.

## Siguiente fase recomendada (no iniciada)

1. Variante con la consecuencia pero sin la instruccion explicita, y replica de S0 vs S1 con otro corpus y un segundo modelo.
2. Decidir con negocio si "una/un" cuenta como cantidad 1 y el orden comuna vs guardar seleccion.
3. Solo despues, evaluar el cambio de contrato real en una release explicita.

No P8, no MCP, sin tocar `quantity`.

## Validacion

Tests P7.10 69/69, P7.9 29/29, P7.8-R 37/37; `npm run typecheck` y `npm run build` OK; eslint focalizado y `git diff --check` limpios. Los tests de Gateway y `selectProductsCapability` fallan tal cual en el entorno local (47/61 y 6/10) porque fijan `DB_NAME=main_management`, que no esta migrada; contra `crm_test` (copias temporales) pasan 71/71.
