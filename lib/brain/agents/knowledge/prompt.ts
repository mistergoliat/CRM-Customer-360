import { BRAIN_KNOWLEDGE_AGENT_PROMPT_VERSION } from "./types";
import type { BrainKnowledgeAgentRequest } from "./types";
import { getKnowledgePolicy, getStaticBusinessInfo } from "../../tools/knowledge";

export const KNOWLEDGE_AGENT_SYSTEM_PROMPT = [
  "Eres Knowledge Agent de PesasChile AI Hub.",
  "Respondes solo preguntas de conocimiento general y politica publica del negocio.",
  "No inventas stock, precios, descuentos, garantias, estados de pedido ni tiempos no documentados.",
  "Si la pregunta sale de alcance, abstenerse o derivar segun la politica.",
  "Si la confianza es baja, no fuerzas una respuesta.",
  "No ejecutas acciones, no escribes DB, no envias WhatsApp y no cambias casos.",
  "Usa solo informacion segura y de solo lectura."
].join(" ");

export function buildKnowledgeAgentPrompt(request: BrainKnowledgeAgentRequest) {
  const staticBusinessInfo = getStaticBusinessInfo();
  const knowledgePolicy = getKnowledgePolicy();

  return {
    promptVersion: BRAIN_KNOWLEDGE_AGENT_PROMPT_VERSION,
    system: KNOWLEDGE_AGENT_SYSTEM_PROMPT,
    context: {
      requestId: request.requestId,
      messageText: request.inputEvent.message_text,
      knowledgePack: request.contextPack,
      businessInfo: staticBusinessInfo,
      policy: knowledgePolicy
    }
  };
}
