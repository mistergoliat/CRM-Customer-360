import type {
  SalesConsultativeActionType,
  SalesConsultativeCandidate,
  SalesConsultativeCustomerContext,
  SalesConsultativeInput,
  SalesConsultativeInteraction,
  SalesConsultativeNextAction,
  SalesConsultativeObjection,
  SalesConsultativeObjectionType,
  SalesConsultativeOpportunity,
  SalesConsultativeProduct,
  SalesConsultativeRecommendation,
  SalesConsultativeResult,
  SalesConsultativeStage,
  SalesNeedProfile
} from "./types";

type ParsedNeedSignals = {
  useCase: string | null;
  customerType: string | null;
  goals: string[];
  requiredFeatures: string[];
  preferredFeatures: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  availableSpace: SalesNeedProfile["availableSpace"];
  location: SalesNeedProfile["location"];
  deliveryDeadline: string | null;
  experienceLevel: string | null;
  purchaseUrgency: string | null;
  decisionReadiness: string | null;
};

type SalesConsultativeSignalFlags = {
  discovery: boolean;
  qualification: boolean;
  recommendation: boolean;
  objectionHandling: boolean;
  purchaseIntent: boolean;
  checkoutSupport: boolean;
  followUp: boolean;
  won: boolean;
  lost: boolean;
  handoff: boolean;
  recoveryIntent: boolean;
};

function toIsoString(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

function asIdentifier(value: unknown): string | number | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return null;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return uniqueStrings(
    normalizeText(value)
      .split(/[^a-z0-9]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length > 1 && !["de", "la", "el", "y", "a", "o", "para", "con", "sin", "por", "del", "las", "los"].includes(token))
  );
}

function getInteractionText(interaction: SalesConsultativeInteraction) {
  return interaction.text ? normalizeText(interaction.text) : "";
}

function hasAny(text: string, phrases: string[]) {
  return phrases.some((phrase) => text.includes(phrase));
}

function parseMoneyExpression(text: string): number | null {
  const normalized = normalizeText(text);
  const hasMoneyCue = hasAny(normalized, ["presupuesto", "precio", "valor", "costo", "coste", "plata", "dinero", "clp", "usd", "eur", "$", "pesos", "lucas"]);
  if (!hasMoneyCue && !/(?:\b\d+(?:[.,]\d+)?\s*(?:k|mil|mm|millones)\b|\$|clp|usd|eur)/.test(normalized)) {
    return null;
  }
  const match = normalized.match(/(?:clp|\$|usd|eur)?\s*(\d+(?:[.,]\d+)?)\s*(k|mil|millones|m|mm)?/);
  if (!match) return null;
  const raw = Number(match[1].replace(",", "."));
  if (!Number.isFinite(raw)) return null;
  const suffix = match[2] ?? "";
  if (suffix === "k" || suffix === "mil") return Math.round(raw * 1000);
  if (suffix === "m" || suffix === "mm" || suffix === "millones") return Math.round(raw * 1000000);
  return Math.round(raw);
}

function parseSpace(text: string): SalesNeedProfile["availableSpace"] {
  const normalized = normalizeText(text);
  const match = normalized.match(/(?:espacio|medida|dimensiones?|ancho|alto|largo).{0,20}?(\d+(?:[.,]\d+)?)\s*(m|cm)?(?:\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(m|cm)?)?(?:\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(m|cm)?)?/);
  if (!match) return null;

  const first = Number(match[1].replace(",", "."));
  const second = match[3] ? Number(match[3].replace(",", ".")) : null;
  const third = match[5] ? Number(match[5].replace(",", ".")) : null;
  const unit = (match[2] ?? match[4] ?? match[6] ?? null) as string | null;

  return {
    width: Number.isFinite(first) ? first : null,
    height: Number.isFinite(second ?? NaN) ? second : null,
    length: Number.isFinite(third ?? NaN) ? third : null,
    unit
  };
}

function parseLocation(text: string): SalesNeedProfile["location"] {
  const normalized = normalizeText(text);
  const cityMatch = normalized.match(/(?:en|para|envio a|despacho a)\s+([a-z0-9\s]+)$/);
  if (!cityMatch) return null;
  return {
    country: null,
    region: null,
    city: cityMatch[1].trim(),
    address: null
  };
}

function mergeList(existing: string[], additions: string[]) {
  return uniqueStrings([...existing, ...additions]);
}

function buildProfile(existingProfile: SalesNeedProfile | null, messageText: string, customerContext: SalesConsultativeCustomerContext, opportunity: SalesConsultativeOpportunity | null): ParsedNeedSignals {
  const normalized = normalizeText(messageText);
  const goals = existingProfile?.goals ?? [];
  const requiredFeatures = existingProfile?.requiredFeatures ?? [];
  const preferredFeatures = existingProfile?.preferredFeatures ?? [];
  const useCase = existingProfile?.useCase ?? null;
  const customerType = existingProfile?.customerType ?? null;
  const budgetMin = existingProfile?.budgetMin ?? null;
  const budgetMax = existingProfile?.budgetMax ?? null;
  const availableSpace = existingProfile?.availableSpace ?? null;
  const location = existingProfile?.location ?? null;
  const deliveryDeadline = existingProfile?.deliveryDeadline ?? null;
  const experienceLevel = existingProfile?.experienceLevel ?? null;
  const purchaseUrgency = existingProfile?.purchaseUrgency ?? null;
  const decisionReadiness = existingProfile?.decisionReadiness ?? null;

  const inferredUseCase =
    useCase ??
    (hasAny(normalized, ["gimnasio", "gym", "entrenar", "casa", "hogar", "empresa", "local", "box", "bodega", "tienda"])
      ? normalized.includes("gimnasio")
        ? "gimnasio"
        : normalized.includes("casa") || normalized.includes("hogar")
          ? "hogar"
          : normalized.includes("empresa") || normalized.includes("local")
            ? "empresa"
            : normalized.includes("box")
              ? "box"
              : "uso comercial"
      : null);

  const inferredCustomerType =
    customerType ??
    (hasAny(normalized, ["empresa", "negocio", "local", "tienda", "mayorista"]) ? "empresa" : hasAny(normalized, ["casa", "hogar", "personal"]) ? "particular" : null);

  const inferredGoals = mergeList(
    goals,
    uniqueStrings([
      hasAny(normalized, ["bajar peso", "adelgazar", "cardio"]) ? "mejorar condición física" : null,
      hasAny(normalized, ["fuerza", "peso libre", "musculacion"]) ? "entrenamiento de fuerza" : null,
      hasAny(normalized, ["espacio", "compacto"]) ? "optimizar espacio" : null,
      hasAny(normalized, ["precio", "barato", "economico"]) ? "controlar presupuesto" : null
    ])
  );

  const inferredRequiredFeatures = mergeList(
    requiredFeatures,
    uniqueStrings([
      hasAny(normalized, ["compacto", "plegable"]) ? "compacto" : null,
      hasAny(normalized, ["silencioso"]) ? "silencioso" : null,
      hasAny(normalized, ["resistente", "profesional"]) ? "alta resistencia" : null,
      hasAny(normalized, ["compatib", "compatible"]) ? "compatibilidad" : null
    ])
  );

  const inferredPreferredFeatures = mergeList(
    preferredFeatures,
    uniqueStrings([
      hasAny(normalized, ["wifi"]) ? "conectividad wifi" : null,
      hasAny(normalized, ["app"]) ? "app" : null,
      hasAny(normalized, ["garantia"]) ? "garantía" : null
    ])
  );

  const inferredBudget = parseMoneyExpression(messageText);
  const inferredSpace = availableSpace ?? parseSpace(messageText);
  const inferredLocation = location ?? parseLocation(messageText);
  const urgency = purchaseUrgency ?? (hasAny(normalized, ["hoy", "urgente", "pronto", "esta semana"]) ? "alta" : hasAny(normalized, ["despues", "mas adelante", "mas tarde"]) ? "baja" : null);

  return {
    useCase: inferredUseCase,
    customerType: inferredCustomerType,
    goals: inferredGoals,
    requiredFeatures: inferredRequiredFeatures,
    preferredFeatures: inferredPreferredFeatures,
    budgetMin: existingProfile?.budgetMin ?? (inferredBudget ? Math.max(0, Math.round(inferredBudget * 0.8)) : null),
    budgetMax: existingProfile?.budgetMax ?? inferredBudget,
    availableSpace: inferredSpace,
    location: inferredLocation,
    deliveryDeadline,
    experienceLevel,
    purchaseUrgency: urgency,
    decisionReadiness: decisionReadiness ?? (hasAny(normalized, ["listo", "ahora", "ya"]) ? "alta" : hasAny(normalized, ["ver opciones", "comparar", "evaluar"]) ? "media" : null)
  };
}

function mergeProfile(existingProfile: SalesNeedProfile | null, extracted: ParsedNeedSignals, currentTime: string): SalesNeedProfile {
  const existing = existingProfile ?? {
    useCase: null,
    customerType: null,
    goals: [],
    requiredFeatures: [],
    preferredFeatures: [],
    budgetMin: null,
    budgetMax: null,
    availableSpace: null,
    location: null,
    deliveryDeadline: null,
    experienceLevel: null,
    purchaseUrgency: null,
    decisionReadiness: null,
    missingInformation: [],
    lastUpdatedAt: currentTime
  };

  const profile: SalesNeedProfile = {
    useCase: extracted.useCase ?? existing.useCase,
    customerType: extracted.customerType ?? existing.customerType,
    goals: mergeList(existing.goals, extracted.goals),
    requiredFeatures: mergeList(existing.requiredFeatures, extracted.requiredFeatures),
    preferredFeatures: mergeList(existing.preferredFeatures, extracted.preferredFeatures),
    budgetMin: extracted.budgetMin ?? existing.budgetMin,
    budgetMax: extracted.budgetMax ?? existing.budgetMax,
    availableSpace: extracted.availableSpace ?? existing.availableSpace,
    location: extracted.location ?? existing.location,
    deliveryDeadline: extracted.deliveryDeadline ?? existing.deliveryDeadline,
    experienceLevel: extracted.experienceLevel ?? existing.experienceLevel,
    purchaseUrgency: extracted.purchaseUrgency ?? existing.purchaseUrgency,
    decisionReadiness: extracted.decisionReadiness ?? existing.decisionReadiness,
    missingInformation: [...existing.missingInformation],
    lastUpdatedAt: currentTime
  };

  profile.missingInformation = deriveMissingInformation(profile);
  return profile;
}

function deriveMissingInformation(profile: SalesNeedProfile) {
  const missing: string[] = [];
  if (!profile.useCase) missing.push("useCase");
  if (!profile.customerType) missing.push("customerType");
  if (profile.goals.length === 0) missing.push("goals");
  if (profile.requiredFeatures.length === 0) missing.push("requiredFeatures");
  if (profile.budgetMin === null && profile.budgetMax === null) missing.push("budget");
  if (!profile.availableSpace) missing.push("availableSpace");
  if (!profile.location) missing.push("location");
  if (!profile.deliveryDeadline) missing.push("deliveryDeadline");
  if (!profile.experienceLevel) missing.push("experienceLevel");
  if (!profile.purchaseUrgency) missing.push("purchaseUrgency");
  if (!profile.decisionReadiness) missing.push("decisionReadiness");
  return missing;
}

function detectSignals(messageText: string, opportunity: SalesConsultativeOpportunity | null, existingProfile: SalesNeedProfile | null): SalesConsultativeSignalFlags {
  const normalized = normalizeText(messageText);
  const recoveryIntent = hasAny(normalized, ["retomo", "sigo interesado", "volver", "de nuevo", "nuevamente", "aun me interesa"]);
  const handoff = hasAny(normalized, ["humano", "asesor", "ejecutivo", "persona", "agente"]);
  const lost = hasAny(normalized, ["no gracias", "ya no", "descarto", "cancelar", "no me interesa", "me quedo con"]) || hasAny(normalized, ["competidor"]);
  const won = hasAny(normalized, ["ya compre", "ya lo compre", "pagado", "confirmado", "hecho el pedido", "realice el pedido"]);
  const followUp = hasAny(normalized, ["despues", "mas adelante", "luego", "otro dia", "llamame", "retomar", "seguimiento", "proxima semana", "próxima semana", "semana que viene", "otra semana"]);
  const purchaseIntent = hasAny(normalized, ["comprar", "quiero comprar", "lo llevo", "cotizar", "cotizacion", "precio", "valor", "pedido", "checkout", "link de pago", "pagar"]);
  const checkoutSupport = hasAny(normalized, ["checkout", "link de pago", "pago", "pagar", "tarjeta", "transferencia", "webpay", "mercado pago", "boleta", "factura"]);
  const objectionHandling = hasAny(normalized, ["caro", "precio", "costo de envio", "envio", "sin espacio", "no cabe", "sin stock", "agotado", "tarda", "lento", "comparado", "competidor", "garantia", "confianza", "dudar"]);
  const recommendation = !purchaseIntent && !followUp && !lost && !won && !handoff && (hasAny(normalized, ["recomiendas", "recomend", "sugiere", "opcion", "alternativa", "catalogo", "producto"]) || Boolean(existingProfile?.useCase));
  const qualification = !recommendation && !purchaseIntent && !followUp && !lost && !won && !handoff;
  const discovery = qualification && (existingProfile?.missingInformation.length ?? 0) > 0;

  return {
    discovery,
    qualification,
    recommendation,
    objectionHandling,
    purchaseIntent,
    checkoutSupport,
    followUp,
    won,
    lost,
    handoff,
    recoveryIntent
  };
}

function detectObjectionType(messageText: string, signals: SalesConsultativeSignalFlags): SalesConsultativeObjectionType | null {
  const normalized = normalizeText(messageText);
  if (hasAny(normalized, ["precio", "caro", "costoso", "mas barato", "barato"])) return "price";
  if (hasAny(normalized, ["envio", "despacho", "flete", "shipping", "costo de envio"])) return "shipping_cost";
  if (hasAny(normalized, ["espacio", "no cabe", "sin espacio", "muy grande", "compacto"])) return "lack_of_space";
  if (hasAny(normalized, ["agotado", "sin stock", "no hay stock", "disponibilidad"])) return "out_of_stock";
  if (hasAny(normalized, ["entrega", "llega", "plazo", "demora", "tarda", "fecha"])) return "delivery_time";
  if (hasAny(normalized, ["calidad", "garantia", "garantía", "resistencia", "durabilidad"])) return "product_quality";
  if (hasAny(normalized, ["competidor", "competencia", "vs ", "comparado", "comparar"])) return "comparison_with_competitor";
  if (hasAny(normalized, ["autorizacion", "aprobacion", "aprobación", "jefe", "socio", "esposo", "esposa"])) return "needs_approval";
  if (hasAny(normalized, ["no estoy listo", "no listo", "mas adelante", "despues", "otro dia"])) return "not_ready";
  if (hasAny(normalized, ["confianza", "confiar", "seguro", "legitimo", "legitimo", "real"])) return "trust";
  if (signals.objectionHandling) return "unknown";
  return null;
}

function buildCandidateProfileTokens(profile: SalesNeedProfile, messageText: string) {
  return tokenize(
    [
      profile.useCase ?? "",
      profile.customerType ?? "",
      ...profile.goals,
      ...profile.requiredFeatures,
      ...profile.preferredFeatures,
      messageText
    ].join(" ")
  );
}

function buildProductTokens(product: SalesConsultativeProduct) {
  return tokenize(
    [
      product.name,
      product.reference ?? "",
      product.category ?? "",
      product.description ?? "",
      product.manufacturer ?? "",
      ...product.features,
      ...product.compatibility
    ].join(" ")
  );
}

function fitDimensions(
  candidate: SalesConsultativeProduct["dimensions"],
  need: SalesNeedProfile["availableSpace"]
): { score: number; valid: boolean; reason: string | null; tradeOff: string | null } {
  if (!need || !candidate) {
    return { score: 8, valid: true, reason: null, tradeOff: null };
  }

  const candidateDims = [candidate.width, candidate.height, candidate.length].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const needDims = [need.width, need.height, need.length].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (candidateDims.length === 0 || needDims.length === 0) {
    return { score: 6, valid: true, reason: null, tradeOff: null };
  }

  const dimensions = [
    { need: need.width, candidate: candidate.width },
    { need: need.height, candidate: candidate.height },
    { need: need.length, candidate: candidate.length }
  ].filter((dimension) => dimension.need !== null && dimension.candidate !== null);
  const oversizeRatios = dimensions.map((dimension) => (dimension.candidate as number) / (dimension.need as number));
  const maxOversizeRatio = oversizeRatios.length > 0 ? Math.max(...oversizeRatios) : 1;

  if (maxOversizeRatio > 1.25) {
    return { score: 0, valid: false, reason: "No cabe en el espacio disponible.", tradeOff: "Dimensiones superiores al espacio indicado." };
  }

  if (maxOversizeRatio > 1) {
    return { score: 10, valid: true, reason: "Cabe con ajuste mínimo.", tradeOff: "Requiere verificar tolerancia de espacio." };
  }

  return { score: 15, valid: true, reason: "Cabe en el espacio disponible.", tradeOff: null };
}

function scoreBudget(product: SalesConsultativeProduct, profile: SalesNeedProfile) {
  if (product.price === null) {
    return { score: 8, valid: true, reason: null, tradeOff: "Precio no disponible." };
  }
  if (profile.budgetMax === null && profile.budgetMin === null) {
    return { score: 10, valid: true, reason: null, tradeOff: null };
  }
  const min = profile.budgetMin ?? 0;
  const max = profile.budgetMax ?? Number.POSITIVE_INFINITY;
  if (product.price >= min && product.price <= max) {
    return { score: 20, valid: true, reason: "Encaja en el presupuesto.", tradeOff: null };
  }
  if (product.price <= max * 1.1) {
    return { score: 12, valid: true, reason: "Levemente por sobre el presupuesto ideal.", tradeOff: "Precio algo más alto que el objetivo." };
  }
  if (product.price <= max * 1.25) {
    return { score: 5, valid: true, reason: "Por sobre el presupuesto objetivo.", tradeOff: "Requiere estirar presupuesto." };
  }
  return { score: 0, valid: false, reason: "Supera el presupuesto máximo.", tradeOff: "No cabe en el rango presupuestario." };
}

function scoreNeedFit(product: SalesConsultativeProduct, profile: SalesNeedProfile, messageText: string) {
  const profileTokens = buildCandidateProfileTokens(profile, messageText);
  const productTokens = buildProductTokens(product);
  const overlap = profileTokens.filter((token) => productTokens.includes(token)).length;
  const ratio = profileTokens.length === 0 ? 0 : overlap / profileTokens.length;
  const score = clamp(Math.round(ratio * 40), 0, 40);
  const reasons = overlap > 0 ? ["Responde a parte de la necesidad declarada."] : [];
  return { score, reasons };
}

function scoreFeatures(product: SalesConsultativeProduct, profile: SalesNeedProfile) {
  const productTokens = buildProductTokens(product);
  const requiredMatches = profile.requiredFeatures.filter((feature) => productTokens.includes(normalizeText(feature))).length;
  const preferredMatches = profile.preferredFeatures.filter((feature) => productTokens.includes(normalizeText(feature))).length;
  const score = clamp(requiredMatches * 8 + preferredMatches * 4, 0, 15);
  const reasons = [
    requiredMatches > 0 ? `Cubre ${requiredMatches} requisito(s) clave.` : null,
    preferredMatches > 0 ? `Alinea ${preferredMatches} preferencia(s).` : null
  ].filter((item): item is string => Boolean(item));
  return { score, reasons };
}

function scoreStock(product: SalesConsultativeProduct) {
  if (product.stockQuantity === null) {
    return { score: 5, valid: true, reason: "Stock no confirmado.", tradeOff: "Validación de stock pendiente." };
  }
  if (product.stockQuantity <= 0) {
    return { score: 0, valid: false, reason: "Sin stock.", tradeOff: "Producto actualmente agotado." };
  }
  if (product.stockQuantity <= 3) {
    return { score: 2, valid: true, reason: "Stock limitado.", tradeOff: "Quedan pocas unidades." };
  }
  return { score: 5, valid: true, reason: "Hay stock disponible.", tradeOff: null };
}

function scoreCompatibility(product: SalesConsultativeProduct, profile: SalesNeedProfile) {
  const targetTokens = tokenize(
    [
      profile.useCase ?? "",
      ...profile.requiredFeatures,
      ...profile.preferredFeatures,
      profile.customerType ?? ""
    ].join(" ")
  );
  const compatibilityMatches = uniqueStrings([...product.compatibility, ...product.features]).filter((item) =>
    targetTokens.some((token) => normalizeText(item).includes(token) || token.includes(normalizeText(item)))
  );
  const score = clamp(compatibilityMatches.length * 3, 0, 5);
  const reason = compatibilityMatches.length > 0 ? `Compatible con ${compatibilityMatches.length} criterio(s).` : null;
  return { score, reason };
}

function scoreCandidate(product: SalesConsultativeProduct, profile: SalesNeedProfile, messageText: string): SalesConsultativeCandidate {
  const needFit = scoreNeedFit(product, profile, messageText);
  const budget = scoreBudget(product, profile);
  const space = fitDimensions(product.dimensions, profile.availableSpace);
  const features = scoreFeatures(product, profile);
  const stock = scoreStock(product);
  const compatibility = scoreCompatibility(product, profile);

  const score = needFit.score + budget.score + space.score + features.score + stock.score + compatibility.score;
  const reasons = uniqueStrings([
    ...needFit.reasons,
    budget.reason,
    space.reason,
    ...features.reasons,
    stock.reason,
    compatibility.reason
  ]);
  const tradeOffs = uniqueStrings([budget.tradeOff, space.tradeOff, stock.tradeOff]).filter(Boolean);
  const valid = budget.valid && space.valid && stock.valid && score > 0;

  return {
    product,
    score,
    scoreBreakdown: {
      needFit: needFit.score,
      budget: budget.score,
      space: space.score,
      features: features.score,
      stock: stock.score,
      compatibility: compatibility.score
    },
    reasons,
    tradeOffs,
    isValid: valid
  };
}

function chooseAlternative(candidates: SalesConsultativeCandidate[], main: SalesConsultativeCandidate | null) {
  if (!main) return null;
  return candidates.find((candidate) => candidate.product.id !== main.product.id && candidate.isValid) ?? null;
}

function chooseComplements(main: SalesConsultativeCandidate | null, related: SalesConsultativeProduct[], profile: SalesNeedProfile) {
  if (!main) return [];
  const seen = new Set<string>([main.product.id]);
  const productTokens = buildProductTokens(main.product);
  return related
    .filter((product) => !seen.has(product.id) && (product.stockQuantity ?? 1) > 0)
    .filter((product) => {
      const tokens = buildProductTokens(product);
      return productTokens.some((token) => tokens.includes(token)) || profile.requiredFeatures.some((feature) => tokens.includes(normalizeText(feature)));
    })
    .slice(0, 2);
}

function isSparseProfile(profile: SalesNeedProfile) {
  return (
    !profile.useCase &&
    !profile.customerType &&
    profile.goals.length === 0 &&
    profile.requiredFeatures.length === 0 &&
    profile.preferredFeatures.length === 0 &&
    profile.budgetMin === null &&
    profile.budgetMax === null &&
    profile.availableSpace === null
  );
}

function deriveStage(
  flags: SalesConsultativeSignalFlags,
  recommendation: SalesConsultativeRecommendation,
  objections: SalesConsultativeObjection[],
  hasMissingInformation: boolean,
  profile: SalesNeedProfile
): SalesConsultativeStage {
  const sparseProfile = isSparseProfile(profile);
  if (flags.handoff) return "handoff";
  if (flags.lost) return "lost";
  if (flags.won) return "won";
  if (flags.followUp) return "follow_up";
  if (flags.checkoutSupport) return "checkout_support";
  if (flags.purchaseIntent && recommendation.main) return "purchase_intent";
  if (objections.length > 0) return "objection_handling";
  if (recommendation.main && recommendation.alternative) return "recommendation";
  if (hasMissingInformation) return sparseProfile ? "discovery" : "qualification";
  return "discovery";
}

function deriveOpportunityStatus(stage: SalesConsultativeStage): string {
  switch (stage) {
    case "won":
      return "won";
    case "lost":
      return "lost";
    case "handoff":
      return "stalled";
    case "follow_up":
      return "followup_scheduled";
    case "checkout_support":
    case "purchase_intent":
      return "quote_sent";
    case "objection_handling":
      return "negotiation";
    case "recommendation":
      return "quote_ready_for_review";
    case "qualification":
      return "qualifying";
    case "discovery":
    default:
      return "engaged";
  }
}

function buildMissingInformationQuestion(missingInformation: string[]) {
  const labels: Record<string, string> = {
    useCase: "el uso principal",
    customerType: "si es para empresa o uso particular",
    goals: "el objetivo principal",
    requiredFeatures: "las características indispensables",
    budget: "el presupuesto",
    availableSpace: "el espacio disponible",
    location: "la comuna o ciudad de entrega",
    deliveryDeadline: "la fecha límite",
    experienceLevel: "tu nivel de experiencia",
    purchaseUrgency: "la urgencia de compra",
    decisionReadiness: "qué tan listo está para decidir"
  };
  return missingInformation.map((field) => labels[field] ?? field).filter(Boolean);
}

function buildResponseText(input: {
  stage: SalesConsultativeStage;
  profile: SalesNeedProfile;
  recommendation: SalesConsultativeRecommendation;
  objections: SalesConsultativeObjection[];
  nextBestAction: SalesConsultativeActionType;
  missingInformation: string[];
  followUpReason: string;
  recoveryIntent: boolean;
}) {
  const parts: string[] = [];

  if (input.missingInformation.length > 0 && (!input.recommendation.main || input.stage === "qualification" || input.stage === "discovery")) {
    parts.push(`Para recomendarte bien, me falta ${buildMissingInformationQuestion(input.missingInformation).slice(0, 3).join(", ")}.`);
  }

  if (input.recommendation.main) {
    const main = input.recommendation.main;
    parts.push(`Te recomiendo ${main.product.name}${main.product.price !== null ? ` por ${main.product.currency} ${main.product.price.toLocaleString("es-CL")}` : ""}.`);
    if (main.reasons.length > 0) parts.push(main.reasons.slice(0, 2).join(" "));
  }

  if (input.recommendation.alternative) {
    const alternative = input.recommendation.alternative;
    parts.push(`Alternativa: ${alternative.product.name}${alternative.product.price !== null ? ` por ${alternative.product.currency} ${alternative.product.price.toLocaleString("es-CL")}` : ""}.`);
    if (alternative.tradeOffs.length > 0) parts.push(`Trade-off: ${alternative.tradeOffs[0]}.`);
  }

  if (input.recommendation.complements.length > 0) {
    parts.push(`Complementos compatibles: ${input.recommendation.complements.map((product) => product.name).join(", ")}.`);
  }

  if (input.nextBestAction === "offer_bundle") {
    parts.push("Puedo dejarte el bundle completo para maximizar valor sin inventar descuentos.");
  }

  if (input.nextBestAction === "provide_checkout_link") {
    parts.push("Te comparto el link de pago para cerrar cuando quieras.");
  }

  if (input.objections.length > 0) {
    const objection = input.objections[0];
    parts.push(`Sobre ${objection.type === "price" ? "el precio" : objection.type === "out_of_stock" ? "el stock" : objection.type === "lack_of_space" ? "el espacio" : "tu objeción"}, te propongo validar la mejor opción sin asumir descuentos ni promesas no verificadas.`);
  }

  if (input.nextBestAction === "schedule_follow_up") {
    parts.push(`Si te parece, dejo seguimiento para ${input.followUpReason}.`);
  }

  if (input.nextBestAction === "handoff_to_human") {
    parts.push("Voy a escalarlo a un humano para continuar sin riesgo de inventar información.");
  }

  if (input.recoveryIntent) {
    parts.push("Retomo el contexto anterior y no repito preguntas ya respondidas.");
  }

  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function decideNextBestAction(input: {
  stage: SalesConsultativeStage;
  signals: SalesConsultativeSignalFlags;
  objections: SalesConsultativeObjection[];
  recommendation: SalesConsultativeRecommendation;
  missingInformation: string[];
  profile: SalesNeedProfile;
}) {
  if (input.signals.handoff) return "handoff_to_human";
  if (input.signals.lost) return "close_lost";
  if (input.signals.won) return "close_won";
  const sparseProfile = isSparseProfile(input.profile);
  if (
    sparseProfile &&
    (input.stage === "discovery" || input.stage === "qualification") &&
    input.missingInformation.length > 0 &&
    !input.signals.purchaseIntent &&
    !input.signals.checkoutSupport
  ) {
    return "ask_qualification_question";
  }
  if (input.objections.some((objection) => objection.type === "price" || objection.type === "shipping_cost" || objection.type === "delivery_time")) {
    return input.recommendation.main ? "recommend_alternative" : "check_shipping";
  }
  if (input.objections.some((objection) => objection.type === "lack_of_space" || objection.type === "out_of_stock")) {
    return "recommend_alternative";
  }
  if (input.signals.checkoutSupport) return "provide_checkout_link";
  if (input.signals.purchaseIntent && input.recommendation.main) {
    if (input.recommendation.complements.length > 0) return "offer_bundle";
    if (input.stage === "purchase_intent" && input.recommendation.main.product.price !== null) return "prepare_quote";
    return input.recommendation.main.product.price !== null ? "provide_price" : "recommend_product";
  }
  if (input.recommendation.complements.length > 0 && input.stage === "recommendation") return "offer_bundle";
  if (input.missingInformation.length > 0 && !input.recommendation.main) return "ask_qualification_question";
  if (input.signals.followUp) return "schedule_follow_up";
  if (input.recommendation.main) return "recommend_product";
  return "wait_for_customer";
}

function buildFollowUpDueAt(currentTime: string, urgency: string | null | undefined) {
  const date = new Date(currentTime);
  const days =
    urgency === "alta" ? 1 :
    urgency === "media" ? 3 :
    urgency === "baja" ? 7 :
    4;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function normalizeOpportunity(inputOpportunity: SalesConsultativeOpportunity | null, profile: SalesNeedProfile, stage: SalesConsultativeStage, status: string, currentTime: string): SalesConsultativeOpportunity {
  return {
    id: inputOpportunity?.id ?? null,
    opportunityKey: inputOpportunity?.opportunityKey ?? "",
    status,
    stage,
    primaryIntent: inputOpportunity?.primaryIntent ?? "product_recommendation",
    currentSummary: inputOpportunity?.currentSummary ?? null,
    nextActionType: inputOpportunity?.nextActionType ?? null,
    nextActionDueAt: inputOpportunity?.nextActionDueAt ?? null,
    waitingFor: inputOpportunity?.waitingFor ?? null,
    humanOwnerActive: inputOpportunity?.humanOwnerActive ?? false,
    aiBlocked: inputOpportunity?.aiBlocked ?? false,
    customerCandidateId: inputOpportunity?.customerCandidateId ?? null,
    customerMasterId: inputOpportunity?.customerMasterId ?? null,
    leadId: inputOpportunity?.leadId ?? null,
    conversationCaseId: inputOpportunity?.conversationCaseId ?? null,
    waId: inputOpportunity?.waId ?? null,
    requirements: inputOpportunity?.requirements ?? [],
    missingRequirements: inputOpportunity?.missingRequirements ?? profile.missingInformation,
    productInterests: inputOpportunity?.productInterests ?? [],
    objections: inputOpportunity?.objections ?? [],
    signals: inputOpportunity?.signals ?? [],
    version: inputOpportunity?.version ?? 0,
    lastActivityAt: inputOpportunity?.lastActivityAt ?? currentTime,
    closedAt: inputOpportunity?.closedAt ?? null
  };
}

export async function runSalesConsultativeFlow(input: SalesConsultativeInput): Promise<SalesConsultativeResult> {
  const currentTime = toIsoString(input.currentTime);
  const normalizedMessage = normalizeText(input.messageText);
  const signals = detectSignals(input.messageText, input.opportunity, input.existingProfile);
  const extracted = buildProfile(input.existingProfile, input.messageText, input.customerContext, input.opportunity);
  const mergedProfile = mergeProfile(input.existingProfile, extracted, currentTime);
  const missingInformation = mergedProfile.missingInformation;
  const objectionType = detectObjectionType(input.messageText, signals);
  const objections: SalesConsultativeObjection[] = [];
  if (objectionType) {
    objections.push({
      type: objectionType,
      description: input.messageText,
      status: "acknowledged",
      confidence: objectionType === "unknown" ? "low" : "high",
      detectedAt: currentTime,
      source: "customer_message",
      resolvedAt: null
    });
  }

  const searchQuery = uniqueStrings([
    mergedProfile.useCase,
    ...mergedProfile.goals,
    ...mergedProfile.requiredFeatures,
    ...mergedProfile.preferredFeatures,
    input.messageText
  ]).join(" ");

  let rawProducts: SalesConsultativeProduct[] = [];
  const warnings: string[] = [];
  try {
    rawProducts = await input.productRepository.searchProducts({
      query: searchQuery,
      limit: 8,
      profile: mergedProfile
    });
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "product_search_failed");
    rawProducts = [];
  }

  const candidates = rawProducts.map((product) => scoreCandidate(product, mergedProfile, input.messageText)).sort((left, right) => right.score - left.score);
  const sparseProfile = isSparseProfile(mergedProfile);
  const main = sparseProfile && missingInformation.length > 0 ? null : candidates.find((candidate) => candidate.isValid) ?? null;
  const alternative = chooseAlternative(candidates.filter((candidate) => candidate.isValid), main);
  let related: SalesConsultativeProduct[] = [];
  if (main) {
    try {
      related = await input.productRepository.getRelatedProducts(main.product.id);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "related_products_failed");
      related = [];
    }
  }
  const complements = chooseComplements(main, related, mergedProfile);
  const recommendation: SalesConsultativeRecommendation = {
    main,
    alternative,
    complements,
    candidates,
    summary: main
      ? `Principal: ${main.product.name}${alternative ? ` | Alternativa: ${alternative.product.name}` : ""}`
      : "No se encontró una recomendación válida todavía.",
    missingInformation
  };

  const stage = deriveStage(signals, recommendation, objections, missingInformation.length > 0, mergedProfile);
  const opportunityStatus = deriveOpportunityStatus(stage);
  const nextBestAction = decideNextBestAction({
    stage,
    signals,
    objections,
    recommendation,
    missingInformation,
    profile: mergedProfile
  });
  const followUpDueAt = nextBestAction === "schedule_follow_up" ? buildFollowUpDueAt(currentTime, mergedProfile.purchaseUrgency) : null;
  const pendingFollowUp = Boolean(input.opportunity?.nextActionType === "schedule_follow_up" || input.opportunity?.waitingFor === "customer_reply");
  const responseText = buildResponseText({
    stage,
    profile: mergedProfile,
    recommendation,
    objections,
    nextBestAction,
    missingInformation,
    followUpReason: mergedProfile.purchaseUrgency ?? "el seguimiento acordado",
    recoveryIntent: signals.recoveryIntent
  });
  const action: SalesConsultativeNextAction = {
    type: nextBestAction,
    channel: "whatsapp",
    reason:
      nextBestAction === "ask_qualification_question"
        ? "Faltan datos para recomendar con seguridad."
        : nextBestAction === "recommend_product"
          ? "Hay una recomendación determinística válida."
          : nextBestAction === "recommend_alternative"
            ? "La objeción o restricción requiere otra opción."
            : nextBestAction === "offer_bundle"
              ? "Existen complementos compatibles relevantes."
              : nextBestAction === "provide_price"
                ? "El cliente pidió precio y hay producto válido."
                : nextBestAction === "check_shipping"
                  ? "El cliente pidió validar despacho."
                  : nextBestAction === "provide_checkout_link"
                    ? "El cliente ya está listo para cerrar."
                    : nextBestAction === "prepare_quote"
                      ? "El cliente necesita cotización formal."
                      : nextBestAction === "schedule_follow_up"
                        ? "La compra no está lista todavía."
                        : nextBestAction === "wait_for_customer"
                          ? "Se espera respuesta del cliente."
                          : nextBestAction === "handoff_to_human"
                            ? "El caso requiere revisión humana."
                            : nextBestAction === "close_won"
                              ? "El cliente confirmó el cierre."
                              : "El caso debe cerrarse o reencuadrarse.",
    confidence: main ? "high" : missingInformation.length > 0 ? "medium" : "low",
    dueAt: followUpDueAt,
    draftMessage: responseText || null,
    blockedReasons: objections.map((objection) => objection.type),
    requiresHuman: nextBestAction === "handoff_to_human"
  };

  const existingOpportunity = input.opportunity ? normalizeOpportunity(input.opportunity, mergedProfile, stage, opportunityStatus, currentTime) : null;
  const opportunityToPersist = normalizeOpportunity(
    existingOpportunity,
    mergedProfile,
    stage,
    opportunityStatus,
    currentTime
  );

  const opportunityWrite = await input.operationsRepository.createOrUpdateOpportunity({
    opportunity: input.opportunity,
    profile: mergedProfile,
    stage,
    status: opportunityStatus,
    summary: recommendation.summary,
    nextActionType: nextBestAction,
    nextActionDueAt: followUpDueAt,
    currentTime,
    customerContext: input.customerContext,
    metadata: {
      ...input.metadata,
      allowTerminalReopen: signals.recoveryIntent
    }
  });

  opportunityToPersist.id = opportunityWrite.opportunityId ?? opportunityToPersist.id;
  opportunityToPersist.opportunityKey = opportunityWrite.opportunityKey ?? opportunityToPersist.opportunityKey;
  opportunityToPersist.conversationCaseId = asIdentifier(input.metadata?.conversationId ?? opportunityToPersist.conversationCaseId ?? null);
  opportunityToPersist.waId = input.customerContext.waId ?? opportunityToPersist.waId ?? null;
  opportunityToPersist.nextActionType = nextBestAction;
  opportunityToPersist.nextActionDueAt = followUpDueAt;
  opportunityToPersist.waitingFor = nextBestAction === "wait_for_customer" ? "customer_reply" : opportunityToPersist.waitingFor;
  opportunityToPersist.humanOwnerActive = nextBestAction === "handoff_to_human";
  opportunityToPersist.aiBlocked = nextBestAction === "handoff_to_human";
  opportunityToPersist.closedAt = stage === "won" || stage === "lost" ? currentTime : null;
  const opportunityMutationAllowed = opportunityWrite.warning !== "terminal_opportunity_not_reopened";

  const savedProfile = await input.operationsRepository.saveSalesNeedProfile({
    opportunity: opportunityToPersist,
    profile: mergedProfile,
    currentTime,
    messageText: input.messageText,
    metadata: {
      ...input.metadata,
      sourceMessageId: input.metadata?.sourceMessageId ?? null
    }
  });

  let productInterestSaved = false;
  let objectionSaved = false;
  let actionSaved = false;
  let outboundQueued = false;
  let outboxId: string | number | null = null;
  let followUpCancelled = false;
  let quotePrepared = false;
  let humanHandoffRequested = false;

  if (pendingFollowUp && opportunityMutationAllowed) {
    const cancelResult = await input.operationsRepository.cancelFollowUpAction({
      opportunity: opportunityToPersist,
      reason: "customer_replied",
      currentTime
    });
    followUpCancelled = cancelResult.ok;
  }

  if (main && opportunityMutationAllowed) {
    const interestResult = await input.operationsRepository.recordProductInterest({
      opportunity: opportunityToPersist,
      profile: mergedProfile,
      recommendation,
      currentTime
    });
    productInterestSaved = interestResult.ok;
  }

  for (const objection of objections) {
    if (!opportunityMutationAllowed) break;
    const objectionResult = await input.operationsRepository.recordObjection({
      opportunity: opportunityToPersist,
      objection,
      currentTime
    });
    objectionSaved = objectionSaved || objectionResult.ok;
  }

  if (nextBestAction === "schedule_follow_up" && opportunityMutationAllowed) {
    const actionResult = await input.operationsRepository.createFollowUpAction({
      opportunity: opportunityToPersist,
      actionType: nextBestAction,
      dueAt: followUpDueAt,
      messageText: responseText,
      currentTime,
      metadata: input.metadata
    });
    actionSaved = actionResult.ok;
  }

  if (nextBestAction === "prepare_quote" && opportunityMutationAllowed) {
    const quoteResult = await input.operationsRepository.prepareQuote({
      opportunity: opportunityToPersist,
      recommendation,
      currentTime
    });
    quotePrepared = quoteResult.ok;
  }

  if (nextBestAction === "handoff_to_human" && opportunityMutationAllowed) {
    const handoffResult = await input.operationsRepository.requestHumanHandoff({
      opportunity: opportunityToPersist,
      reason: "consultative_handoff",
      currentTime
    });
    humanHandoffRequested = handoffResult.ok;
  }

  if (responseText.length > 0 && nextBestAction !== "close_lost" && opportunityMutationAllowed) {
    const queueResult = await input.operationsRepository.queueCustomerMessage({
      opportunity: opportunityToPersist,
      messageText: responseText,
      currentTime,
      metadata: input.metadata
    });
    outboundQueued = queueResult.ok;
    outboxId = queueResult.outboxId ?? null;
  }

  await input.operationsRepository.writeAudit({
    action: "ai_sdr.decision.created",
    entityType: "crm_sales_need_profiles",
    entityId: savedProfile.profileId ?? opportunityWrite.opportunityId ?? null,
    after: {
      stage,
      nextBestAction,
      opportunityStatus,
      recommendationSummary: recommendation.summary,
      mainProductId: main?.product.id ?? null,
      alternativeProductId: alternative?.product.id ?? null,
      objections: objections.map((objection) => objection.type),
      currentTime
    }
  });

  const persistence = {
    profileSaved: savedProfile.ok,
    opportunitySaved: opportunityWrite.ok,
    productInterestSaved,
    objectionSaved,
    actionSaved,
    outboundQueued,
    outboxId,
    auditWritten: true,
    followUpCancelled,
    quotePrepared,
    humanHandoffRequested
  };

  return {
    handled: true,
    stage,
    nextBestAction,
    opportunityStatus,
    opportunityStage: stage,
    profile: mergedProfile,
    recommendation,
    objections,
    responseText,
    followUp: {
      scheduled: nextBestAction === "schedule_follow_up",
      cancelled: followUpCancelled,
      dueAt: followUpDueAt,
      reason: mergedProfile.purchaseUrgency ?? "seguimiento comercial"
    },
    persistence,
    action,
    warnings: uniqueStrings([
      savedProfile.warning,
      opportunityWrite.warning,
      recommendation.main ? null : "no_valid_recommendation",
      nextBestAction === "handoff_to_human" && !humanHandoffRequested ? "handoff_write_failed" : null,
      opportunityMutationAllowed ? null : "terminal_opportunity_not_reopened",
      ...(warnings ?? []),
      pendingFollowUp && !followUpCancelled ? "follow_up_cancel_failed" : null
    ])
  };
}
