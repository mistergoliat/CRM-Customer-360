"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRAIN_KNOWLEDGE_ANSWER_TYPES = exports.BRAIN_KNOWLEDGE_AGENT_DECISIONS = exports.BRAIN_KNOWLEDGE_AGENT_OUTPUT_SCHEMA = exports.BRAIN_KNOWLEDGE_AGENT_PROMPT_VERSION = exports.BRAIN_KNOWLEDGE_AGENT_VERSION = exports.BRAIN_KNOWLEDGE_AGENT_NAME = void 0;
exports.BRAIN_KNOWLEDGE_AGENT_NAME = "knowledge";
exports.BRAIN_KNOWLEDGE_AGENT_VERSION = "brain.agent.knowledge.v2";
exports.BRAIN_KNOWLEDGE_AGENT_PROMPT_VERSION = "brain.knowledge.prompt.v1";
exports.BRAIN_KNOWLEDGE_AGENT_OUTPUT_SCHEMA = "brain.agent.knowledge.output.v1";
exports.BRAIN_KNOWLEDGE_AGENT_DECISIONS = [
    "answer",
    "abstain",
    "handoff_recommended",
    "route_to_sales",
    "route_to_sac",
    "route_to_postventa"
];
exports.BRAIN_KNOWLEDGE_ANSWER_TYPES = [
    "business_info",
    "faq",
    "policy",
    "location",
    "payment",
    "generic",
    "none"
];
