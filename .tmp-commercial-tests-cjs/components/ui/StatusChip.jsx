"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatusChip = StatusChip;
const react_1 = __importDefault(require("react"));
const clsx_1 = __importDefault(require("clsx"));
const status_1 = require("@/lib/status");
void react_1.default;
const toneClasses = {
    red: "bg-red-50 text-red-700 ring-red-200",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    blue: "bg-sky-50 text-sky-700 ring-sky-200",
    gray: "bg-slate-100 text-slate-700 ring-slate-200",
    slate: "bg-slate-800 text-white ring-slate-700"
};
function StatusChip({ label, tone, className }) {
    const resolvedTone = tone ?? (0, status_1.toneForStatus)(label);
    return (<span className={(0, clsx_1.default)("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase leading-4 ring-1 ring-inset", toneClasses[resolvedTone], className)}>
      {label}
    </span>);
}
