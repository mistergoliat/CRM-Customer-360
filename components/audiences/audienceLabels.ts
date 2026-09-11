import type { AudienceScalarOperator } from "@/lib/marketing/customerIntelligenceAudience";

export const AUDIENCE_OPERATOR_LABELS: Record<AudienceScalarOperator, string> = {
  EQ: "es igual a",
  NEQ: "es distinto de",
  IN: "esta en",
  NOT_IN: "no esta en",
  GT: "es mayor que",
  GTE: "es mayor o igual que",
  LT: "es menor que",
  LTE: "es menor o igual que",
  BETWEEN: "esta entre",
  IS_NULL: "no tiene dato",
  IS_NOT_NULL: "tiene dato"
};

export const AUDIENCE_AXIS_LABELS: Record<string, string> = {
  PRODUCT_FAMILY: "Familia de producto",
  DISCIPLINE: "Disciplina",
  USE_CONTEXT: "Contexto de uso"
};
