import { safeExecute } from "@/lib/db";
import { redactErrorMessage } from "../redactErrorMessage";

/**
 * ACS-R1-05-T06.2 (release spec section A5). CAS transition of a blocked
 * `crm_agent_actions` row into the existing terminal, non-executable status
 * `blocked` (COMMERCIAL_ACTION_TERMINAL_STATUSES, action-lifecycle/constants.ts)
 * - never a new status/migration. Only rows still sitting at a pre-plan
 * status with no outbox ever attached are eligible; `planned`/`executing`/
 * `executed`/`cancelled`/`failed` are never touched by this WHERE clause, so
 * a concurrently-advanced action can never be overwritten.
 */
const CONTINUITY_TERMINALIZABLE_STATUSES = ["proposed", "requires_review", "approved"] as const;

export type TerminalizeBlockedAgentActionResult = {
  terminalized: boolean;
  error: string | null;
};

export async function terminalizeBlockedAgentAction(input: {
  actionId: string;
  failureReason: string;
  blockReasons: string[];
}): Promise<TerminalizeBlockedAgentActionResult> {
  const placeholders = CONTINUITY_TERMINALIZABLE_STATUSES.map(() => "?").join(", ");
  const result = await safeExecute(
    `UPDATE crm_agent_actions
     SET status = 'blocked', failure_reason = ?, block_reasons_json = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE action_id = ? AND status IN (${placeholders}) AND outbox_message_id IS NULL`,
    [redactErrorMessage(input.failureReason), JSON.stringify(input.blockReasons), input.actionId, ...CONTINUITY_TERMINALIZABLE_STATUSES]
  );

  if (!result.ok) return { terminalized: false, error: result.error };
  return { terminalized: result.affectedRows > 0, error: null };
}
