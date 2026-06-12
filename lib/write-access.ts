import { hasTable } from "./db";
import { DB_WRITE_DISABLED_CODE, DB_WRITE_DISABLED_MESSAGE } from "./action-policy";

export function isDbWriteEnabled() {
  return String(process.env.DB_WRITE_ENABLED || "false").toLowerCase() === "true";
}

export function dbWriteDisabledResponse(status = 409) {
  return Response.json(
    {
      code: DB_WRITE_DISABLED_CODE,
      message: DB_WRITE_DISABLED_MESSAGE
    },
    { status }
  );
}

export async function canPersistTraceability() {
  const tables = await Promise.all([
    hasTable("n8n_conversation_cases"),
    hasTable("n8n_conversation_messages"),
    hasTable("hub_audit_log")
  ]);

  return {
    ok: tables.every(Boolean),
    details: {
      n8n_conversation_cases: tables[0],
      n8n_conversation_messages: tables[1],
      hub_audit_log: tables[2]
    }
  };
}
