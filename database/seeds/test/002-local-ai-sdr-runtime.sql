INSERT INTO conversation (
  public_id,
  channel,
  provider,
  channel_account_id,
  external_contact_id,
  customer_id,
  status,
  owner_type,
  owner_id,
  ai_enabled,
  last_message_at,
  last_inbound_at,
  last_outbound_at,
  created_at,
  updated_at
)
VALUES
  (
    'test-sim-email-requested',
    'whatsapp',
    'local_ai_sdr',
    'local_whatsapp',
    '56900000011',
    NULL,
    'open',
    'ai_sdr',
    'local_ai_sdr',
    1,
    '2026-06-24 10:05:00',
    '2026-06-24 10:00:00',
    NULL,
    '2026-06-24 10:00:00',
    '2026-06-24 10:05:00'
  )
ON DUPLICATE KEY UPDATE
  channel = VALUES(channel),
  provider = VALUES(provider),
  channel_account_id = VALUES(channel_account_id),
  external_contact_id = VALUES(external_contact_id),
  customer_id = VALUES(customer_id),
  status = VALUES(status),
  owner_type = VALUES(owner_type),
  owner_id = VALUES(owner_id),
  ai_enabled = VALUES(ai_enabled),
  last_message_at = VALUES(last_message_at),
  last_inbound_at = VALUES(last_inbound_at),
  last_outbound_at = VALUES(last_outbound_at),
  updated_at = VALUES(updated_at);

INSERT INTO conversation_message (
  public_id,
  conversation_id,
  provider,
  provider_message_id,
  direction,
  sender_type,
  message_type,
  body,
  status,
  provider_timestamp,
  created_at,
  updated_at
)
SELECT
  'test-sim-email-requested-msg-1',
  c.id,
  'local_ai_sdr',
  'test-sim-email-requested-msg-1',
  'inbound',
  'customer',
  'text',
  'Hola, necesito ayuda con mi cuenta.',
  'received',
  '2026-06-24 10:00:00',
  '2026-06-24 10:00:00',
  '2026-06-24 10:00:00'
FROM conversation c
WHERE c.public_id = 'test-sim-email-requested'
LIMIT 1
ON DUPLICATE KEY UPDATE
  body = VALUES(body),
  status = VALUES(status),
  provider_timestamp = VALUES(provider_timestamp),
  updated_at = VALUES(updated_at);

INSERT INTO ai_conversation_state (
  conversation_id,
  agent_type,
  state,
  pending_action,
  state_data_json,
  version,
  created_at,
  updated_at
)
SELECT
  c.id,
  'local_ai_sdr',
  'email_requested',
  'lookup_customer',
  JSON_OBJECT(
    'email', NULL,
    'firstname', NULL,
    'lastname', NULL,
    'customerId', NULL,
    'customerEmail', NULL,
    'customerName', NULL,
    'customerPlatformOrigin', NULL,
    'linkStatus', NULL,
    'lastDecisionId', 'test-seed-decision',
    'lastToolName', NULL,
    'lastToolStatus', NULL,
    'lastToolResult', JSON_OBJECT(),
    'lastResponseText', 'Para continuar necesito el correo asociado a tu cuenta.',
    'reason', 'Email is required to continue.',
    'confidence', 0.5,
    'warnings', JSON_ARRAY(),
    'context', JSON_OBJECT('scenario', 'test_email_requested')
  ),
  1,
  '2026-06-24 10:05:00',
  '2026-06-24 10:05:00'
FROM conversation c
WHERE c.public_id = 'test-sim-email-requested'
LIMIT 1
ON DUPLICATE KEY UPDATE
  state = VALUES(state),
  pending_action = VALUES(pending_action),
  state_data_json = VALUES(state_data_json),
  updated_at = VALUES(updated_at);
