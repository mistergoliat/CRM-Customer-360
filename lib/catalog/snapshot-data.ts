import type {
  AvailabilityStatus,
  CatalogConfidence,
  CatalogFreshness,
  CatalogSource,
  Dimensions
} from "./types";

export type SnapshotContextKey = {
  shop: string;
  currency: string;
  locale: string;
};

export type SnapshotPriceRecord = {
  shop: string;
  currency: string;
  listPrice: number | null;
  salePrice: number | null;
  validFrom: string | null;
  validTo: string | null;
  taxIncluded: boolean;
  taxRate: number | null;
  taxCode: string | null;
  source: CatalogSource;
  retrievedAt: string;
  confidence: CatalogConfidence;
};

export type SnapshotAvailabilityRecord = {
  shop: string;
  status: AvailabilityStatus;
  quantity: number | null;
  location: string | null;
  leadTimeDays: number | null;
  source: CatalogSource;
  retrievedAt: string;
  confidence: CatalogConfidence;
};

export type SnapshotDimensionRecord = {
  shop: string;
  assembled: Dimensions | null;
  packaged: Dimensions | null;
  source: CatalogSource;
  retrievedAt: string;
  confidence: CatalogConfidence;
};

export type SnapshotUrlRecord = {
  shop: string;
  href: string;
  label: string;
  source: CatalogSource;
  retrievedAt: string;
  confidence: CatalogConfidence;
};

export type SnapshotCompatibilityRule = {
  kind: "true" | "false" | "unknown";
  candidateId?: string | null;
  tags?: string[];
  reasons: string[];
  restrictions: string[];
  evidence: string[];
};

export type SnapshotVariantRecord = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  description: string | null;
  optionValues: Record<string, string>;
  isDefault: boolean;
  status: "active" | "discontinued" | "unknown";
  tags: string[];
  price: SnapshotPriceRecord[];
  availability: SnapshotAvailabilityRecord[];
  dimensions: SnapshotDimensionRecord[];
  commercialUrl: SnapshotUrlRecord[];
  freshness: CatalogFreshness;
  provenance: {
    source: CatalogSource;
    retrievedAt: string;
    confidence: CatalogConfidence;
  };
};

export type SnapshotProductRecord = {
  id: string;
  familyId: string | null;
  sku: string | null;
  name: string;
  slug: string | null;
  description: string | null;
  brand: string | null;
  category: string | null;
  tags: string[];
  attributes: Record<string, string>;
  status: "active" | "discontinued" | "unknown";
  variantIds: string[];
  defaultVariantId: string | null;
  relations: Array<{
    relatedId: string;
    relationType: "same_family" | "accessory" | "bundle" | "substitute" | "compatible" | "upsell" | "cross_sell" | "replacement";
    reason: string;
  }>;
  compatibility: SnapshotCompatibilityRule[];
  freshness: CatalogFreshness;
  provenance: {
    source: CatalogSource;
    retrievedAt: string;
    confidence: CatalogConfidence;
  };
};

const freshAt = "2026-06-26T09:00:00.000Z";
const staleAt = "2025-01-15T09:00:00.000Z";

export const snapshotProducts: SnapshotProductRecord[] = [
  {
    id: "bench-basic",
    familyId: "bench-basic",
    sku: "BENCH-BASIC",
    name: "Bench Basic",
    slug: "bench-basic",
    description: "Banco simple para entrenamiento en casa.",
    brand: "Crimson Logic",
    category: "strength",
    tags: ["bench", "home", "strength"],
    attributes: { material: "steel", use_case: "home" },
    status: "active",
    variantIds: ["bench-basic:default"],
    defaultVariantId: "bench-basic:default",
    relations: [
      { relatedId: "mat-pro", relationType: "accessory", reason: "estera complementaria" }
    ],
    compatibility: [
      { kind: "true", tags: ["bench", "home"], reasons: ["Diseñada para uso doméstico."], restrictions: [], evidence: ["tags:bench", "tags:home"] }
    ],
    freshness: "fresh",
    provenance: { source: "snapshot", retrievedAt: freshAt, confidence: "high" }
  },
  {
    id: "bike-pro",
    familyId: "bike-pro",
    sku: "BIKE-PRO",
    name: "Bike Pro",
    slug: "bike-pro",
    description: "Bicicleta comercial con variantes de color.",
    brand: "Crimson Logic",
    category: "cardio",
    tags: ["bike", "cardio", "commercial"],
    attributes: { frame: "alloy", use_case: "commercial" },
    status: "active",
    variantIds: ["bike-pro-black", "bike-pro-white"],
    defaultVariantId: "bike-pro-black",
    relations: [
      { relatedId: "hr-monitor", relationType: "compatible", reason: "Monitoreo cardiaco complementario" },
      { relatedId: "bundle-cardio", relationType: "bundle", reason: "Bundle de cardio" }
    ],
    compatibility: [
      { kind: "true", candidateId: "hr-monitor", tags: ["heart-rate", "bike"], reasons: ["Compatible con monitor HR."], restrictions: [], evidence: ["bundle-cardio"] },
      { kind: "false", candidateId: "tiny-mat", tags: ["mat-small"], reasons: ["La estera es demasiado pequeña para este equipo."], restrictions: ["requires_large_mat"], evidence: ["dimensions"] },
      { kind: "unknown", candidateId: "mystery-addon", tags: ["mystery"], reasons: ["No existe evidencia suficiente para afirmar compatibilidad."], restrictions: [], evidence: [] }
    ],
    freshness: "fresh",
    provenance: { source: "snapshot", retrievedAt: freshAt, confidence: "high" }
  },
  {
    id: "treadmill-sale",
    familyId: "treadmill-sale",
    sku: "TREADMILL-SALE",
    name: "Treadmill Sale",
    slug: "treadmill-sale",
    description: "Cinta de correr con promoción activa.",
    brand: "Crimson Logic",
    category: "cardio",
    tags: ["treadmill", "sale", "cardio"],
    attributes: { foldable: "yes" },
    status: "active",
    variantIds: ["treadmill-sale:default"],
    defaultVariantId: "treadmill-sale:default",
    relations: [
      { relatedId: "mat-pro", relationType: "accessory", reason: "Superficie de entrenamiento recomendada" }
    ],
    compatibility: [
      { kind: "true", tags: ["cardio"], reasons: ["Aplica a entrenamientos de cardio."], restrictions: [], evidence: ["sale promo"] }
    ],
    freshness: "fresh",
    provenance: { source: "snapshot", retrievedAt: freshAt, confidence: "high" }
  },
  {
    id: "mystery-band",
    familyId: "mystery-band",
    sku: "MYSTERY-BAND",
    name: "Mystery Band",
    slug: "mystery-band",
    description: "Producto de catálogo con precio no verificado.",
    brand: "Crimson Logic",
    category: "accessory",
    tags: ["accessory", "unknown-price"],
    attributes: {},
    status: "active",
    variantIds: ["mystery-band:default"],
    defaultVariantId: "mystery-band:default",
    relations: [],
    compatibility: [
      { kind: "unknown", reasons: ["No hay reglas de compatibilidad suficientes."], restrictions: [], evidence: [] }
    ],
    freshness: "fresh",
    provenance: { source: "snapshot", retrievedAt: freshAt, confidence: "medium" }
  },
  {
    id: "paddock-rower",
    familyId: "paddock-rower",
    sku: "PADDOCK-ROWER",
    name: "Paddock Rower",
    slug: "paddock-rower",
    description: "Remo con stock no confirmado.",
    brand: "Crimson Logic",
    category: "cardio",
    tags: ["rower", "unknown-stock"],
    attributes: {},
    status: "active",
    variantIds: ["paddock-rower:default"],
    defaultVariantId: "paddock-rower:default",
    relations: [],
    compatibility: [
      { kind: "unknown", reasons: ["La evidencia de compatibilidad aún no es suficiente."], restrictions: [], evidence: [] }
    ],
    freshness: "fresh",
    provenance: { source: "snapshot", retrievedAt: freshAt, confidence: "medium" }
  },
  {
    id: "legacy-bike",
    familyId: "legacy-bike",
    sku: "LEGACY-BIKE",
    name: "Legacy Bike",
    slug: "legacy-bike",
    description: "Producto descontinuado.",
    brand: "Legacy Line",
    category: "cardio",
    tags: ["bike", "legacy"],
    attributes: {},
    status: "discontinued",
    variantIds: ["legacy-bike:default"],
    defaultVariantId: "legacy-bike:default",
    relations: [{ relatedId: "bike-pro", relationType: "replacement", reason: "Sustituido por Bike Pro" }],
    compatibility: [
      { kind: "false", reasons: ["El producto fue discontinuado."], restrictions: ["discontinued"], evidence: ["status:discontinued"] }
    ],
    freshness: "fresh",
    provenance: { source: "snapshot", retrievedAt: freshAt, confidence: "high" }
  },
  {
    id: "folding-bench",
    familyId: "folding-bench",
    sku: "FOLDING-BENCH",
    name: "Folding Bench",
    slug: "folding-bench",
    description: "Banco plegable con medidas ensambladas y embaladas.",
    brand: "Crimson Logic",
    category: "strength",
    tags: ["bench", "folding", "space-saving"],
    attributes: { folding: "yes" },
    status: "active",
    variantIds: ["folding-bench:default"],
    defaultVariantId: "folding-bench:default",
    relations: [{ relatedId: "mat-pro", relationType: "accessory", reason: "Usar con mat de entrenamiento" }],
    compatibility: [
      { kind: "true", tags: ["bench", "space-saving"], reasons: ["Diseño plegable para espacios reducidos."], restrictions: [], evidence: ["assembled vs packaged"] }
    ],
    freshness: "stale",
    provenance: { source: "snapshot", retrievedAt: staleAt, confidence: "medium" }
  },
  {
    id: "mat-pro",
    familyId: "mat-pro",
    sku: "MAT-PRO",
    name: "Mat Pro",
    slug: "mat-pro",
    description: "Estera profesional.",
    brand: "Crimson Logic",
    category: "accessory",
    tags: ["mat", "accessory"],
    attributes: {},
    status: "active",
    variantIds: ["mat-pro:default"],
    defaultVariantId: "mat-pro:default",
    relations: [{ relatedId: "bench-basic", relationType: "compatible", reason: "Complemento para banco" }],
    compatibility: [
      { kind: "true", candidateId: "bench-basic", tags: ["bench"], reasons: ["Complementa bancos de entrenamiento."], restrictions: [], evidence: ["accessory relation"] }
    ],
    freshness: "fresh",
    provenance: { source: "snapshot", retrievedAt: freshAt, confidence: "high" }
  }
];

export const snapshotVariants: SnapshotVariantRecord[] = [
  {
    id: "bench-basic:default",
    productId: "bench-basic",
    sku: "BENCH-BASIC-DEF",
    name: "Bench Basic",
    description: "Versión simple.",
    optionValues: {},
    isDefault: true,
    status: "active",
    tags: ["bench", "home"],
    price: [
      {
        shop: "cl-main",
        currency: "CLP",
        listPrice: 149000,
        salePrice: null,
        validFrom: null,
        validTo: null,
        taxIncluded: true,
        taxRate: 19,
        taxCode: "CL-IVA",
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    availability: [
      {
        shop: "cl-main",
        status: "in_stock",
        quantity: 12,
        location: "Santiago",
        leadTimeDays: 2,
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    dimensions: [
      {
        shop: "cl-main",
        assembled: { length: 120, width: 45, height: 45, unit: "cm" },
        packaged: { length: 125, width: 50, height: 20, unit: "cm" },
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    commercialUrl: [
      {
        shop: "cl-main",
        href: "https://catalog.local/cl/bench-basic",
        label: "Bench Basic",
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    freshness: "fresh",
    provenance: { source: "snapshot", retrievedAt: freshAt, confidence: "high" }
  },
  {
    id: "bike-pro-black",
    productId: "bike-pro",
    sku: "BIKE-PRO-BLK",
    name: "Bike Pro Black",
    description: "Color black.",
    optionValues: { color: "black" },
    isDefault: true,
    status: "active",
    tags: ["bike", "cardio", "black"],
    price: [
      {
        shop: "cl-main",
        currency: "CLP",
        listPrice: 289000,
        salePrice: null,
        validFrom: null,
        validTo: null,
        taxIncluded: true,
        taxRate: 19,
        taxCode: "CL-IVA",
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      },
      {
        shop: "intl-store",
        currency: "USD",
        listPrice: 329,
        salePrice: 299,
        validFrom: "2026-06-01T00:00:00.000Z",
        validTo: "2026-12-31T23:59:59.000Z",
        taxIncluded: false,
        taxRate: 0,
        taxCode: "US-NONTAX",
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    availability: [
      {
        shop: "cl-main",
        status: "in_stock",
        quantity: 5,
        location: "Bodega central",
        leadTimeDays: 1,
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      },
      {
        shop: "intl-store",
        status: "preorder",
        quantity: 0,
        location: "US warehouse",
        leadTimeDays: 14,
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    dimensions: [
      {
        shop: "cl-main",
        assembled: { length: 145, width: 55, height: 115, unit: "cm" },
        packaged: { length: 150, width: 60, height: 120, unit: "cm" },
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    commercialUrl: [
      {
        shop: "cl-main",
        href: "https://catalog.local/cl/bike-pro",
        label: "Bike Pro Black",
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      },
      {
        shop: "intl-store",
        href: "https://catalog.local/us/bike-pro-black",
        label: "Bike Pro Black",
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    freshness: "fresh",
    provenance: { source: "snapshot", retrievedAt: freshAt, confidence: "high" }
  },
  {
    id: "bike-pro-white",
    productId: "bike-pro",
    sku: "BIKE-PRO-WHT",
    name: "Bike Pro White",
    description: "Color white.",
    optionValues: { color: "white" },
    isDefault: false,
    status: "active",
    tags: ["bike", "cardio", "white"],
    price: [
      {
        shop: "cl-main",
        currency: "CLP",
        listPrice: 279000,
        salePrice: 249000,
        validFrom: "2026-05-01T00:00:00.000Z",
        validTo: "2026-12-31T23:59:59.000Z",
        taxIncluded: true,
        taxRate: 19,
        taxCode: "CL-IVA",
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    availability: [
      {
        shop: "cl-main",
        status: "backorder",
        quantity: 0,
        location: "Bodega central",
        leadTimeDays: 5,
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    dimensions: [
      {
        shop: "cl-main",
        assembled: { length: 145, width: 55, height: 115, unit: "cm" },
        packaged: { length: 150, width: 60, height: 120, unit: "cm" },
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    commercialUrl: [
      {
        shop: "cl-main",
        href: "https://catalog.local/cl/bike-pro-white",
        label: "Bike Pro White",
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    freshness: "fresh",
    provenance: { source: "snapshot", retrievedAt: freshAt, confidence: "high" }
  },
  {
    id: "treadmill-sale:default",
    productId: "treadmill-sale",
    sku: "TREADMILL-SALE-DEF",
    name: "Treadmill Sale",
    description: "Promo activa.",
    optionValues: {},
    isDefault: true,
    status: "active",
    tags: ["treadmill", "sale"],
    price: [
      {
        shop: "cl-main",
        currency: "CLP",
        listPrice: 499000,
        salePrice: 399000,
        validFrom: "2026-06-01T00:00:00.000Z",
        validTo: "2026-12-31T23:59:59.000Z",
        taxIncluded: true,
        taxRate: 19,
        taxCode: "CL-IVA",
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    availability: [
      {
        shop: "cl-main",
        status: "in_stock",
        quantity: 5,
        location: "Bodega central",
        leadTimeDays: 3,
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    dimensions: [
      {
        shop: "cl-main",
        assembled: { length: 170, width: 80, height: 140, unit: "cm" },
        packaged: { length: 180, width: 85, height: 150, unit: "cm" },
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    commercialUrl: [
      {
        shop: "cl-main",
        href: "https://catalog.local/cl/treadmill-sale",
        label: "Treadmill Sale",
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    freshness: "fresh",
    provenance: { source: "snapshot", retrievedAt: freshAt, confidence: "high" }
  },
  {
    id: "mystery-band:default",
    productId: "mystery-band",
    sku: "MYSTERY-BAND-DEF",
    name: "Mystery Band",
    description: "Sin precio verificado.",
    optionValues: {},
    isDefault: true,
    status: "active",
    tags: ["unknown-price"],
    price: [],
    availability: [
      {
        shop: "cl-main",
        status: "unknown",
        quantity: null,
        location: null,
        leadTimeDays: null,
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "low"
      }
    ],
    dimensions: [],
    commercialUrl: [],
    freshness: "fresh",
    provenance: { source: "snapshot", retrievedAt: freshAt, confidence: "low" }
  },
  {
    id: "paddock-rower:default",
    productId: "paddock-rower",
    sku: "PADDOCK-ROWER-DEF",
    name: "Paddock Rower",
    description: "Stock no confirmado.",
    optionValues: {},
    isDefault: true,
    status: "active",
    tags: ["unknown-stock"],
    price: [
      {
        shop: "cl-main",
        currency: "CLP",
        listPrice: 219000,
        salePrice: null,
        validFrom: null,
        validTo: null,
        taxIncluded: true,
        taxRate: 19,
        taxCode: "CL-IVA",
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "medium"
      }
    ],
    availability: [],
    dimensions: [
      {
        shop: "cl-main",
        assembled: { length: 210, width: 60, height: 90, unit: "cm" },
        packaged: { length: 220, width: 65, height: 100, unit: "cm" },
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    commercialUrl: [
      {
        shop: "cl-main",
        href: "https://catalog.local/cl/paddock-rower",
        label: "Paddock Rower",
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    freshness: "fresh",
    provenance: { source: "snapshot", retrievedAt: freshAt, confidence: "medium" }
  },
  {
    id: "legacy-bike:default",
    productId: "legacy-bike",
    sku: "LEGACY-BIKE-DEF",
    name: "Legacy Bike",
    description: "Descontinuado.",
    optionValues: {},
    isDefault: true,
    status: "discontinued",
    tags: ["legacy"],
    price: [
      {
        shop: "cl-main",
        currency: "CLP",
        listPrice: 199000,
        salePrice: null,
        validFrom: null,
        validTo: "2025-12-31T23:59:59.000Z",
        taxIncluded: true,
        taxRate: 19,
        taxCode: "CL-IVA",
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    availability: [
      {
        shop: "cl-main",
        status: "discontinued",
        quantity: 0,
        location: null,
        leadTimeDays: null,
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    dimensions: [],
    commercialUrl: [],
    freshness: "fresh",
    provenance: { source: "snapshot", retrievedAt: freshAt, confidence: "high" }
  },
  {
    id: "folding-bench:default",
    productId: "folding-bench",
    sku: "FOLDING-BENCH-DEF",
    name: "Folding Bench",
    description: "Plegable.",
    optionValues: {},
    isDefault: true,
    status: "active",
    tags: ["bench", "folding"],
    price: [
      {
        shop: "cl-main",
        currency: "CLP",
        listPrice: 169000,
        salePrice: null,
        validFrom: null,
        validTo: null,
        taxIncluded: true,
        taxRate: 19,
        taxCode: "CL-IVA",
        source: "snapshot",
        retrievedAt: staleAt,
        confidence: "medium"
      },
      {
        shop: "intl-store",
        currency: "USD",
        listPrice: 219,
        salePrice: null,
        validFrom: null,
        validTo: null,
        taxIncluded: false,
        taxRate: 0,
        taxCode: "US-NONTAX",
        source: "snapshot",
        retrievedAt: staleAt,
        confidence: "medium"
      }
    ],
    availability: [
      {
        shop: "cl-main",
        status: "in_stock",
        quantity: 2,
        location: "Outbound rack",
        leadTimeDays: 4,
        source: "snapshot",
        retrievedAt: staleAt,
        confidence: "medium"
      }
    ],
    dimensions: [
      {
        shop: "cl-main",
        assembled: { length: 125, width: 45, height: 45, unit: "cm" },
        packaged: { length: 130, width: 50, height: 25, unit: "cm" },
        source: "snapshot",
        retrievedAt: staleAt,
        confidence: "medium"
      }
    ],
    commercialUrl: [
      {
        shop: "cl-main",
        href: "https://catalog.local/cl/folding-bench",
        label: "Folding Bench",
        source: "snapshot",
        retrievedAt: staleAt,
        confidence: "medium"
      },
      {
        shop: "intl-store",
        href: "https://catalog.local/us/folding-bench",
        label: "Folding Bench",
        source: "snapshot",
        retrievedAt: staleAt,
        confidence: "medium"
      }
    ],
    freshness: "stale",
    provenance: { source: "snapshot", retrievedAt: staleAt, confidence: "medium" }
  },
  {
    id: "mat-pro:default",
    productId: "mat-pro",
    sku: "MAT-PRO-DEF",
    name: "Mat Pro",
    description: "Complemento.",
    optionValues: {},
    isDefault: true,
    status: "active",
    tags: ["mat", "accessory"],
    price: [
      {
        shop: "cl-main",
        currency: "CLP",
        listPrice: 39000,
        salePrice: null,
        validFrom: null,
        validTo: null,
        taxIncluded: true,
        taxRate: 19,
        taxCode: "CL-IVA",
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    availability: [
      {
        shop: "cl-main",
        status: "in_stock",
        quantity: 18,
        location: "Bodega central",
        leadTimeDays: 1,
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    dimensions: [
      {
        shop: "cl-main",
        assembled: { length: 190, width: 70, height: 1, unit: "cm" },
        packaged: { length: 190, width: 70, height: 5, unit: "cm" },
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    commercialUrl: [
      {
        shop: "cl-main",
        href: "https://catalog.local/cl/mat-pro",
        label: "Mat Pro",
        source: "snapshot",
        retrievedAt: freshAt,
        confidence: "high"
      }
    ],
    freshness: "fresh",
    provenance: { source: "snapshot", retrievedAt: freshAt, confidence: "high" }
  }
];

