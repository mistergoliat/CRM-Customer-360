import { auditLog } from "@/lib/audit";
import {
  SalesAgentConfigurationConflictError,
  SalesAgentConfigurationIntegrityError,
  SalesAgentConfigurationLockTimeoutError,
  SalesAgentConfigurationNotDraftError,
  SalesAgentConfigurationNotFoundError,
  SalesAgentConfigurationScopeMismatchError
} from "@/lib/brain/commercial/sales-agent-configuration";

/**
 * ACS-R1-05.1-T02.3C. Maps a thrown domain error (or anything unexpected)
 * to an HTTP response, per the audit's error table. Never surfaces a raw
 * Error.message from an unexpected/integrity failure to the client -
 * those are logged via auditLog (mirrors every other route's
 * `api_error` catch block) and answered with a generic message.
 * Validation errors (SalesAgentConfigurationInvalidError) are handled by
 * each route directly instead, since routes pre-validate the body to get
 * the structured {code, field, reason} detail the raw error string loses.
 */
export async function mapDomainErrorToResponse(error: unknown, entityId?: number | string | null): Promise<Response> {
  if (error instanceof SalesAgentConfigurationNotFoundError) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (error instanceof SalesAgentConfigurationNotDraftError) {
    return Response.json({ error: "not_draft" }, { status: 409 });
  }
  if (error instanceof SalesAgentConfigurationConflictError) {
    return Response.json({ error: "concurrent_edit_conflict" }, { status: 409 });
  }
  if (error instanceof SalesAgentConfigurationLockTimeoutError) {
    return Response.json({ error: "configuration_lock_timeout" }, { status: 503 });
  }

  // ScopeMismatch should never happen (scope is always the fixed server
  // constant, never client input) and IntegrityError means corrupted
  // stored data - both are unexpected-path bugs, not client errors.
  await auditLog({
    action: "api_error",
    entityType: "sales_agent_configuration",
    entityId: entityId ?? null,
    after: { error: error instanceof Error ? error.message : String(error) }
  });

  if (error instanceof SalesAgentConfigurationScopeMismatchError || error instanceof SalesAgentConfigurationIntegrityError) {
    return Response.json({ error: "internal_error" }, { status: 500 });
  }

  return Response.json({ error: "internal_error" }, { status: 500 });
}
