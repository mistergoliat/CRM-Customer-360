// SALES-AGENT-R3-A05. Public barrel for the follow-up wake boundary.

export type { FollowUpWakeDisposition, FollowUpWakeEvent, FollowUpWakeReason, FollowUpWakeSessionEventInput } from "./types";

export { recordFollowUpWake, resetFollowUpWakeSessionStoreForTests } from "./sessionEvents";

export {
  dispatchDraftedFollowUpMessage,
  FOLLOW_UP_DRAFT_MESSAGE_FALLBACK
} from "./dispatchDraftedFollowUpMessage";
export type {
  DispatchDraftedFollowUpMessageInput,
  DispatchDraftedFollowUpMessageResult
} from "./dispatchDraftedFollowUpMessage";

export { buildFollowUpWakeEvent } from "./buildFollowUpWakeEvent";
