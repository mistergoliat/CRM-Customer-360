/**
 * ACS-R1-05.1-T02.6.2. Real stockQuantity (e.g. 47171) must never reach the
 * customer verbatim once it is large - a raw number that size reads as a
 * data leak / internal inventory figure, not a commercial statement.
 *
 * IMPORTANT (no enforcement exists): this module only generates the
 * canonical text used to instruct the model (buildAgentStepPromptPackage.ts
 * imports it to build the prompt's worked examples, so the rule text shown
 * to the model and the boundary logic tested here can never drift apart).
 * It does not intercept or rewrite the model's actual reply - the policy is
 * applied through immutable prompt instructions only. The runtime does not
 * validate or deterministically rewrite the stock quantity the LLM states.
 * This function never touches stockQuantity itself, ToolObservation,
 * response_summary_json, or crm_capability_executions - the real number
 * stays exactly as-is everywhere except in whatever sentence the model
 * composes for the customer.
 */

export function describeStockDisclosure(stockQuantity: number): string {
  if (stockQuantity <= 0) return "Sin stock disponible.";
  if (stockQuantity === 1) return "Queda 1 unidad disponible.";
  if (stockQuantity < 20) return `Quedan ${stockQuantity} unidades disponibles.`;
  if (stockQuantity <= 100) return "Hay más de 20 unidades disponibles.";
  return "Hay stock disponible.";
}
