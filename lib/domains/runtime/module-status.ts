import type { ModuleDataMode, ModuleName } from "./data-source-status";

export type ModuleRuntimeStatus = {
  module: string;
  mode: ModuleDataMode;
  available: boolean;
  source: string;
  warnings: string[];
  checkedAt: string;
};

export function createModuleRuntimeStatus(input: {
  module: ModuleName | string;
  mode: ModuleDataMode;
  available: boolean;
  source: string;
  warnings?: string[];
  checkedAt?: string;
}): ModuleRuntimeStatus {
  return {
    module: input.module,
    mode: input.mode,
    available: input.available,
    source: input.source,
    warnings: input.warnings ?? [],
    checkedAt: input.checkedAt ?? new Date().toISOString()
  };
}
