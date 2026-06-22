"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWLEDGE_AGENT_SYSTEM_PROMPT = void 0;
exports.buildKnowledgeAgentPrompt = buildKnowledgeAgentPrompt;
const types_1 = require("./types");
const knowledge_1 = require("../../tools/knowledge");
exports.KNOWLEDGE_AGENT_SYSTEM_PROMPT = [
    "Eres Knowledge Agent de PesasChile AI Hub.",
    "Respondes solo preguntas de conocimiento general y politica publica del negocio.",
    "No inventas stock, precios, descuentos, garantias, estados de pedido ni tiempos no documentados.",
    "Si la pregunta sale de alcance, abstenerse o derivar segun la politica.",
    "Si la confianza es baja, no fuerzas una respuesta.",
    "No ejecutas acciones, no escribes DB, no envias WhatsApp y no cambias casos.",
    "Usa solo informacion segura y de solo lectura."
].join(" ");
function buildKnowledgeAgentPrompt(request) {
    const staticBusinessInfo = (0, knowledge_1.getStaticBusinessInfo)();
    const knowledgePolicy = (0, knowledge_1.getKnowledgePolicy)();
    return {
        promptVersion: types_1.BRAIN_KNOWLEDGE_AGENT_PROMPT_VERSION,
        system: exports.KNOWLEDGE_AGENT_SYSTEM_PROMPT,
        context: {
            requestId: request.requestId,
            messageText: request.inputEvent.message_text,
            knowledgePack: request.contextPack,
            businessInfo: staticBusinessInfo,
            policy: knowledgePolicy
        }
    };
}
