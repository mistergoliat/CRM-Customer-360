import assert from "node:assert/strict";
import test from "node:test";
import { buildLegacySalesConsultativeFeatureFlags } from "../../lib/brain/commercial/config/commercialCycleConfig";

// ACS-R1-05.1-T01: exact fail-closed semantics of
// BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED, isolated from processInbound/
// processSalesInbound so a change in default behavior is caught at the
// single source of truth (commercialCycleConfig.ts), not only downstream.

function withEnv(value: string | undefined, run: () => void) {
  const previous = process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;
  if (typeof value === "undefined") delete process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;
  else process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED = value;
  try {
    run();
  } finally {
    if (typeof previous === "undefined") delete process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED;
    else process.env.BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED = previous;
  }
}

test("BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED undefined (absent) resolves to disabled", () => {
  withEnv(undefined, () => {
    assert.equal(buildLegacySalesConsultativeFeatureFlags().legacySalesConsultativeEnabled, false);
  });
});

test("BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED empty string resolves to disabled", () => {
  withEnv("", () => {
    assert.equal(buildLegacySalesConsultativeFeatureFlags().legacySalesConsultativeEnabled, false);
  });
});

test('BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED="false" resolves to disabled', () => {
  withEnv("false", () => {
    assert.equal(buildLegacySalesConsultativeFeatureFlags().legacySalesConsultativeEnabled, false);
  });
});

test("BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED with a value that is neither true nor false resolves to disabled", () => {
  // readEnvFlag (commercialCycleConfig.ts) trims + lowercases before
  // comparing, so only values that normalize to something other than
  // exactly "true"/"false" count as invalid here - see the case-insensitive/
  // whitespace-tolerant test below for values that DO normalize to "true".
  for (const invalidValue of ["yes", "1", "0", "enabled", "tru", "truee", "nope"]) {
    withEnv(invalidValue, () => {
      assert.equal(
        buildLegacySalesConsultativeFeatureFlags().legacySalesConsultativeEnabled,
        false,
        `expected disabled for BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED=${JSON.stringify(invalidValue)}`
      );
    });
  }
});

test('BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED="true" (exact) resolves to enabled', () => {
  withEnv("true", () => {
    assert.equal(buildLegacySalesConsultativeFeatureFlags().legacySalesConsultativeEnabled, true);
  });
});

test("BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED tolerates case and surrounding whitespace around true/false (shared readEnvFlag behavior, unchanged by this task)", () => {
  for (const trueVariant of ["TRUE", "True", " true", "true "]) {
    withEnv(trueVariant, () => {
      assert.equal(buildLegacySalesConsultativeFeatureFlags().legacySalesConsultativeEnabled, true, trueVariant);
    });
  }
  for (const falseVariant of ["FALSE", "False", " false", "false "]) {
    withEnv(falseVariant, () => {
      assert.equal(buildLegacySalesConsultativeFeatureFlags().legacySalesConsultativeEnabled, false, falseVariant);
    });
  }
});

test("explicit overrides win over the environment in both directions", () => {
  withEnv("true", () => {
    assert.equal(
      buildLegacySalesConsultativeFeatureFlags({ legacySalesConsultativeEnabled: false }).legacySalesConsultativeEnabled,
      false
    );
  });
  withEnv(undefined, () => {
    assert.equal(
      buildLegacySalesConsultativeFeatureFlags({ legacySalesConsultativeEnabled: true }).legacySalesConsultativeEnabled,
      true
    );
  });
});
