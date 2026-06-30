export const PLATFORM_ORIGINS = [
  "prestashop",
  "pos",
  "whatsapp",
  "instagram",
  "facebook",
  "hub",
  "import",
  "unknown",
] as const;

export type PlatformOrigin = (typeof PLATFORM_ORIGINS)[number];

export const PLATFORM_ORIGIN_LABELS: Record<PlatformOrigin, string> = {
  prestashop: "PrestaShop",
  pos: "POS",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  hub: "HUB",
  import: "Importación",
  unknown: "Desconocido",
};

export const PLATFORM_ORIGIN_OPTIONS = [
  { value: "hub", label: "HUB" },
  { value: "prestashop", label: "PrestaShop" },
  { value: "pos", label: "POS" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "import", label: "Importación" },
  { value: "unknown", label: "Desconocido" },
] as const satisfies ReadonlyArray<{ value: PlatformOrigin; label: string }>;

export function isPlatformOrigin(value: unknown): value is PlatformOrigin {
  return typeof value === "string" && PLATFORM_ORIGINS.includes(value as PlatformOrigin);
}

export function normalizePlatformOrigin(value: unknown): PlatformOrigin {
  if (isPlatformOrigin(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (isPlatformOrigin(normalized)) return normalized;
  }
  return "unknown";
}

export function parsePlatformOrigin(value: unknown): {
  platformOrigin: PlatformOrigin;
  warning: string | null;
} {
  if (value === null || value === undefined) {
    return { platformOrigin: "unknown", warning: null };
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0) {
      return { platformOrigin: "unknown", warning: null };
    }
    if (isPlatformOrigin(normalized)) {
      return { platformOrigin: normalized, warning: null };
    }
    return { platformOrigin: "unknown", warning: `invalid_platform_origin:${normalized}` };
  }

  return { platformOrigin: "unknown", warning: `invalid_platform_origin:${String(value)}` };
}

export function platformOriginLabel(value: PlatformOrigin | string | null | undefined) {
  return PLATFORM_ORIGIN_LABELS[normalizePlatformOrigin(value)];
}
