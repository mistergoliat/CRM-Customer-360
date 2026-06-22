"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaseContextSidebar = CaseContextSidebar;
const react_1 = __importDefault(require("react"));
const CaseActionsPanel_1 = require("../CaseActionsPanel");
const CaseLegacyCompatibilityNotes_1 = require("../CaseLegacyCompatibilityNotes");
const CaseOperationalSidebar_1 = require("../CaseOperationalSidebar");
const CaseTechnicalPanel_1 = require("../CaseTechnicalPanel");
function CaseContextSidebar({ caseId, row, sourceQueue, messageCount, writeEnabled, closed, notes }) {
    void react_1.default;
    return (<div className="space-y-5">
      <CaseOperationalSidebar_1.CaseOperationalSidebar row={row} sourceQueue={sourceQueue} messageCount={messageCount}/>
      <CaseActionsPanel_1.CaseActionsPanel caseId={caseId} closed={closed} writeEnabled={writeEnabled}/>
      <CaseTechnicalPanel_1.CaseTechnicalPanel row={row} sourceQueue={sourceQueue}/>
      <CaseLegacyCompatibilityNotes_1.CaseLegacyCompatibilityNotes notes={notes}/>
    </div>);
}
