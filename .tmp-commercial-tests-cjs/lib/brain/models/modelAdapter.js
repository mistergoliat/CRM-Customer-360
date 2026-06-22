"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBrainModelAdapter = runBrainModelAdapter;
const knowledge_1 = require("../agents/knowledge");
function mapKnowledgeDecisionToGenericDecision(decision) {
    if (decision === "answer")
        return "reply";
    if (decision === "abstain")
        return "no_action";
    if (decision === "handoff_recommended")
        return "handoff";
    if (decision === "route_to_sales" || decision === "route_to_sac" || decision === "route_to_postventa")
        return "handoff";
    return "blocked";
}
function buildGenericBlockedOutput(request, reason, safetyFlags) {
    return {
        outputSchema: "brain.agent.output.v1",
        agentName: request.agentName,
        agentVersion: request.agentVersion,
        decision: "blocked",
        message: reason,
        toolRequests: [],
        confidence: 0,
        safetyFlags
    };
}
function buildGenericOutputFromKnowledge(request, draft) {
    return {
        outputSchema: "brain.agent.output.v1",
        agentName: request.agentName,
        agentVersion: request.agentVersion,
        decision: mapKnowledgeDecisionToGenericDecision(draft.decision),
        message: draft.message,
        toolRequests: draft.tool_requests,
        confidence: draft.confidence,
        safetyFlags: draft.safety_flags
    };
}
async function runBrainModelAdapter(request) {
    if (request.agentName === "knowledge") {
        const draft = await (0, knowledge_1.runKnowledgeAgent)({
            requestId: undefined,
            inputEvent: {
                channel: request.inputEvent.channel,
                source: request.inputEvent.source,
                wa_id: request.inputEvent.wa_id,
                phone_number_id: request.inputEvent.phone_number_id,
                message_id: request.inputEvent.message_id,
                message_text: request.inputEvent.message_text,
                conversation_case_id: request.inputEvent.conversation_case_id,
                id_order: request.inputEvent.id_order,
                id_customer: request.inputEvent.id_customer,
                invoice_number: request.inputEvent.invoice_number,
                source_workflow: request.inputEvent.source_workflow,
                source_node: request.inputEvent.source_node,
                received_at: request.inputEvent.received_at,
                dry_run: request.options.dryRun
            },
            context: request.context,
            contextPack: request.contextPacks.knowledge ?? null,
            actionPolicy: request.actionPolicy,
            options: {
                dryRun: request.options.dryRun,
                executeActions: request.options.executeActions,
                debug: request.options.debug
            }
        }, Date.now());
        const output = draft.ok
            ? buildGenericOutputFromKnowledge(request, draft)
            : buildGenericBlockedOutput(request, draft.message, draft.safety_flags);
        const modelName = draft.metadata.modelName === "real" ? "real" : draft.metadata.modelName === "mock" ? "mock" : "disabled";
        return {
            ok: draft.ok,
            modelName,
            modelVersion: draft.metadata.modelVersion,
            output,
            draft,
            warnings: draft.warnings,
            safetyFlags: draft.safety_flags
        };
    }
    const output = buildGenericBlockedOutput(request, `Agent ${request.agentName} is not enabled in the model adapter.`, ["agent_disabled"]);
    return {
        ok: false,
        modelName: "disabled",
        modelVersion: "brain.model.disabled.v1",
        output,
        warnings: ["Non-knowledge agents remain disabled."],
        safetyFlags: ["agent_disabled"]
    };
}
