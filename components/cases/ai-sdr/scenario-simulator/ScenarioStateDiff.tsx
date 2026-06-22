import type { ScenarioExecutionResult } from "@/lib/brain/commercial/scenario-simulator";

type ScenarioStateDiffProps = {
  result: ScenarioExecutionResult | null;
};

export function ScenarioStateDiff({ result }: ScenarioStateDiffProps) {
  if (!result) return null;

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white/95 p-4 shadow-[0_24px_90px_-45px_rgba(15,23,42,0.35)]">
      <div>
        <p className="text-label-bold uppercase text-slate-500">State diff</p>
        <h2 className="mt-1 text-headline-md text-on-surface">Diferencias seguras</h2>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-label-sm uppercase text-slate-500">Actions</p>
          <p className="mt-2 text-body-md text-on-surface">Added: {result.steps.flatMap((step) => step.stateDiff.actions.added).join(", ") || "none"}</p>
          <p className="mt-1 text-body-md text-on-surface">Updated: {result.steps.flatMap((step) => step.stateDiff.actions.updated).join(", ") || "none"}</p>
          <p className="mt-1 text-body-md text-on-surface">Removed: {result.steps.flatMap((step) => step.stateDiff.actions.removed).join(", ") || "none"}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <p className="text-label-sm uppercase text-slate-500">Outbox / audit</p>
          <p className="mt-2 text-body-md text-on-surface">Outbox added: {result.steps.flatMap((step) => step.stateDiff.outbox.added.map((item) => `${item.id}:${item.status}`)).join(", ") || "none"}</p>
          <p className="mt-1 text-body-md text-on-surface">Outbox updated: {result.steps.flatMap((step) => step.stateDiff.outbox.updated.map((item) => `${item.id}:${item.fromStatus}->${item.toStatus}`)).join(", ") || "none"}</p>
          <p className="mt-1 text-body-md text-on-surface">Audit added: {result.steps.reduce((sum, step) => sum + step.stateDiff.audit.addedCount, 0)}</p>
        </div>
      </div>
    </section>
  );
}
