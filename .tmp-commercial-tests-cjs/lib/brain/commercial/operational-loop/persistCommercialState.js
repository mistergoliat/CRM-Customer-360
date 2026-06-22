"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.persistCommercialState = persistCommercialState;
const db_1 = require("../../../db");
const adapters_1 = require("../context/adapters");
function toIsoString(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
function stringifyJson(value) {
    const sanitized = (0, adapters_1.sanitizeCommercialObject)({ value });
    return JSON.stringify(sanitized.value?.value ?? null);
}
async function safeHasTable(connection, tableName) {
    try {
        const [rows] = await connection.execute(`SELECT 1 AS table_exists FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`, [tableName]);
        return rows.length > 0;
    }
    catch {
        return false;
    }
}
function buildOpportunityValues(state, currentTime) {
    return {
        opportunity_key: state.opportunityKey,
        customer_candidate_id: state.customerCandidateId,
        customer_master_id: state.customerMasterId,
        lead_id: state.leadId,
        conversation_case_id: state.conversationCaseId,
        wa_id: state.waId,
        channel: state.channel,
        primary_intent: state.primaryIntent,
        status: state.status,
        stage: state.stage,
        temperature: state.temperature,
        priority: state.priority,
        current_summary: state.currentSummary,
        requirements_json: stringifyJson(state.requirements),
        missing_requirements_json: stringifyJson(state.missingRequirements),
        product_interests_json: stringifyJson(state.productInterests),
        objections_json: stringifyJson(state.objections),
        signals_json: stringifyJson(state.signals),
        last_customer_message_id: state.lastCustomerMessageId,
        last_agent_decision_id: state.lastAgentDecisionId,
        waiting_for: state.waitingFor,
        next_action_type: state.nextActionType,
        next_action_due_at: state.nextActionDueAt,
        human_owner_active: state.humanOwnerActive ? 1 : 0,
        ai_blocked: state.aiBlocked ? 1 : 0,
        version: state.version,
        created_at: state.createdAt ?? currentTime,
        updated_at: currentTime,
        last_activity_at: state.lastActivityAt ?? currentTime,
        closed_at: state.closedAt
    };
}
async function persistCommercialState(input) {
    const currentTime = toIsoString(input.currentTime);
    const featureEnabled = input.featureFlags.commercialStatePersistenceEnabled;
    if (!featureEnabled) {
        return {
            status: "skipped",
            opportunityWritten: false,
            decisionWritten: false,
            opportunityId: input.resultingState.opportunityId ?? null,
            opportunityKey: input.resultingState.opportunityKey,
            decisionId: input.decisionRecord.decisionId,
            version: input.resultingState.version,
            createdAt: currentTime,
            warnings: ["commercial_state_persistence_disabled"],
            reason: "Commercial state persistence is disabled."
        };
    }
    try {
        return await (0, db_1.withConnection)(async (connection) => {
            const opportunitiesTableExists = await safeHasTable(connection, "crm_opportunities");
            const decisionsTableExists = await safeHasTable(connection, "crm_agent_decisions");
            if (!opportunitiesTableExists || !decisionsTableExists) {
                return {
                    status: "failed_safe",
                    opportunityWritten: false,
                    decisionWritten: false,
                    opportunityId: input.resultingState.opportunityId ?? null,
                    opportunityKey: input.resultingState.opportunityKey,
                    decisionId: input.decisionRecord.decisionId,
                    version: null,
                    createdAt: currentTime,
                    warnings: ["commercial_state_persistence_failed"],
                    reason: "Commercial persistence tables are not available."
                };
            }
            await connection.beginTransaction();
            try {
                const [existingDecisionRows] = await connection.execute(`SELECT id, opportunity_id FROM crm_agent_decisions WHERE decision_id = ? LIMIT 1`, [input.decisionRecord.decisionId]);
                const existingDecision = existingDecisionRows[0];
                if (existingDecision) {
                    await connection.rollback();
                    return {
                        status: "duplicate",
                        opportunityWritten: false,
                        decisionWritten: false,
                        opportunityId: existingDecision.opportunity_id ?? input.resultingState.opportunityId ?? null,
                        opportunityKey: input.resultingState.opportunityKey,
                        decisionId: input.decisionRecord.decisionId,
                        version: input.previousState?.version ?? input.resultingState.version,
                        createdAt: currentTime,
                        warnings: ["commercial_state_retry_reused"],
                        reason: "Decision already exists."
                    };
                }
                const [existingOpportunityRows] = await connection.execute(`SELECT id, version, status, stage, closed_at FROM crm_opportunities WHERE opportunity_key = ? LIMIT 1`, [input.resultingState.opportunityKey]);
                const existingOpportunity = existingOpportunityRows[0];
                const expectedVersion = (input.previousState?.version ?? 0) + 1;
                const incomingVersion = input.resultingState.version;
                if (input.previousState && existingOpportunity && Number(existingOpportunity.version) !== input.previousState.version) {
                    await connection.rollback();
                    return {
                        status: "conflict",
                        opportunityWritten: false,
                        decisionWritten: false,
                        opportunityId: existingOpportunity.id ?? input.previousState.opportunityId ?? null,
                        opportunityKey: input.resultingState.opportunityKey,
                        decisionId: input.decisionRecord.decisionId,
                        version: Number(existingOpportunity.version) || null,
                        createdAt: currentTime,
                        warnings: ["commercial_state_conflict"],
                        reason: "Existing opportunity version does not match the expected optimistic version."
                    };
                }
                if (incomingVersion !== expectedVersion) {
                    await connection.rollback();
                    return {
                        status: "conflict",
                        opportunityWritten: false,
                        decisionWritten: false,
                        opportunityId: existingOpportunity?.id ?? input.previousState?.opportunityId ?? null,
                        opportunityKey: input.resultingState.opportunityKey,
                        decisionId: input.decisionRecord.decisionId,
                        version: existingOpportunity?.version ? Number(existingOpportunity.version) : null,
                        createdAt: currentTime,
                        warnings: ["commercial_state_conflict"],
                        reason: "Incoming state version does not match the expected optimistic version."
                    };
                }
                let opportunityId = existingOpportunity?.id ?? input.previousState?.opportunityId ?? null;
                const opportunityValues = buildOpportunityValues(input.resultingState, currentTime);
                if (existingOpportunity) {
                    const [updateResult] = await connection.execute(`
              UPDATE crm_opportunities
              SET
                customer_candidate_id = ?,
                customer_master_id = ?,
                lead_id = ?,
                conversation_case_id = ?,
                wa_id = ?,
                channel = ?,
                primary_intent = ?,
                status = ?,
                stage = ?,
                temperature = ?,
                priority = ?,
                current_summary = ?,
                requirements_json = ?,
                missing_requirements_json = ?,
                product_interests_json = ?,
                objections_json = ?,
                signals_json = ?,
                last_customer_message_id = ?,
                last_agent_decision_id = ?,
                waiting_for = ?,
                next_action_type = ?,
                next_action_due_at = ?,
                human_owner_active = ?,
                ai_blocked = ?,
                version = ?,
                updated_at = ?,
                last_activity_at = ?,
                closed_at = ?
              WHERE opportunity_key = ?
            `, [
                        opportunityValues.customer_candidate_id,
                        opportunityValues.customer_master_id,
                        opportunityValues.lead_id,
                        opportunityValues.conversation_case_id,
                        opportunityValues.wa_id,
                        opportunityValues.channel,
                        opportunityValues.primary_intent,
                        opportunityValues.status,
                        opportunityValues.stage,
                        opportunityValues.temperature,
                        opportunityValues.priority,
                        opportunityValues.current_summary,
                        opportunityValues.requirements_json,
                        opportunityValues.missing_requirements_json,
                        opportunityValues.product_interests_json,
                        opportunityValues.objections_json,
                        opportunityValues.signals_json,
                        opportunityValues.last_customer_message_id,
                        opportunityValues.last_agent_decision_id,
                        opportunityValues.waiting_for,
                        opportunityValues.next_action_type,
                        opportunityValues.next_action_due_at,
                        opportunityValues.human_owner_active,
                        opportunityValues.ai_blocked,
                        opportunityValues.version,
                        opportunityValues.updated_at,
                        opportunityValues.last_activity_at,
                        opportunityValues.closed_at,
                        input.resultingState.opportunityKey
                    ]);
                    if (updateResult.affectedRows === 0) {
                        await connection.rollback();
                        return {
                            status: "failed_safe",
                            opportunityWritten: false,
                            decisionWritten: false,
                            opportunityId,
                            opportunityKey: input.resultingState.opportunityKey,
                            decisionId: input.decisionRecord.decisionId,
                            version: null,
                            createdAt: currentTime,
                            warnings: ["commercial_state_persistence_failed"],
                            reason: "Opportunity update did not affect any row."
                        };
                    }
                }
                else {
                    const [insertResult] = await connection.execute(`
              INSERT INTO crm_opportunities (
                opportunity_key,
                customer_candidate_id,
                customer_master_id,
                lead_id,
                conversation_case_id,
                wa_id,
                channel,
                primary_intent,
                status,
                stage,
                temperature,
                priority,
                current_summary,
                requirements_json,
                missing_requirements_json,
                product_interests_json,
                objections_json,
                signals_json,
                last_customer_message_id,
                last_agent_decision_id,
                waiting_for,
                next_action_type,
                next_action_due_at,
                human_owner_active,
                ai_blocked,
                version,
                created_at,
                updated_at,
                last_activity_at,
                closed_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                        opportunityValues.opportunity_key,
                        opportunityValues.customer_candidate_id,
                        opportunityValues.customer_master_id,
                        opportunityValues.lead_id,
                        opportunityValues.conversation_case_id,
                        opportunityValues.wa_id,
                        opportunityValues.channel,
                        opportunityValues.primary_intent,
                        opportunityValues.status,
                        opportunityValues.stage,
                        opportunityValues.temperature,
                        opportunityValues.priority,
                        opportunityValues.current_summary,
                        opportunityValues.requirements_json,
                        opportunityValues.missing_requirements_json,
                        opportunityValues.product_interests_json,
                        opportunityValues.objections_json,
                        opportunityValues.signals_json,
                        opportunityValues.last_customer_message_id,
                        opportunityValues.last_agent_decision_id,
                        opportunityValues.waiting_for,
                        opportunityValues.next_action_type,
                        opportunityValues.next_action_due_at,
                        opportunityValues.human_owner_active,
                        opportunityValues.ai_blocked,
                        opportunityValues.version,
                        opportunityValues.created_at,
                        opportunityValues.updated_at,
                        opportunityValues.last_activity_at,
                        opportunityValues.closed_at
                    ]);
                    opportunityId = insertResult.insertId;
                }
                const decisionValues = {
                    decision_id: input.decisionRecord.decisionId,
                    opportunity_id: opportunityId,
                    correlation_id: input.decisionRecord.correlationId,
                    process_inbound_run_id: input.decisionRecord.processInboundRunId,
                    sales_agent_run_id: input.decisionRecord.salesAgentRunId,
                    message_id: input.decisionRecord.messageId,
                    previous_status: input.decisionRecord.previousStatus,
                    next_status: input.decisionRecord.nextStatus,
                    previous_stage: input.decisionRecord.previousStage,
                    next_stage: input.decisionRecord.nextStage,
                    detected_signals_json: stringifyJson(input.decisionRecord.detectedSignals),
                    state_changes_json: stringifyJson(input.decisionRecord.stateChanges),
                    missing_information_json: stringifyJson(input.decisionRecord.missingInformation),
                    next_action_json: stringifyJson(input.decisionRecord.nextAction),
                    policy_status: input.decisionRecord.policyStatus,
                    risk_level: input.decisionRecord.riskLevel,
                    approval_requirement: input.decisionRecord.approvalRequirement,
                    decision_status: input.decisionRecord.decisionStatus,
                    rationale: input.decisionRecord.rationale,
                    warnings_json: stringifyJson(input.decisionRecord.warnings),
                    contract_version: input.decisionRecord.contractVersion,
                    policy_version: input.decisionRecord.policyVersion,
                    runtime_version: input.decisionRecord.runtimeVersion,
                    created_at: currentTime
                };
                await connection.execute(`
            INSERT INTO crm_agent_decisions (
              decision_id,
              opportunity_id,
              correlation_id,
              process_inbound_run_id,
              sales_agent_run_id,
              message_id,
              previous_status,
              next_status,
              previous_stage,
              next_stage,
              detected_signals_json,
              state_changes_json,
              missing_information_json,
              next_action_json,
              policy_status,
              risk_level,
              approval_requirement,
              decision_status,
              rationale,
              warnings_json,
              contract_version,
              policy_version,
              runtime_version,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
                    decisionValues.decision_id,
                    decisionValues.opportunity_id,
                    decisionValues.correlation_id,
                    decisionValues.process_inbound_run_id,
                    decisionValues.sales_agent_run_id,
                    decisionValues.message_id,
                    decisionValues.previous_status,
                    decisionValues.next_status,
                    decisionValues.previous_stage,
                    decisionValues.next_stage,
                    decisionValues.detected_signals_json,
                    decisionValues.state_changes_json,
                    decisionValues.missing_information_json,
                    decisionValues.next_action_json,
                    decisionValues.policy_status,
                    decisionValues.risk_level,
                    decisionValues.approval_requirement,
                    decisionValues.decision_status,
                    decisionValues.rationale,
                    decisionValues.warnings_json,
                    decisionValues.contract_version,
                    decisionValues.policy_version,
                    decisionValues.runtime_version,
                    decisionValues.created_at
                ]);
                await connection.commit();
                return {
                    status: "persisted",
                    opportunityWritten: true,
                    decisionWritten: true,
                    opportunityId,
                    opportunityKey: input.resultingState.opportunityKey,
                    decisionId: input.decisionRecord.decisionId,
                    version: input.resultingState.version,
                    createdAt: currentTime,
                    warnings: [],
                    reason: null
                };
            }
            catch (error) {
                try {
                    await connection.rollback();
                }
                catch {
                    // ignore rollback issues
                }
                return {
                    status: "failed_safe",
                    opportunityWritten: false,
                    decisionWritten: false,
                    opportunityId: input.resultingState.opportunityId ?? null,
                    opportunityKey: input.resultingState.opportunityKey,
                    decisionId: input.decisionRecord.decisionId,
                    version: null,
                    createdAt: currentTime,
                    warnings: ["commercial_state_persistence_failed"],
                    reason: error instanceof Error ? error.message : String(error)
                };
            }
        });
    }
    catch (error) {
        return {
            status: "failed_safe",
            opportunityWritten: false,
            decisionWritten: false,
            opportunityId: input.resultingState.opportunityId ?? null,
            opportunityKey: input.resultingState.opportunityKey,
            decisionId: input.decisionRecord.decisionId,
            version: null,
            createdAt: currentTime,
            warnings: ["commercial_state_persistence_failed"],
            reason: error instanceof Error ? error.message : String(error)
        };
    }
}
