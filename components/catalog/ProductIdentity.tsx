import type { CatalogConsoleProduct } from "@/lib/catalog/consoleService";

export function ProductIdentity({ product }: { product: CatalogConsoleProduct }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-label-sm text-slate-500">
      <span>ID {product.productId}</span>
      {product.reference ? <span>Ref {product.reference}</span> : null}
    </div>
  );
}
