import type { ToolSurface } from "../r3TrueAB/toolSurface";
import { buildReplicationSurface } from "../r3ConfirmationBoundary/surfaces";

/**
 * SALES-AGENT-R3-P7.12 (section 5). S1 is FIXED for this phase and is NOT recreated: it is P7.11's
 * R1 (itself P7.10's S1, imported unchanged), so P7.12 S1 === P7.11 R1 === P7.10 S1 by construction
 * (same function call chain) - test-verified.
 */
export function buildSoakSurface(): ToolSurface {
  return buildReplicationSurface("R1_CONSEQUENCE_STATEMENT");
}
