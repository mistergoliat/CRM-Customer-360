import type { CatalogConsoleError, CatalogConsoleProduct } from "@/lib/catalog/consoleService";

export function formatMoney(value: CatalogConsoleProduct["price"]): string {
  if (!value) return "Precio no disponible";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: value.currency, maximumFractionDigits: 0 }).format(value.amount);
}

export function formatStock(product: CatalogConsoleProduct): string {
  if (product.stock.quantity === null) return "Stock no informado";
  return `${product.stock.quantity} unidades`;
}

export function availabilityLabel(product: CatalogConsoleProduct): string {
  if (product.availability === "in_stock" || product.availability === "available") return "Disponible";
  if (product.availability === "out_of_stock") return "Sin stock";
  if (product.availability === "inactive") return "Inactivo";
  if (product.availability === "unavailable_for_order") return "No comprable";
  return "Disponibilidad no confirmada";
}

export function formatPercent(value: number): string {
  const percent = value * 100;
  return `${Math.abs(percent) < 10 ? percent.toFixed(2) : percent.toFixed(1)}%`;
}

export function formatMultiplier(value: number): string {
  return `${value.toFixed(2)}x`;
}

export function errorMessage(error: CatalogConsoleError): string {
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
    case "invalid_limit":
      return "El limite solicitado no es valido.";
    case "invalid_catalog_response":
      return "Catalog Service respondio con un contrato inesperado.";
    case "catalog_request_failed":
      return "El request a Catalog Service fallo.";
  }
}
