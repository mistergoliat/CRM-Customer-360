import type { CommercialDomainReadModel } from "../domain-read-model";
import type { PersistedCommercialWork } from "../work/persistenceTypes";
import { evaluateCapabilityEligibility } from "./evaluateCapabilityEligibility";
import type { CapabilityEligibilitySnapshot } from "./types";

export type CapabilityEligibilityShadowInput = {
  readonly enabled: boolean;
  readonly domainReadModel: CommercialDomainReadModel;
  readonly work?: Pick<PersistedCommercialWork, "publicId" | "version" | "objectives"> | null;
  readonly evaluatedAt: string;
  readonly record: (snapshot: CapabilityEligibilitySnapshot) => Promise<void>;
};

/** Shadow-only adapter. With the flag off it is byte-for-byte inert: no evaluator and no event callback. */
export async function runCapabilityEligibilityShadow(input: CapabilityEligibilityShadowInput): Promise<CapabilityEligibilitySnapshot | null> {
  if (!input.enabled) return null;
  const snapshot = evaluateCapabilityEligibility({ domainReadModel: input.domainReadModel, work: input.work, evaluatedAt: input.evaluatedAt });
  await input.record(snapshot);
  return snapshot;
}
