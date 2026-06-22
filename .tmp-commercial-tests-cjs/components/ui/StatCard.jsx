"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatCard = StatCard;
const clsx_1 = __importDefault(require("clsx"));
const Icon_1 = require("./Icon");
const stateBorder = {
    ok: "before:bg-emerald-500",
    warning: "before:bg-amber-500",
    error: "before:bg-primary-container",
    muted: "before:bg-slate-300"
};
function StatCard({ title, value, description, icon, state = "muted" }) {
    return (<div className={(0, clsx_1.default)("hub-card relative overflow-hidden p-5 before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:rounded-r-sm", stateBorder[state])}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-label-bold uppercase text-slate-500">{title}</p>
          <p className="mt-2 text-stats-lg text-on-surface">{value}</p>
        </div>
        {icon ? (<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-fixed text-primary">
            <Icon_1.Icon name={icon}/>
          </div>) : null}
      </div>
      {description ? <p className="mt-3 text-label-sm text-slate-500">{description}</p> : null}
    </div>);
}
