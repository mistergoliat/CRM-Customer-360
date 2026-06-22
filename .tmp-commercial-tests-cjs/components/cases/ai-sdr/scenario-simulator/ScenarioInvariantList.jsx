"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScenarioInvariantList = ScenarioInvariantList;
const StatusChip_1 = require("@/components/ui/StatusChip");
function ScenarioInvariantList({ result }) {
    if (!result)
        return null;
    const invariants = result.steps.flatMap((step) => step.invariantResults.map((item) => ({
        stepId: step.stepId,
        title: step.title,
        ...item
    })));
    return (<section className="rounded-[28px] border border-slate-200 bg-white/95 p-4 shadow-[0_24px_90px_-45px_rgba(15,23,42,0.35)]">
      <div>
        <p className="text-label-bold uppercase text-slate-500">Invariants</p>
        <h2 className="mt-1 text-headline-md text-on-surface">Validaciones de coherencia</h2>
      </div>

      <div className="mt-4 grid gap-3">
        {invariants.map((item) => (<div key={`${item.stepId}:${item.invariantId}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-label-sm uppercase text-slate-500">{item.stepId}</p>
                <p className="mt-1 text-body-md text-on-surface">{item.message}</p>
              </div>
              <StatusChip_1.StatusChip label={item.passed ? "passed" : item.severity} tone={item.passed ? "green" : item.severity === "error" ? "red" : "amber"}/>
            </div>
            {item.entityIds.length > 0 ? <p className="mt-2 text-label-sm text-slate-500">Entities: {item.entityIds.join(", ")}</p> : null}
          </div>))}
        {invariants.length === 0 ? <p className="text-body-md text-slate-500">Sin invariantes para este run.</p> : null}
      </div>
    </section>);
}
