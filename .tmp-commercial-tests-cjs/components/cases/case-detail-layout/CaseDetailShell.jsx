"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaseDetailShell = CaseDetailShell;
const react_1 = __importDefault(require("react"));
const clsx_1 = __importDefault(require("clsx"));
function CaseDetailShell({ sidebar, main, copilot, className }) {
    void react_1.default;
    return (<div className={(0, clsx_1.default)("grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_420px] xl:items-start", className)}>
      <aside className="min-h-0 xl:sticky xl:top-24 xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto">{sidebar}</aside>
      <div className="min-h-0">{main}</div>
      <aside className="min-h-0 xl:sticky xl:top-24 xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto">{copilot}</aside>
    </div>);
}
