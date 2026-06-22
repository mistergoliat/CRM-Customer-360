"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaseChatPanel = CaseChatPanel;
const react_1 = __importDefault(require("react"));
const CaseConversationPanel_1 = require("../CaseConversationPanel");
function CaseChatPanel({ caseId, row, messages, source, writeEnabled, closed }) {
    void react_1.default;
    return <CaseConversationPanel_1.CaseConversationPanel caseId={caseId} row={row} messages={messages} source={source} writeEnabled={writeEnabled} closed={closed}/>;
}
