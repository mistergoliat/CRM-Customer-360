/**
 * CRM-R1-T13E.2. Real smoke test for the shipping-calculation pipeline:
 * commune resolution (pc_pos.comuna) -> Catalog Service product hydration
 * (price/weightKg) -> aggregation (totalWeightKg/total_boleta) -> Carrier MS
 * (http://ms.pesaschile.cl). Makes real network calls - never runs in CI,
 * never writes to any database (no opportunityId, no crm_request_facts row
 * is ever created - this script bypasses the CRM domain layer entirely and
 * calls the same pure pieces the real calculate_shipping capability calls).
 *
 * Two modes:
 *
 *   Product mode (real Catalog Service hydration, matches what a real
 *   customer selection would send):
 *     npx tsx scripts/manual-test/shipping-calculation-smoke.ts \
 *       --destino="Ñuñoa" --items=1:2,7:1
 *
 *   Direct mode (skips Catalog Service - for precise total_boleta/kilos
 *   boundary comparison against carrier_rangos_dd, per T13E section 23):
 *     npx tsx scripts/manual-test/shipping-calculation-smoke.ts \
 *       --destino="Ñuñoa" --kilos=10 --total-boleta=150000
 *
 *   Case matrix mode (runs every boundary case from T13E section 23 in
 *   direct mode, one line per case, for a single operator comparison pass):
 *     npx tsx scripts/manual-test/shipping-calculation-smoke.ts --cases
 */
import { randomUUID } from "node:crypto";
import { createPcPosCommuneResolver } from "../../lib/integrations/logistics";
import { createCatalogPort } from "../../lib/catalog";
import { readCarrierServiceConfig, createHttpCarrierServiceAdapter } from "../../lib/integrations/carrier-service";
import { validateAndSumTotalBoleta, validateAndSumWeightKg } from "../../lib/domains/shipping-calculation";
import type { PricedLineItem, ShippingCalculationLineItem } from "../../lib/domains/shipping-calculation";
import type { CarrierQuoteResult } from "../../lib/domains/carrier-service";

function parseArg(argv: string[], name: string): string | null {
  const prefix = `--${name}=`;
  for (const arg of argv) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function parseItems(raw: string): Array<{ productId: string; quantity: number }> {
  return raw.split(",").map((entry) => {
    const [productId, quantityRaw] = entry.split(":");
    return { productId: productId.trim(), quantity: Number(quantityRaw) };
  });
}

function printQuote(label: string, destino: string, kilos: number, totalBoleta: number, quote: CarrierQuoteResult) {
  console.log(`\nCASE: ${label}`);
  console.log(`  Destination: ${destino}`);
  console.log(`  Weight: ${kilos} kg`);
  console.log(`  Subtotal (total_boleta): ${totalBoleta} CLP`);
  if (!quote.ok) {
    console.log(`  Carrier MS: FAILED reason=${quote.reason} detail=${quote.detail}`);
    return;
  }
  if (quote.options.length === 0) {
    console.log("  Carrier MS: no_shipping_options (no carrier serves this destination)");
    return;
  }
  for (const option of quote.options) {
    console.log(`  - ${option.carrierName} (${option.serviceType}): ${option.totalCost} CLP, eta=${option.estimatedDelivery}`);
  }
}

/** T13E section 23: direct-delivery subtotal boundaries + weight/destination variation. */
async function runCaseMatrix(carrierService: ReturnType<typeof createHttpCarrierServiceAdapter>) {
  const subtotalBoundaries = [59999, 60000, 119999, 120000, 499999, 500000, 999999, 1000000, 2499999, 2500000];
  console.log("=== Direct-delivery subtotal boundaries (RM, Ñuñoa, 10kg fixed) ===");
  for (const totalBoleta of subtotalBoundaries) {
    const quote = await carrierService.quoteAll({ destination: "Ñuñoa", totalWeightKg: 10, totalBoleta });
    printQuote(`subtotal=${totalBoleta}`, "Ñuñoa", 10, totalBoleta, quote);
  }

  console.log("\n=== Weight variation (RM, Ñuñoa, subtotal fixed at 150.000) ===");
  for (const kilos of [0, 1, 20, 100, 500]) {
    const quote = await carrierService.quoteAll({ destination: "Ñuñoa", totalWeightKg: kilos, totalBoleta: 150000 });
    printQuote(`weight=${kilos}kg`, "Ñuñoa", kilos, 150000, quote);
  }

  console.log("\n=== Destination variation (10kg, subtotal 150.000) ===");
  for (const destino of ["Ñuñoa", "Las Condes", "isla de pascua", "ZZZ_NO_EXISTE"]) {
    const quote = await carrierService.quoteAll({ destination: destino, totalWeightKg: 10, totalBoleta: 150000 });
    printQuote(`destination=${destino}`, destino, 10, 150000, quote);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const carrierConfig = readCarrierServiceConfig();
  if (!carrierConfig) {
    console.error("CARRIER_SERVICE_BASE_URL is not set - this smoke test makes real HTTP calls and must never run without it.");
    process.exitCode = 1;
    return;
  }
  const carrierService = createHttpCarrierServiceAdapter(carrierConfig);

  if (hasFlag(argv, "cases")) {
    await runCaseMatrix(carrierService);
    return;
  }

  const destino = parseArg(argv, "destino") ?? "Ñuñoa";
  const itemsArg = parseArg(argv, "items");
  const kilosArg = parseArg(argv, "kilos");
  const totalBoletaArg = parseArg(argv, "total-boleta");
  const correlationId = randomUUID();

  console.log(`Shipping calculation smoke - correlationId=${correlationId}`);
  console.log(`destino="${destino}"`);

  const resolver = createPcPosCommuneResolver();
  const resolution = await resolver.resolve(destino);
  console.log(`\ncommune resolution: ${JSON.stringify(resolution)}`);
  if (resolution.status !== "resolved") {
    console.error("Destination did not resolve to a single commune - cannot proceed (this mirrors calculate_shipping's own fail-closed behavior).");
    process.exitCode = 1;
    return;
  }

  let kilos: number;
  let totalBoleta: number;

  if (itemsArg) {
    const catalogPort = createCatalogPort();
    if (!catalogPort) {
      console.error("CATALOG_SERVICE_BASE_URL/CATALOG_SERVICE_API_KEY are not set - required for --items mode.");
      process.exitCode = 1;
      return;
    }
    const items = parseItems(itemsArg);
    const batch = await catalogPort.batchGetProducts({ items: items.map((item) => ({ productId: item.productId, quantity: item.quantity })) }, { correlationId });
    if (!batch.ok) {
      console.error("batchGetProducts FAILED:", JSON.stringify(batch.error, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log("\nCatalog values:");
    const weightItems: ShippingCalculationLineItem[] = [];
    const priceItems: PricedLineItem[] = [];
    for (const result of batch.value.items) {
      if (!result.ok) {
        console.error(`  productId=${result.input.productId}: catalog_product_unavailable (${result.error.code})`);
        process.exitCode = 1;
        return;
      }
      const quantity = items.find((item) => item.productId === result.input.productId)?.quantity ?? 0;
      console.log(`  productId=${result.product.productId} name="${result.product.name}" price=${result.product.price?.amount ?? "null"} weightKg=${result.product.weightKg ?? "null"} quantity=${quantity}`);
      weightItems.push({ productId: result.product.productId, combinationId: null, quantity, unitWeightKg: result.product.weightKg });
      priceItems.push({ productId: result.product.productId, combinationId: null, quantity, unitPrice: result.product.price?.amount ?? null });
    }

    const weightResult = validateAndSumWeightKg(weightItems);
    const subtotalResult = validateAndSumTotalBoleta(priceItems);
    if (!weightResult.ok) {
      console.error(`\nWeight calculation FAILED: ${weightResult.status} (${weightResult.reason})`);
      process.exitCode = 1;
      return;
    }
    if (!subtotalResult.ok) {
      console.error(`\nSubtotal calculation FAILED: ${subtotalResult.status} (${subtotalResult.reason})`);
      process.exitCode = 1;
      return;
    }
    kilos = weightResult.totalWeightKg;
    totalBoleta = subtotalResult.totalBoleta;
  } else {
    kilos = Number(kilosArg ?? "0");
    totalBoleta = Number(totalBoletaArg ?? "0");
  }

  console.log(`\nComputed: totalWeightKg=${kilos} total_boleta=${totalBoleta}`);
  console.log(`\nCarrier request: destino=${resolution.canonicalName} alto=1 ancho=1 largo=1 kilos=${kilos} total_boleta=${totalBoleta}`);

  const quote = await carrierService.quoteAll({ destination: resolution.canonicalName, totalWeightKg: kilos, totalBoleta });
  printQuote("single run", resolution.canonicalName, kilos, totalBoleta, quote);
}

main().catch((error) => {
  console.error("Smoke test crashed unexpectedly:", error);
  process.exitCode = 1;
});
