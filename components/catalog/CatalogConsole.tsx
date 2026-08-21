"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Icon } from "@/components/ui/Icon";
import { StatusChip } from "@/components/ui/StatusChip";
import type { CatalogConsoleError, CatalogConsoleProduct, CatalogProductContextResult, CatalogSearchProductsResult } from "@/lib/catalog/consoleService";
import { availabilityLabel, errorMessage, formatMoney, formatStock } from "./catalogDisplay";
import { ProductIdentity } from "./ProductIdentity";
import { RecommendationList } from "./RecommendationList";
import { createRelatedRecommendationsCache, type RelatedRecommendationsCache } from "./relatedRecommendationsCache";

const MIN_SEARCH_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 350;
const DEFAULT_RECOMMENDATION_LIMIT = 5;

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

async function fetchProductContext(productId: string, limit: number): Promise<CatalogProductContextResult> {
  const response = await fetch(`/api/catalog/products/${encodeURIComponent(productId)}/context?limit=${limit}`);
  const payload = (await response.json()) as CatalogProductContextResult | { error: CatalogConsoleError };
  if (!response.ok || !("ok" in payload)) {
    const error = "error" in payload ? payload.error : { code: "catalog_request_failed", message: "Context request failed.", retryable: false } satisfies CatalogConsoleError;
    return { ok: false, error };
  }
  return payload;
}

export function CatalogConsole() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogConsoleProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<CatalogConsoleError | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recommendationLimit, setRecommendationLimit] = useState(DEFAULT_RECOMMENDATION_LIMIT);
  const [context, setContext] = useState<CatalogProductContextResult | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [recommendationsRefreshing, setRecommendationsRefreshing] = useState(false);
  const relatedCacheRef = useRef<RelatedRecommendationsCache | null>(null);

  if (relatedCacheRef.current === null) {
    relatedCacheRef.current = createRelatedRecommendationsCache(fetchProductContext);
  }

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
    setRecommendationsRefreshing(false);
    setContext(null);
    try {
      setContext(await fetchProductContext(product.productId, recommendationLimit));
    } catch {
      setContext({ ok: false, error: { code: "catalog_unavailable", message: "Context request failed.", retryable: true } });
    } finally {
      setContextLoading(false);
    }
  }

  async function changeRecommendationLimit(nextLimit: number) {
    setRecommendationLimit(nextLimit);
    if (selectedId === null) return;
    setRecommendationsRefreshing(true);
    try {
      setContext(await fetchProductContext(selectedId, nextLimit));
    } catch {
      setContext({ ok: false, error: { code: "catalog_unavailable", message: "Context request failed.", retryable: true } });
    } finally {
      setRecommendationsRefreshing(false);
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
            <RecommendationList
              context={context}
              selectedLimit={recommendationLimit}
              refreshing={recommendationsRefreshing}
              onLimitChange={changeRecommendationLimit}
              loadRelated={(productId, limit) => relatedCacheRef.current?.load(productId, limit) ?? fetchProductContext(productId, limit)}
            />
          </>
        ) : null}
      </main>
    </div>
  );
}
