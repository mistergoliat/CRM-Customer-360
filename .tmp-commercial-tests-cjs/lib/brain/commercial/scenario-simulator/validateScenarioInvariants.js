"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateScenarioInvariants = validateScenarioInvariants;
const TERMINAL_ACTION_STATUSES = new Set(["cancelled", "expired", "executed", "failed"]);
function makeResult(invariantId, passed, severity, message, entityIds = []) {
    return { invariantId, passed, severity, message, entityIds };
}
function idsFrom(items, selector) {
    return items.map(selector).filter((value) => typeof value === "string" && value.trim().length > 0);
}
function hasDuplicates(values) {
    return new Set(values).size !== values.length;
}
function findActionSource(action) {
    const source = action.source;
    if (typeof source === "object" && source !== null && !Array.isArray(source))
        return source;
    return null;
}
function containsLeak(values, needle) {
    return values.some((value) => JSON.stringify(value).includes(needle));
}
function validateScenarioInvariants(stepResult, previousSnapshot, nextSnapshot, step) {
    const results = [];
    const actionIds = idsFrom(nextSnapshot.actions, (item) => item.actionId);
    const actionIdempotency = idsFrom(nextSnapshot.actions, (item) => {
        const source = findActionSource(item);
        return typeof source?.idempotencyKey === "string" ? source.idempotencyKey : null;
    });
    const outboxIdempotency = idsFrom(nextSnapshot.outbox, (item) => item.idempotencyKey);
    const outboxRowIds = idsFrom(nextSnapshot.outbox, (item) => String(item.rowId ?? ""));
    const deliveryOutboxIds = idsFrom(nextSnapshot.deliveryResults, (item) => String(item.outboxRowId ?? ""));
    const auditIds = idsFrom(nextSnapshot.auditEvents, (item) => item.eventId);
    results.push(makeResult("duplicate_action_id", !hasDuplicates(actionIds), "error", "No debe existir más de una acción con el mismo actionId.", actionIds));
    results.push(makeResult("duplicate_idempotency_key", !hasDuplicates(actionIdempotency), "error", "No debe existir más de una acción con la misma idempotencyKey.", actionIdempotency));
    results.push(makeResult("duplicate_outbox_idempotency_key", !hasDuplicates(outboxIdempotency), "error", "No debe existir más de un outbox con la misma idempotencyKey.", outboxIdempotency));
    const deliveredOutbox = nextSnapshot.outbox.filter((item) => item.status === "delivered");
    results.push(makeResult("executed_requires_delivery", !nextSnapshot.actions.some((item) => item.status === "executed") || nextSnapshot.deliveryResults.some((item) => item.status === "delivered"), "error", "Una acción ejecutada requiere delivery delivered.", deliveredOutbox.map((item) => String(item.rowId))));
    results.push(makeResult("delivered_requires_provider_message_id", deliveredOutbox.every((item) => Boolean(item.providerMessageId)), "error", "Un outbox delivered requiere providerMessageId.", deliveredOutbox.map((item) => String(item.rowId))));
    results.push(makeResult("failed_requires_dead_letter", !nextSnapshot.actions.some((item) => item.status === "failed") ||
        nextSnapshot.outbox.some((item) => item.status === "dead_letter" || item.status === "failed") ||
        nextSnapshot.deliveryResults.some((item) => item.status === "dead_letter" || item.status === "failed"), "error", "Una acción failed requiere una entrega dead-letter o fallida.", idsFrom(nextSnapshot.actions.filter((item) => item.status === "failed"), (item) => item.actionId)));
    results.push(makeResult("no_orphan_outbox", nextSnapshot.outbox.every((item) => nextSnapshot.actions.some((action) => action.actionId === item.actionId)), "error", "No debe haber outbox huérfano.", outboxRowIds));
    results.push(makeResult("no_delivery_without_outbox", nextSnapshot.deliveryResults.every((item) => item.outboxRowId === null || outboxRowIds.includes(String(item.outboxRowId))), "error", "No debe existir delivery sin outbox.", deliveryOutboxIds));
    const replacementActions = nextSnapshot.actions.filter((item) => {
        const source = findActionSource(item);
        return Boolean(source?.parentActionId || source?.supersededByActionId);
    });
    results.push(makeResult("replacement_has_parent", replacementActions.every((item) => {
        const source = findActionSource(item);
        const parentActionId = typeof source?.parentActionId === "string" ? source.parentActionId : null;
        const supersededByActionId = typeof source?.supersededByActionId === "string" ? source.supersededByActionId : null;
        if (!parentActionId)
            return false;
        const parentExists = nextSnapshot.actions.some((action) => action.actionId === parentActionId);
        const supersededExists = supersededByActionId ? nextSnapshot.actions.some((action) => action.actionId === supersededByActionId) : true;
        return parentExists && supersededExists;
    }), "error", "Toda replacement action debe tener parent y supersededBy válidos.", idsFrom(replacementActions, (item) => item.actionId)));
    results.push(makeResult("terminal_action_immutable", nextSnapshot.actions.every((item) => {
        const source = findActionSource(item);
        const sourceStatus = typeof source?.status === "string" ? source.status : null;
        return !sourceStatus || !TERMINAL_ACTION_STATUSES.has(sourceStatus) || item.status === sourceStatus;
    }), "error", "Una acción terminal no puede reactivarse.", idsFrom(nextSnapshot.actions, (item) => item.actionId)));
    results.push(makeResult("retry_does_not_duplicate_outbox", !hasDuplicates(outboxRowIds), "error", "Retry no debe crear una segunda fila outbox.", outboxRowIds));
    results.push(makeResult("same_inbound_no_second_executable_decision", !hasDuplicates(nextSnapshot.processedCorrelationIds), "error", "El mismo inbound no debe producir una segunda decisión ejecutable.", nextSnapshot.processedCorrelationIds));
    results.push(makeResult("audit_order_stable", nextSnapshot.auditEvents.every((event, index, array) => index === 0 || String(array[index - 1].createdAt) <= String(event.createdAt)), "warning", "El orden de auditoría debe ser estable.", auditIds));
    results.push(makeResult("audit_ids_unique", !hasDuplicates(auditIds), "error", "Los IDs de auditoría deben ser únicos.", auditIds));
    results.push(makeResult("real_side_effects_false", stepResult.loopResult.sideEffects.realDatabaseWritten === false &&
        stepResult.loopResult.sideEffects.realOutboxWritten === false &&
        stepResult.loopResult.sideEffects.realMessageSent === false &&
        stepResult.loopResult.sideEffects.metaCalled === false &&
        stepResult.loopResult.sideEffects.schedulerTriggered === false, "error", "Los efectos reales siempre deben ser false.", []));
    const auditText = JSON.stringify(nextSnapshot.auditEvents);
    results.push(makeResult("phone_not_exposed", !auditText.includes(String(step.input.inbound.waId)), "error", "El teléfono completo no debe aparecer en auditoría.", [step.input.inbound.waId]));
    results.push(makeResult("message_not_exposed", !auditText.includes(String(step.input.inbound.text)), "error", "El texto completo no debe aparecer en auditoría.", []));
    results.push(makeResult("token_not_exposed", !containsLeak([stepResult.inputSummary, stepResult.loopResult.auditTrail, nextSnapshot.auditEvents], "Bearer") &&
        !containsLeak([stepResult.inputSummary, stepResult.loopResult.auditTrail, nextSnapshot.auditEvents], "secret") &&
        !containsLeak([stepResult.inputSummary, stepResult.loopResult.auditTrail, nextSnapshot.auditEvents], "password"), "error", "No deben exponerse tokens o secretos.", []));
    void previousSnapshot;
    return results;
}
