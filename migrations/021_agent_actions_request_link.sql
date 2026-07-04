-- 021: Link crm_agent_actions to ConversationRequests (additive).
-- crm_agent_actions remains the single durable action source (ADR-003); the
-- multi-request runtime tags deferred/scheduled actions with the request they
-- belong to, so "quede pendiente de X" is queryable per request.

ALTER TABLE crm_agent_actions
  ADD COLUMN request_id VARCHAR(191) NULL AFTER decision_row_id,
  ADD KEY idx_crm_agent_actions_request_id (request_id, status);

-- Rollback:
-- ALTER TABLE crm_agent_actions DROP KEY idx_crm_agent_actions_request_id, DROP COLUMN request_id;
