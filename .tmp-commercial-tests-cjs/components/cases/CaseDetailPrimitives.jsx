"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CasePanelFrame = CasePanelFrame;
exports.CaseDetailField = CaseDetailField;
exports.CaseInlineNote = CaseInlineNote;
const react_1 = __importDefault(require("react"));
const clsx_1 = __importDefault(require("clsx"));
const format_1 = require("@/lib/format");
void react_1.default;
const accentClasses = {
    red: "border-l-4 border-l-primary-container",
    slate: "border-l-4 border-l-slate-300",
    amber: "border-l-4 border-l-amber-300",
    blue: "border-l-4 border-l-sky-300"
};
function CasePanelFrame({ title, description, accent = "red", actions, children, className }) {
    return (<section className={(0, clsx_1.default)("hub-card overflow-hidden", accentClasses[accent], className)}>
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-headline-md text-on-surface">{title}</p>
            {description ? <p className="mt-1 text-body-md text-slate-500">{description}</p> : null}
          </div>
          {actions}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>);
}
function CaseDetailField({ label, value, mono = false, date = false, className }) {
    return (<div className={(0, clsx_1.default)("rounded-lg border border-slate-200 bg-white p-3", className)}>
      <p className="text-label-bold uppercase text-slate-500">{label}</p>
      <p className={(0, clsx_1.default)("mt-1 break-words text-body-md font-semibold text-on-surface", mono && "font-mono text-[13px]")}>
        {date ? (0, format_1.formatDateTime)(value) : (0, format_1.asText)(value)}
      </p>
    </div>);
}
function CaseInlineNote({ tone, title, body }) {
    const toneClass = tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700";
    return (<div className={(0, clsx_1.default)("rounded-lg border px-4 py-3", toneClass)}>
      <p className="text-label-bold uppercase">{title}</p>
      <p className="mt-1 text-body-md">{body}</p>
    </div>);
}
