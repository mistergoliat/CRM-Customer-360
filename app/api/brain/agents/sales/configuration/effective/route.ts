import { requireOperator } from "@/lib/auth";
import { buildAllowedSalesAgentModelValues, resolveSalesAgentConfiguration } from "@/lib/brain/commercial/sales-agent-configuration";
import { mapDomainErrorToResponse } from "../_lib/mapDomainError";

/**
 * ACS-R1-05.1-T02.3C, decision 11: editable configuration + metadata +
 * effective params + model allowlist - never the provider endpoint, env
 * var names, API keys, or raw internal error detail.
 */
export async function GET(request: Request) {
  const auth = await requireOperator(request);
  if (!auth.ok) return auth.response;

  try {
    const resolved = await resolveSalesAgentConfiguration();
    return Response.json({
      source: resolved.source,
      recordId: resolved.recordId,
      version: resolved.version,
      configurationHash: resolved.configurationHash,
      configuration: resolved.configuration,
      effectiveModelConfiguration: resolved.effectiveModelConfiguration,
      effectiveLoopConfiguration: resolved.effectiveLoopConfiguration,
      effectiveFollowUpConfiguration: resolved.effectiveFollowUpConfiguration,
      allowedModels: buildAllowedSalesAgentModelValues()
    });
  } catch (error) {
    return mapDomainErrorToResponse(error);
  }
}
