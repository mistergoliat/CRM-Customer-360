import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductDetail } from "../../components/catalog/CatalogConsole";
import { CommercialScoreDonut, normalizeCommercialScore } from "../../components/catalog/CommercialScoreDonut";
import { RecommendationCard } from "../../components/catalog/RecommendationCard";
import { RecommendationCommercialSummary } from "../../components/catalog/RecommendationCommercialSummary";
import { RelatedRecommendationItem } from "../../components/catalog/RelatedRecommendations";
import type { CatalogConsoleProduct, CatalogConsoleRecommendation, CatalogProductContextResult } from "../../lib/catalog/consoleService";

(globalThis as { React?: typeof React }).React = React;

function product(overrides: Partial<CatalogConsoleProduct> = {}): CatalogConsoleProduct {
  return {
    productId: "10",
    combinationId: "0",
    name: "Banda de Resistencia Medium",
    reference: "HWM-10",
    description: "Banda de resistencia para entrenamiento funcional",
    price: { amount: 12990, currency: "CLP" },
    stock: { quantity: 12, status: "in_stock", available: true },
    availability: "available",
    active: true,
    publicLink: "https://pesaschile.cl/banda-10.html",
    source: "detail",
    ...overrides
  };
}

function recommendation(overrides: Partial<CatalogConsoleRecommendation> = {}): CatalogConsoleRecommendation {
  return {
    ...product({
      productId: "9",
      name: "Banda de Resistencia Light",
      reference: "HWM-9",
      source: "recommendations_v2"
    }),
    rank: 1,
    score: 0.91,
    commercialScore: 0.381,
    affinityScore: 0,
    affinityConfidence: "none",
    commercialReason: "Comprado frecuentemente junto al producto consultado",
    warnings: [],
    relationship: {
      type: "frequently_bought_together",
      reliability: 0.74,
      evidence: { jointCount: 8, support: 0.12, confidence: 0.42, lift: 2.1, reliability: 0.74 }
    },
    ...overrides
  };
}

async function emptyRelatedContext(): Promise<CatalogProductContextResult> {
  return {
    ok: true,
    product: product(),
    recommendations: {
      status: "empty",
      requestedLimit: 5,
      shownCount: 0,
      truncatedByLimitCount: 0,
      excluded: [],
      statistics: {
        recommendationsReturned: 0,
        commercialCandidates: 0,
        affinityCandidates: 0,
        personalizedRecommendations: 0,
        excludedRecommendations: 0,
        warningsGenerated: 0
      },
      warnings: [],
      execution: { degraded: false, stages: {} },
      snapshot: { id: "snapshot-1", modelVersion: "v1" }
    },
    semantics: { status: "not_available" },
    warnings: []
  };
}

test("product description renders collapsed by default when present", () => {
  const html = renderToStaticMarkup(createElement(ProductDetail, { product: product() }));

  assert.match(html, /<details class="[^"]*">/);
  assert.doesNotMatch(html, /<details class="[^"]*" open="">/);
  assert.match(html, /Descripcion del producto/);
  assert.match(html, /Banda de resistencia para entrenamiento funcional/);
});

test("product description block is omitted when the product has no description", () => {
  const html = renderToStaticMarkup(createElement(ProductDetail, { product: product({ description: null }) }));

  assert.doesNotMatch(html, /Descripcion del producto/);
  assert.doesNotMatch(html, /Descripcion no disponible/);
});

test("commercial score donut renders the expected visible percentage", () => {
  const html = renderToStaticMarkup(createElement(CommercialScoreDonut, { value: 0.381 }));

  assert.match(html, /Commercial/);
  assert.match(html, /38\.1%/);
  assert.match(html, /aria-label="Commercial: puntaje comercial 38\.1%"/);
});

test("commercial score normalization handles percent scale and out-of-range values", () => {
  assert.deepEqual(normalizeCommercialScore(38.1, "percent"), { percent: 38.1, label: "38.1%" });
  assert.deepEqual(normalizeCommercialScore(1.4), { percent: 100, label: "100.0%" });
  assert.deepEqual(normalizeCommercialScore(-0.2), { percent: 0, label: "0.00%" });
  assert.deepEqual(normalizeCommercialScore(undefined), { percent: null, label: "N/D" });
});

test("recommendation card keeps Commercial and Final as separate scores", () => {
  const html = renderToStaticMarkup(
    createElement(RecommendationCard, {
      recommendation: recommendation(),
      parentProductId: "10",
      loadRelated: emptyRelatedContext
    })
  );

  assert.match(html, /Commercial/);
  assert.match(html, /38\.1%/);
  assert.match(html, /Final/);
  assert.match(html, /91\.0%/);
});

test("shared commercial summary maps recommendation scores without replacing Final", () => {
  const html = renderToStaticMarkup(createElement(RecommendationCommercialSummary, { recommendation: recommendation() }));

  assert.match(html, /Precio/);
  assert.match(html, /Stock/);
  assert.match(html, /Commercial/);
  assert.match(html, /38\.1%/);
  assert.match(html, /Final/);
  assert.match(html, /91\.0%/);
});

test("secondary related recommendation item renders Commercial donut and keeps Final", () => {
  const html = renderToStaticMarkup(
    createElement(RelatedRecommendationItem, {
      item: recommendation({ productId: "11", commercialScore: 0.444, score: 0.777 }),
      parentProductId: "10",
      sourceRecommendationName: "Banda de Resistencia Light"
    })
  );

  assert.match(html, /Relacion con Banda de Resistencia Light/);
  assert.match(html, /Commercial/);
  assert.match(html, /44\.4%/);
  assert.match(html, /Final/);
  assert.match(html, /77\.7%/);
});

test("secondary related recommendation item shows N\/D for an invalid Commercial score without hiding Final", () => {
  const html = renderToStaticMarkup(
    createElement(RelatedRecommendationItem, {
      item: recommendation({ commercialScore: Number.NaN, score: 0.612 }),
      parentProductId: "10",
      sourceRecommendationName: "Banda de Resistencia Light"
    })
  );

  assert.match(html, /Commercial/);
  assert.match(html, /N\/D/);
  assert.match(html, /Final/);
  assert.match(html, /61\.2%/);
});

test("catalog score UI copy does not describe commercial score as probability", () => {
  const files = [
    "components/catalog/CommercialScoreDonut.tsx",
    "components/catalog/RecommendationCommercialSummary.tsx",
    "components/catalog/RecommendationCard.tsx",
    "components/catalog/RelatedRecommendations.tsx",
    "components/catalog/RecommendationEvidence.tsx",
    "components/catalog/CatalogConsole.tsx"
  ];
  const source = files.map((file) => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n");

  assert.doesNotMatch(source.toLocaleLowerCase("es-CL"), /probabilidad/);
});
