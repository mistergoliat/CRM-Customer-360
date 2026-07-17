import type { PoolConnection } from "mysql2/promise";
import type { CommercialEventPersistResult } from "./types";
import {
  normalizeAutonomousTurnContinuityFailedCommercialEvent,
  normalizeAutonomousTurnDispositionCommercialEvent,
  normalizeCustomerIdentityCapabilityOutcomeCommercialEvent,
  normalizeCustomerIdentityResolutionCommercialEvent,
  normalizeCustomerOnboardingTransitionCommercialEvent,
  normalizeCustomerSessionWarningCommercialEvent,
  normalizeFollowUpDueCommercialEvent,
  normalizeInternalCommandCommercialEvent,
  normalizeMetaWhatsAppInboundCommercialEvent,
  normalizeMetaWhatsAppStatusCommercialEvent
} from "./normalize";
import { recordCommercialEvent } from "./repository";

export async function recordMetaWhatsAppInboundCommercialEvent(
  input: Parameters<typeof normalizeMetaWhatsAppInboundCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeMetaWhatsAppInboundCommercialEvent(input), connection);
}

export async function recordMetaWhatsAppStatusCommercialEvent(
  input: Parameters<typeof normalizeMetaWhatsAppStatusCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeMetaWhatsAppStatusCommercialEvent(input), connection);
}

export async function recordFollowUpDueCommercialEvent(
  input: Parameters<typeof normalizeFollowUpDueCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeFollowUpDueCommercialEvent(input), connection);
}

export async function recordInternalCommandCommercialEvent(
  input: Parameters<typeof normalizeInternalCommandCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeInternalCommandCommercialEvent(input), connection);
}

// ACS-R1-04-T07.

export async function recordCustomerIdentityResolutionCommercialEvent(
  input: Parameters<typeof normalizeCustomerIdentityResolutionCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeCustomerIdentityResolutionCommercialEvent(input), connection);
}

export async function recordCustomerOnboardingTransitionCommercialEvent(
  input: Parameters<typeof normalizeCustomerOnboardingTransitionCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeCustomerOnboardingTransitionCommercialEvent(input), connection);
}

export async function recordCustomerIdentityCapabilityOutcomeCommercialEvent(
  input: Parameters<typeof normalizeCustomerIdentityCapabilityOutcomeCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeCustomerIdentityCapabilityOutcomeCommercialEvent(input), connection);
}

export async function recordCustomerSessionWarningCommercialEvent(
  input: Parameters<typeof normalizeCustomerSessionWarningCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeCustomerSessionWarningCommercialEvent(input), connection);
}

// ACS-R1-05-T06.2.

export async function recordAutonomousTurnDispositionCommercialEvent(
  input: Parameters<typeof normalizeAutonomousTurnDispositionCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeAutonomousTurnDispositionCommercialEvent(input), connection);
}

export async function recordAutonomousTurnContinuityFailedCommercialEvent(
  input: Parameters<typeof normalizeAutonomousTurnContinuityFailedCommercialEvent>[0],
  connection?: PoolConnection
): Promise<CommercialEventPersistResult> {
  return recordCommercialEvent(normalizeAutonomousTurnContinuityFailedCommercialEvent(input), connection);
}
