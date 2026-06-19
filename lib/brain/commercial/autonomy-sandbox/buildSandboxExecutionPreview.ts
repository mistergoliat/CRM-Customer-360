import type {
  SandboxAutonomyEvaluationInput,
  SandboxAutonomyExecutionPreview,
  SandboxAutonomyValidationResult
} from "./types";

export function buildSandboxExecutionPreview(
  input: Pick<SandboxAutonomyEvaluationInput, "action">,
  validation: Pick<SandboxAutonomyValidationResult, "recipientMasked" | "messagePreview">
): SandboxAutonomyExecutionPreview {
  return {
    canExecute: false,
    channel: input.action.channel,
    recipientMasked: validation.recipientMasked,
    messagePreview: validation.messagePreview,
    idempotencyKey: input.action.idempotencyKey
  };
}
