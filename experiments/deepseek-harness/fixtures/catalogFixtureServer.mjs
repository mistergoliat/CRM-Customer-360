// SALES-AGENT-R2-A13-H0 bake-off. Deterministic local double of the real
// Catalog Service HTTP contract (lib/catalog/httpCatalogAdapter.ts), so both
// the R2 runner and the Harness runner see IDENTICAL, reproducible catalog
// data instead of depending on a live microservice that may not be running
// in this environment. Mirrors the exact request/response shapes that
// adapter parses (see parseProductIntentResponse / parseProductResponse) --
// this is fixture data for a fair architecture comparison, never presented
// as real PesasChile inventory.
import http from "node:http";

const PRODUCTS = {
  "101": { productId: "101", name: "Barra Olimpica 15kg", shortDescription: "Barra olimpica cromada 15kg, 220cm", price: 89990, weightKg: 15, stockQuantity: 12 },
  "102": { productId: "102", name: "Barra Olimpica 20kg", shortDescription: "Barra olimpica cromada 20kg, 220cm, uso competencia", price: 129990, weightKg: 20, stockQuantity: 6 },
  "103": { productId: "103", name: "Barra Olimpica Economica 15kg", shortDescription: "Barra olimpica pintada 15kg, uso hogar", price: 59990, weightKg: 15, stockQuantity: 20 },
  "104": { productId: "104", name: "Disco Olimpico 10kg", shortDescription: "Disco de goma para barra olimpica, par", price: 34990, weightKg: 10, stockQuantity: 40 },
  "105": { productId: "105", name: "Mancuerna Ajustable 20kg", shortDescription: "Mancuerna ajustable de 2 a 20kg, par", price: 119990, weightKg: 20, stockQuantity: 8 },
  "106": { productId: "106", name: "Banco de Musculacion Plegable", shortDescription: "Banco ajustable multiposicion", price: 79990, weightKg: 18, stockQuantity: 5 },
  "107": { productId: "107", name: "Rack de Sentadillas Basico", shortDescription: "Rack de potencia para sentadilla y press", price: 199990, weightKg: 45, stockQuantity: 3 }
};

function candidate(product, rank) {
  return {
    product: {
      productId: product.productId,
      name: product.name,
      description: product.shortDescription,
      price: { amount: product.price, currency: "CLP" },
      stock: { status: "in_stock", available: true, quantity: product.stockQuantity }
    },
    match: { rank, score: 0.9 - rank * 0.05, reasons: ["NAME_TOKEN_MATCH"] }
  };
}

function detail(product) {
  return {
    product: { productId: Number(product.productId), name: product.name, sku: null, shortDescription: product.shortDescription, longDescription: null, active: true },
    variants: [],
    selectedVariant: null,
    pricing: { effectiveUnitPrice: product.price, currency: "CLP", taxIncluded: true, taxRate: 0.19, discountApplied: false },
    stock: { available: true, physicalQuantity: product.stockQuantity },
    weightKg: product.weightKg,
    freshness: { cached: false }
  };
}

function resolveIntent(query) {
  const q = query.toLowerCase();
  if (q.includes("cinta de correr") || q.includes("caminadora") || q.includes("elip")) {
    return { resolution: { status: "no_match", confidence: 0 }, candidates: [], clarification: null };
  }
  if (q.includes("mas barata") || q.includes("economica")) {
    return { resolution: { status: "resolved", confidence: 0.9, sourceProduct: { productId: "103" } }, candidates: [candidate(PRODUCTS["103"], 1)], clarification: null };
  }
  if (q.includes("15kg") || q.includes("15 kg")) {
    return { resolution: { status: "resolved", confidence: 0.95, sourceProduct: { productId: "101" } }, candidates: [candidate(PRODUCTS["101"], 1)], clarification: null };
  }
  if (q.includes("20kg") || q.includes("20 kg")) {
    return { resolution: { status: "resolved", confidence: 0.95, sourceProduct: { productId: "102" } }, candidates: [candidate(PRODUCTS["102"], 1)], clarification: null };
  }
  if (q.includes("barra olimpica") || q.includes("barra")) {
    return {
      resolution: { status: "clarification_required", confidence: 0.5 },
      candidates: [candidate(PRODUCTS["101"], 1), candidate(PRODUCTS["102"], 2)],
      clarification: {
        dimension: "weight",
        options: [
          { value: "101", label: "15kg", productIds: ["101"] },
          { value: "102", label: "20kg", productIds: ["102"] }
        ]
      }
    };
  }
  if (q.includes("disco")) return { resolution: { status: "resolved", confidence: 0.95, sourceProduct: { productId: "104" } }, candidates: [candidate(PRODUCTS["104"], 1)], clarification: null };
  if (q.includes("mancuerna")) return { resolution: { status: "resolved", confidence: 0.95, sourceProduct: { productId: "105" } }, candidates: [candidate(PRODUCTS["105"], 1)], clarification: null };
  if (q.includes("banco")) return { resolution: { status: "resolved", confidence: 0.95, sourceProduct: { productId: "106" } }, candidates: [candidate(PRODUCTS["106"], 1)], clarification: null };
  if (q.includes("rack")) return { resolution: { status: "resolved", confidence: 0.95, sourceProduct: { productId: "107" } }, candidates: [candidate(PRODUCTS["107"], 1)], clarification: null };
  return { resolution: { status: "no_match", confidence: 0 }, candidates: [], clarification: null };
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });
}

export function startCatalogFixtureServer(port = 0) {
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "";

    if (req.method === "POST" && url === "/api/v2/catalog/resolve-product-intent") {
      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}");
      const query = parsed.query ?? "";
      const resolved = resolveIntent(query);
      return sendJson(res, 200, {
        query: { original: query, normalized: query },
        ...resolved,
        statistics: { retrieved: resolved.candidates.length, eligible: resolved.candidates.length, returned: resolved.candidates.length },
        warnings: [],
        correlationId: "bakeoff-fixture"
      });
    }

    if (req.method === "GET" && url.startsWith("/v1/products/search")) {
      const q = new URL(url, "http://localhost").searchParams.get("q") ?? "";
      const resolved = resolveIntent(q);
      const items = resolved.candidates.map((c) => c.product);
      return sendJson(res, 200, { items, total: items.length, provenance: { source: "catalog_service_http", retrievedAt: new Date().toISOString(), cached: false } });
    }

    if (req.method === "POST" && url === "/v1/products/batch") {
      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}");
      const items = (parsed.items ?? []).map((item) => {
        const product = PRODUCTS[String(item.productId)];
        if (!product) return { ok: false, input: { productId: item.productId }, error: { code: "PRODUCT_NOT_FOUND", message: "not found" } };
        return { ok: true, input: { productId: item.productId }, product: detail(product) };
      });
      return sendJson(res, 200, { items });
    }

    const detailMatch = url.match(/^\/v1\/products\/(\d+)/);
    if (req.method === "GET" && detailMatch) {
      const product = PRODUCTS[detailMatch[1]];
      if (!product) return sendJson(res, 404, { error: { code: "PRODUCT_NOT_FOUND", message: "not found" } });
      return sendJson(res, 200, detail(product));
    }

    return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "unmapped bake-off fixture route" } });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: address.port, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

// Allow running standalone: `node fixtures/catalogFixtureServer.mjs [port]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2]) || 4010;
  startCatalogFixtureServer(port).then(({ baseUrl }) => {
    console.log(`catalog fixture server listening at ${baseUrl}`);
  });
}
