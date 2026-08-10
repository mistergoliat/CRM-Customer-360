import type { ShippingCoverageProvider, ShippingRateProvider } from "./ports";
import type { CarrierOption, ShippingCalculationInput, ShippingCalculationResult } from "./types";
import { validateAndSumWeightKg } from "./weight";

export type CalculateShippingDeps = {
  coverageProvider: ShippingCoverageProvider;
  /** Absent means every rate is reported "unavailable, rate_source_unconfirmed" - see ports.ts. */
  rateProvider?: ShippingRateProvider;
};

/**
 * Pure orchestration: validates input, sums weight, resolves carrier
 * coverage, optionally resolves rate per covered carrier, and combines into
 * one typed result. Never selects a "best" carrier (CRM-R1-T13E section 18)
 * - returns every eligible option, caller/UI decides presentation.
 */
export async function calculateShipping(input: ShippingCalculationInput, deps: CalculateShippingDeps): Promise<ShippingCalculationResult> {
  if (!Number.isInteger(input.destination.communeId) || input.destination.communeId <= 0) {
    return { status: "invalid_input", reason: "invalid_destination" };
  }

  const weightResult = validateAndSumWeightKg(input.items);
  if (!weightResult.ok) {
    return { status: weightResult.status, reason: weightResult.reason } as ShippingCalculationResult;
  }

  const coverageResult = await deps.coverageProvider.getCoverageForCommune(input.destination.communeId);
  if (!coverageResult.ok) {
    return coverageResult.reason === "configuration_unavailable"
      ? { status: "configuration_unavailable", reason: coverageResult.reason, detail: coverageResult.detail }
      : { status: "technical_error", reason: coverageResult.reason, detail: coverageResult.detail };
  }

  const eligibleCarriers = coverageResult.carriers.filter((carrier) => carrier.enabled);

  const options: CarrierOption[] = [];
  for (const carrier of eligibleCarriers) {
    let rateStatus: CarrierOption["rateStatus"] = "unavailable";
    let rate: CarrierOption["rate"] = null;
    let rateUnavailableReason: string | null = "rate_source_unconfirmed";

    if (deps.rateProvider && carrier.coverage === "covered") {
      const rateResult = await deps.rateProvider.getRate(carrier.carrierId, {
        totalWeightKg: weightResult.totalWeightKg,
        communeId: input.destination.communeId
      });
      if (rateResult.ok) {
        rateStatus = "available";
        rate = rateResult.rate;
        rateUnavailableReason = null;
      } else {
        rateUnavailableReason = rateResult.reason;
      }
    }

    options.push({
      carrierId: carrier.carrierId,
      carrierKey: carrier.carrierKey,
      carrierName: carrier.carrierName,
      coverage: carrier.coverage,
      rateStatus,
      rate,
      rateUnavailableReason
    });
  }

  const coveredOptions = options.filter((option) => option.coverage === "covered");
  const status = coveredOptions.length === 0 ? "not_covered" : coveredOptions.every((option) => option.rateStatus === "available") ? "available" : "partial";

  return {
    status,
    destination: {
      communeId: input.destination.communeId,
      canonicalName: input.destination.canonicalName,
      destinationFactId: input.destination.destinationFactId
    },
    totalWeightKg: weightResult.totalWeightKg,
    options
  };
}
