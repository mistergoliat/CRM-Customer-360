import type { ContinuityConversationLabel, ContinuityFactKey, ContinuityPlannedTurn, ContinuityProbeMeta } from "../types";

/**
 * P7.13 stress-plan generator building blocks (task section 12: "puede
 * generarse programáticamente a partir de templates deterministas, pero el
 * plan final debe congelarse"). Every persona file in this directory calls
 * these "beats" in a fixed, hand-decided order - the beats vary their exact
 * wording deterministically (by turn index, never by RNG/Date.now) so no two
 * turns in the whole 5-conversation plan are textually identical, per the
 * task's "cada mensaje debe ser nuevo" (section 11).
 */

export const CLASSIC_NAME = "Barra Olimpica Classic 20kg";
export const PRO_NAME = "Barra Olimpica Pro 20kg";
export const COMMUNES = ["Ñuñoa", "Las Condes", "Providencia"] as const;

export type Beat = (ctx: BeatContext) => ContinuityPlannedTurn;

export type BeatContext = {
  conversation: ContinuityConversationLabel;
  localIndex: number;
  variant: number;
};

function pick<T>(options: readonly T[], variant: number): T {
  return options[variant % options.length];
}

function baseTurn(ctx: BeatContext, fields: Omit<ContinuityPlannedTurn, "conversation" | "localIndex" | "simulatedPauseMinutes" | "probe"> & { probe?: ContinuityProbeMeta | null; simulatedPauseMinutes?: number }): ContinuityPlannedTurn {
  return {
    conversation: ctx.conversation,
    localIndex: ctx.localIndex,
    probe: fields.probe ?? null,
    simulatedPauseMinutes: fields.simulatedPauseMinutes ?? 0,
    message: fields.message,
    category: fields.category,
    expectedMutation: fields.expectedMutation,
    expectedToolClass: fields.expectedToolClass,
    allowClarification: fields.allowClarification,
    factsThatMustSurvive: fields.factsThatMustSurvive
  };
}

export function greeting(ctx: BeatContext): ContinuityPlannedTurn {
  const messages = ["Hola, buenas!", "Hola, buenos días", "Hola! Necesito ayuda con una compra", "Buenas tardes, quería consultar algo"];
  return baseTurn(ctx, { message: pick(messages, ctx.variant), category: "GREETING", expectedMutation: "NONE", expectedToolClass: "NONE", allowClarification: true, factsThatMustSurvive: [] });
}

export function browse(ctx: BeatContext): ContinuityPlannedTurn {
  const messages = [
    "Estoy buscando una barra olímpica, ¿qué tienen disponible?",
    "¿Qué barras olímpicas manejan?",
    "Quiero cotizar una barra para el gimnasio de mi casa",
    "¿Me puedes mostrar las barras olímpicas que venden?"
  ];
  return baseTurn(ctx, { message: pick(messages, ctx.variant), category: "BROWSE", expectedMutation: "NONE", expectedToolClass: "READ", allowClarification: true, factsThatMustSurvive: [] });
}

export function selectProduct(ctx: BeatContext, product: "classic" | "pro", quantity: number, mustSurvive: readonly ContinuityFactKey[] = ["selection"]): ContinuityPlannedTurn {
  const name = product === "classic" ? "Classic" : "Pro";
  const messages = [
    `Quiero ${quantity} ${name === "Classic" ? "Barra Classic" : "Barra Pro"}, por favor`,
    `Me llevo ${quantity} unidad${quantity === 1 ? "" : "es"} de la ${name}`,
    `Dale, ${quantity} de la ${name} entonces`,
    `Quiero comprar ${quantity} de la ${name} 20kg`
  ];
  return baseTurn(ctx, { message: pick(messages, ctx.variant), category: "SELECT", expectedMutation: "SELECT", expectedToolClass: "COMMERCIAL_ACTION", allowClarification: false, factsThatMustSurvive: mustSurvive });
}

export function changeQuantity(ctx: BeatContext, quantity: number, mustSurvive: readonly ContinuityFactKey[] = ["selection"]): ContinuityPlannedTurn {
  const messages = [`Mejor cámbiala a ${quantity}`, `Ah no, que sean ${quantity}`, `Prefiero llevar ${quantity} en vez de eso`, `Ponle ${quantity} nomás`];
  return baseTurn(ctx, { message: pick(messages, ctx.variant), category: "MODIFY_QUANTITY", expectedMutation: "MODIFY", expectedToolClass: "COMMERCIAL_ACTION", allowClarification: false, factsThatMustSurvive: mustSurvive });
}

export function replaceProduct(ctx: BeatContext, product: "classic" | "pro", quantity: number, mustSurvive: readonly ContinuityFactKey[] = ["selection"]): ContinuityPlannedTurn {
  const name = product === "classic" ? "Classic" : "Pro";
  const messages = [`En realidad mejor la ${name}, ${quantity} unidades`, `Cambié de opinión, quiero la ${name} en vez de la otra, ${quantity}`, `No, mejor llévame ${quantity} de la ${name}`];
  return baseTurn(ctx, { message: pick(messages, ctx.variant), category: "REPLACEMENT", expectedMutation: "REPLACE", expectedToolClass: "COMMERCIAL_ACTION", allowClarification: false, factsThatMustSurvive: mustSurvive });
}

export function addSecondLine(ctx: BeatContext, product: "classic" | "pro", quantity: number, mustSurvive: readonly ContinuityFactKey[] = ["selection"]): ContinuityPlannedTurn {
  const name = product === "classic" ? "Classic" : "Pro";
  const messages = [`Agrégame también ${quantity} de la ${name}`, `Súmale ${quantity} ${name} más al pedido`, `Quiero llevar además ${quantity} de la ${name}`];
  return baseTurn(ctx, { message: pick(messages, ctx.variant), category: "MULTI_PRODUCT", expectedMutation: "MODIFY", expectedToolClass: "COMMERCIAL_ACTION", allowClarification: false, factsThatMustSurvive: mustSurvive });
}

export function giveDestination(ctx: BeatContext, communeIndex: number, mustSurvive: readonly ContinuityFactKey[] = ["destination"]): ContinuityPlannedTurn {
  const commune = COMMUNES[communeIndex % COMMUNES.length];
  const messages = [`Lo necesito en ${commune}`, `Despáchalo a ${commune} por favor`, `Vivo en ${commune}`, `La dirección es en ${commune}`];
  return baseTurn(ctx, { message: pick(messages, ctx.variant), category: "DESTINATION", expectedMutation: "MODIFY", expectedToolClass: "COMMERCIAL_ACTION", allowClarification: false, factsThatMustSurvive: mustSurvive });
}

export function askShipping(ctx: BeatContext, mustSurvive: readonly ContinuityFactKey[] = ["destination", "selection"]): ContinuityPlannedTurn {
  const messages = ["¿Cuánto sale el envío?", "¿Cuánto cuesta el despacho?", "¿Cuál es el costo de envío a mi dirección?"];
  return baseTurn(ctx, { message: pick(messages, ctx.variant), category: "SHIPPING", expectedMutation: "NONE", expectedToolClass: "COMMERCIAL_ACTION", allowClarification: false, factsThatMustSurvive: mustSurvive });
}

export function requestQuote(ctx: BeatContext, mustSurvive: readonly ContinuityFactKey[] = ["selection", "destination"]): ContinuityPlannedTurn {
  const messages = ["Ya, cotízamelo entonces", "Hazme la cotización completa", "¿Me puedes dar la cotización final?", "Prepárame la cotización"];
  return baseTurn(ctx, { message: pick(messages, ctx.variant), category: "QUOTE", expectedMutation: "NONE", expectedToolClass: "COMMERCIAL_ACTION", allowClarification: false, factsThatMustSurvive: mustSurvive });
}

export function casual(ctx: BeatContext): ContinuityPlannedTurn {
  const messages = [
    "Oye, ¿la barra viene con garantía?",
    "¿Hacen despacho los fines de semana?",
    "¿Qué material es el acero de la barra?",
    "Buena onda la atención, gracias",
    "¿Tienen alguna promoción este mes?",
    "¿Cuánto pesa exactamente la barra?",
    "¿Puedo pagar con transferencia?"
  ];
  return baseTurn(ctx, { message: pick(messages, ctx.variant), category: "CASUAL", expectedMutation: "NONE", expectedToolClass: "NONE", allowClarification: true, factsThatMustSurvive: [] });
}

export function farewellPartial(ctx: BeatContext): ContinuityPlannedTurn {
  const messages = ["Ya, muchas gracias, cualquier cosa te escribo", "Perfecto, gracias! Lo voy a pensar", "Dale, gracias, nos vemos"];
  return baseTurn(ctx, { message: pick(messages, ctx.variant), category: "FAREWELL_PARTIAL", expectedMutation: "NONE", expectedToolClass: "NONE", allowClarification: true, factsThatMustSurvive: [] });
}

export function returnGreeting(ctx: BeatContext, pauseMinutes: number): ContinuityPlannedTurn {
  const messages = ["Hola de nuevo", "Hola, volví", "Hola! Aquí estoy otra vez"];
  return baseTurn(ctx, {
    message: pick(messages, ctx.variant),
    category: "RETURN_GREETING",
    expectedMutation: "NONE",
    expectedToolClass: "NONE",
    allowClarification: true,
    factsThatMustSurvive: [],
    simulatedPauseMinutes: pauseMinutes,
    probe: { probeType: "PAUSE_RESUME", pauseMinutes, note: `resumed after ${pauseMinutes}min pause` }
  });
}

export function memoryProbe(ctx: BeatContext, factKey: ContinuityFactKey, originTurn: number, depth: number): ContinuityPlannedTurn {
  const messages: Record<ContinuityFactKey, string> = {
    selection: "Recuérdame, ¿qué producto había elegido yo?",
    destination: "¿A qué comuna era el envío que te di?",
    shipping: "¿Cuánto me habías dicho que salía el envío?",
    quote: "¿Cuál era el total de la cotización que me diste?",
    objective: "¿En qué habíamos quedado?"
  };
  return baseTurn(ctx, {
    message: messages[factKey],
    category: "MEMORY_SURVIVAL_PROBE",
    expectedMutation: "NONE",
    expectedToolClass: "NONE",
    allowClarification: true,
    factsThatMustSurvive: [factKey],
    probe: { probeType: "MEMORY_SURVIVAL", targetFactKey: factKey, originTurn, depth }
  });
}

export function reQuestionProbe(ctx: BeatContext, factKey: ContinuityFactKey): ContinuityPlannedTurn {
  const messages = ["Ya, cotízamelo entonces", "Dale, procede no más", "Confírmame el pedido tal como quedó"];
  return baseTurn(ctx, {
    message: pick(messages, ctx.variant),
    category: "RE_QUESTION_PROBE",
    expectedMutation: "NONE",
    expectedToolClass: "COMMERCIAL_ACTION",
    allowClarification: false,
    factsThatMustSurvive: [factKey],
    probe: { probeType: "RE_QUESTION", targetFactKey: factKey }
  });
}

export function oldStateResurrectionProbe(ctx: BeatContext, factKey: ContinuityFactKey, expectedValue: unknown): ContinuityPlannedTurn {
  const messages = ["Agrégame una más de lo mismo", "Súmame otra unidad igual", "Ponme una adicional"];
  return baseTurn(ctx, {
    message: pick(messages, ctx.variant),
    category: "OLD_STATE_RESURRECTION_PROBE",
    expectedMutation: "MODIFY",
    expectedToolClass: "COMMERCIAL_ACTION",
    allowClarification: false,
    factsThatMustSurvive: [factKey],
    probe: { probeType: "OLD_STATE_RESURRECTION", targetFactKey: factKey, expectedValue }
  });
}

export function toolPolicyProbe(ctx: BeatContext, quantity: number): ContinuityPlannedTurn {
  const messages = [`Quiero llevar ${quantity} de la Classic, confírmamelo`, `Cámbiame la cantidad a ${quantity} de una vez`, `Dale, ${quantity} unidades y quedamos`];
  return baseTurn(ctx, {
    message: pick(messages, ctx.variant),
    category: "TOOL_POLICY_PROBE",
    expectedMutation: "MODIFY",
    expectedToolClass: "COMMERCIAL_ACTION",
    allowClarification: false,
    factsThatMustSurvive: ["selection"],
    probe: { probeType: "TOOL_POLICY" }
  });
}

export function stateConflictProbe(ctx: BeatContext): ContinuityPlannedTurn {
  const messages = ["¿Qué llevo finalmente?", "Recapitulemos, ¿qué quedó en el pedido?", "¿Qué es lo que voy a comprar al final?"];
  return baseTurn(ctx, {
    message: pick(messages, ctx.variant),
    category: "STATE_CONFLICT_PROBE",
    expectedMutation: "NONE",
    expectedToolClass: "NONE",
    allowClarification: true,
    factsThatMustSurvive: ["selection"],
    probe: { probeType: "STATE_CONFLICT" }
  });
}

export function ambiguousReference(ctx: BeatContext): ContinuityPlannedTurn {
  const messages = ["Dale, esa mejor", "Ya, la otra entonces", "Prefiero esa, la más barata"];
  return baseTurn(ctx, { message: pick(messages, ctx.variant), category: "AMBIGUOUS_REFERENCE", expectedMutation: "NONE", expectedToolClass: "NONE", allowClarification: true, factsThatMustSurvive: [] });
}

export function objectiveDetour(ctx: BeatContext): ContinuityPlannedTurn {
  const messages = ["Oye, ¿y si me arrepiento puedo devolverla?", "¿Cómo es el tema de la garantía exactamente?", "Cuéntame del despacho a regiones"];
  return baseTurn(ctx, { message: pick(messages, ctx.variant), category: "OBJECTIVE_DETOUR", expectedMutation: "NONE", expectedToolClass: "NONE", allowClarification: true, factsThatMustSurvive: [] });
}

export function objectiveResumeProbe(ctx: BeatContext): ContinuityPlannedTurn {
  const messages = ["Bueno, sigamos con mi compra entonces", "Volvamos a lo mío, ¿cómo quedó el pedido?", "Ya, continuemos con la compra"];
  return baseTurn(ctx, {
    message: pick(messages, ctx.variant),
    category: "OBJECTIVE_RESUME_PROBE",
    expectedMutation: "NONE",
    expectedToolClass: "NONE",
    allowClarification: true,
    factsThatMustSurvive: ["selection"],
    probe: { probeType: "OBJECTIVE_SURVIVAL" }
  });
}
