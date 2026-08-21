"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Icon } from "@/components/ui/Icon";
import { StatusChip } from "@/components/ui/StatusChip";
import type { CatalogConsoleError, CatalogConsoleProduct, CatalogConsoleRecommendation, CatalogProductContextResult, CatalogSearchProductsResult } from "@/lib/catalog/consoleService";

const MIN_SEARCH_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 350;

function formatMoney(value: CatalogConsoleProduct["price"]): string {
  if (!value) return "Precio no disponible";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: value.currency, maximumFractionDigits: 0 }).format(value.amount);
}

function formatStock(product: CatalogConsoleProduct): string {
  if (product.stock.quantity === null) return "Stock no informado";
  return `${product.stock.quantity} unidades`;
}

function availabilityLabel(product: CatalogConsoleProduct): string {
  if (product.availability === "in_stock" || product.availability === "available") return "Disponible";
  if (product.availability === "out_of_stock") return "Sin stock";
  if (product.availability === "inactive") return "Inactivo";
  if (product.availability === "unavailable_for_order") return "No comprable";
  return "Disponibilidad no confirmada";
}

function errorMessage(error: CatalogConsoleError): string {
  switch (error.code) {
    case "catalog_not_configured":
      return "Catalog Service no esta configurado en el backend del CRM.";
    case "catalog_unauthorized":
      return "Catalog Service rechazo las credenciales configuradas.";
    case "catalog_timeout":
      return "Catalog Service no respondio dentro del timeout.";
    case "catalog_unavailable":
      return "Catalog Service no esta disponible temporalmente.";
    case "product_not_found":
      return "El producto no existe o no esta disponible en Catalog Service.";
    case "invalid_query":
      return "La busqueda debe tener texto valido.";
    case "invalid_product_id":
      return "El productId seleccionado no es valido.";
    case "invalid_catalog_response":
      return "Catalog Service respondio con un contrato inesperado.";
    case "catalog_request_failed":
      return "El request a Catalog Service fallo.";
  }
}

function ProductIdentity({ product }: { product: CatalogConsoleProduct }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-label-sm text-slate-500">
      <span>ID {product.productId}</span>
      {product.reference ? <span>Ref {product.reference}</span> : null}
    </div>
  );
}

function ProductResultRow({ product, selected, onSelect }: { product: CatalogConsoleProduct; selected: boolean; onSelect: (product: CatalogConsoleProduct) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(product)}
      className={clsx(
        "w-full rounded-xl border p-4 text-left transition",
        selected ? "border-primary bg-primary-fixed/35 shadow-sm" : "border-slate-200 bg-white hover:border-primary/50 hover:bg-slate-50"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="line-clamp-2 text-body-md font-bold text-on-surface">{product.name}</p>
          <ProductIdentity product={product} />
        </div>
        <StatusChip label={availabilityLabel(product)} tone={product.stock.available === false ? "red" : product.stock.available === true ? "green" : "gray"} />
      </div>
      <div className="mt-3 grid gap-2 text-label-sm text-slate-600 sm:grid-cols-2">
        <span>{formatMoney(product.price)}</span>
        <span>{formatStock(product)}</span>
      </div>
    </button>
  );
}

function ProductDetail({ product }: { product: CatalogConsoleProduct }) {
  return (
    <section className="hub-card p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-label-bold uppercase text-primary">Producto seleccionado</p>
          <h2 className="mt-2 text-headline-lg text-on-surface">{product.name}</h2>
          <ProductIdentity product={product} />
        </div>
        <StatusChip label={availabilityLabel(product)} tone={product.stock.available === false ? "red" : product.stock.available === true ? "green" : "gray"} />
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-label-bold uppercase text-slate-500">Precio</p>
          <p className="mt-1 text-headline-md text-on-surface">{formatMoney(product.price)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-label-bold uppercase text-slate-500">Stock</p>
          <p className="mt-1 text-headline-md text-on-surface">{formatStock(product)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-label-bold uppercase text-slate-500">Estado</p>
          <p className="mt-1 text-headline-md text-on-surface">{availabilityLabel(product)}</p>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-label-bold uppercase text-slate-500">Descripcion</p>
        <p className="mt-2 whitespace-pre-line text-body-md text-slate-700">{product.description || "Descripcion no disponible en el contrato actual."}</p>
      </div>

      {product.publicLink ? (
        <a className="mt-4 inline-flex items-center gap-2 text-label-bold uppercase text-primary hover:underline" href={product.publicLink} target="_blank" rel="noreferrer">
          <Icon name="open_in_new" />
          Link publico
        </a>
      ) : null}
    </section>
  );
}

function EvidencePanel({ recommendation }: { recommendation: CatalogConsoleRecommendation }) {
  const evidence = recommendation.relationship.evidence;
  return (
    <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <summary className="cursor-pointer text-label-bold uppercase text-slate-500">Evidencia</summary>
      <div className="mt-3 grid gap-2 text-label-sm text-slate-600 sm:grid-cols-5">
        <span>Joint: {evidence.jointCount}</span>
        <span>Conf: {evidence.confidence.toFixed(3)}</span>
        <span>Lift: {evidence.lift.toFixed(3)}</span>
        <span>Reliability: {evidence.reliability.toFixed(3)}</span>
        <span>Support: {evidence.support.toFixed(3)}</span>
      </div>
    </details>
  );
}

function Recommendations({ context }: { context: Extract<CatalogProductContextResult, { ok: true }> }) {
  const block = context.recommendations;

  return (
    <section className="hub-card p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-label-bold uppercase text-primary">Recomendaciones</p>
          <h2 className="mt-1 text-headline-md text-on-surface">Relacion comercial historica</h2>
        </div>
        {block.status !== "error" && block.execution.degraded ? <StatusChip label="Respuesta parcial" tone="amber" /> : null}
      </div>

      {block.status === "error" ? (
        <div className="mt-4">
          <ErrorState title="Recomendaciones no disponibles" message={errorMessage(block.error)} />
        </div>
      ) : block.status === "empty" ? (
        <div className="mt-4">
          <EmptyState title="Sin recomendaciones" description="No hay recomendaciones comerciales disponibles para este producto." icon="inventory_2" />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {block.items.map((recommendation) => (
            <article key={`${recommendation.productId}-${recommendation.combinationId ?? recommendation.rank}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-fixed text-label-bold text-primary">#{recommendation.rank}</span>
                    <p className="line-clamp-2 text-body-lg font-bold text-on-surface">{recommendation.name}</p>
                  </div>
                  <div className="mt-2">
                    <ProductIdentity product={recommendation} />
                  </div>
                  <p className="mt-3 text-body-md text-slate-700">{recommendation.commercialReason}</p>
                </div>
                <div className="grid min-w-[220px] gap-2 text-label-sm text-slate-600">
                  <span>{formatMoney(recommendation.price)}</span>
                  <span>{formatStock(recommendation)}</span>
                  <span>Score {(recommendation.score * 100).toFixed(1)}%</span>
                  <span>Comercial {(recommendation.commercialScore * 100).toFixed(1)}%</span>
                </div>
              </div>
              <EvidencePanel recommendation={recommendation} />
            </article>
          ))}
        </div>
      )}

      {block.status !== "error" && block.warnings.length > 0 ? (
        <p className="mt-4 text-label-sm text-amber-700">Warnings: {block.warnings.join(", ")}</p>
      ) : null}
    </section>
  );
}

export function CatalogConsole() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogConsoleProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<CatalogConsoleError | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [context, setContext] = useState<CatalogProductContextResult | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  useEffect(() => {
    const normalized = query.trim();
    setSearchError(null);

    if (normalized.length < MIN_SEARCH_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/catalog/products/search?q=${encodeURIComponent(normalized)}&limit=10`, { signal: controller.signal });
        const payload = (await response.json()) as CatalogSearchProductsResult | { error: CatalogConsoleError };
        if (!response.ok || !("ok" in payload) || !payload.ok) {
          const error = "error" in payload ? payload.error : { code: "catalog_request_failed", message: "Search failed.", retryable: false } satisfies CatalogConsoleError;
          setSearchError(error);
          setResults([]);
          return;
        }
        setResults(payload.items);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSearchError({ code: "catalog_unavailable", message: "Search request failed.", retryable: true });
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  async function selectProduct(product: CatalogConsoleProduct) {
    setSelectedId(product.productId);
    setContextLoading(true);
    setContext(null);
    try {
      const response = await fetch(`/api/catalog/products/${encodeURIComponent(product.productId)}/context`);
      const payload = (await response.json()) as CatalogProductContextResult | { error: CatalogConsoleError };
      if (!response.ok || !("ok" in payload)) {
        const error = "error" in payload ? payload.error : { code: "catalog_request_failed", message: "Context request failed.", retryable: false } satisfies CatalogConsoleError;
        setContext({ ok: false, error });
        return;
      }
      setContext(payload);
    } catch {
      setContext({ ok: false, error: { code: "catalog_unavailable", message: "Context request failed.", retryable: true } });
    } finally {
      setContextLoading(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
      <aside className="hub-card p-5 xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto">
        <label className="text-label-bold uppercase text-slate-500" htmlFor="catalog-search">
          Buscar producto
        </label>
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
          <Icon name="search" className="text-slate-500" />
          <input
            id="catalog-search"
            className="h-11 min-w-0 flex-1 border-0 bg-transparent text-body-md outline-none placeholder:text-slate-400"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="banda, mancuerna, banca..."
          />
        </div>
        <p className="mt-2 text-label-sm text-slate-500">Minimo {MIN_SEARCH_LENGTH} caracteres. La busqueda se ejecuta con debounce.</p>

        <div className="mt-5 space-y-3">
          {searching ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-body-md text-slate-600">Buscando productos...</div> : null}
          {searchError ? <ErrorState title="Busqueda no disponible" message={errorMessage(searchError)} /> : null}
          {!searching && !searchError && query.trim().length >= MIN_SEARCH_LENGTH && results.length === 0 ? (
            <EmptyState title="Sin resultados" description="No hay productos para esta busqueda." icon="search_off" />
          ) : null}
          {query.trim().length < MIN_SEARCH_LENGTH ? <EmptyState title="Busca un producto" description="Selecciona un resultado para cargar detalle y recomendaciones automaticamente." icon="inventory_2" /> : null}
          {results.map((product) => (
            <ProductResultRow key={`${product.productId}-${product.combinationId ?? ""}`} product={product} selected={selectedId === product.productId} onSelect={selectProduct} />
          ))}
        </div>
      </aside>

      <main className="space-y-5">
        {contextLoading ? <div className="hub-card p-6 text-body-md text-slate-600">Cargando contexto de producto...</div> : null}
        {!contextLoading && context === null ? (
          <EmptyState title="Sin producto seleccionado" description="La seleccion carga el detalle comercial y las recomendaciones en esta misma vista." icon="ads_click" />
        ) : null}
        {!contextLoading && context?.ok === false ? <ErrorState title="Contexto no disponible" message={errorMessage(context.error)} /> : null}
        {!contextLoading && context?.ok === true ? (
          <>
            {context.warnings.length > 0 ? <ErrorState title="Datos parciales" message={`Detalle con advertencias: ${context.warnings.join(", ")}`} /> : null}
            <ProductDetail product={context.product} />
            <Recommendations context={context} />
          </>
        ) : null}
      </main>
    </div>
  );
}
