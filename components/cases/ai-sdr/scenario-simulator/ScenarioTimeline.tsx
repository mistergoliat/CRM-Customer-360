import { StatusChip } from "@/components/ui/StatusChip";
import type { ScenarioExecutionResult } from "@/lib/brain/commercial/scenario-simulator";

type ScenarioTimelineProps = {
  result: ScenarioExecutionResult | null;
};

export function ScenarioTimeline({ result }: ScenarioTimelineProps) {
  if (!result) return null;

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white/95 p-4 shadow-[0_24px_90px_-45px_rgba(15,23,42,0.35)]">
      <div>
        <p className="text-label-bold uppercase text-slate-500">Timeline</p>
        <h2 className="mt-1 text-headline-md text-on-surface">Pasos y transiciones</h2>
      </div>

      <ol className="mt-4 grid gap-4">
        {result.steps.map((step) => (
          <li key={step.stepId} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-label-bold uppercase text-slate-500">{step.stepId}</p>
                <h3 className="mt-1 text-headline-sm text-on-surface">{step.title}</h3>
                <p className="mt-2 text-body-sm text-slate-600">{step.inputSummary.noteCount} notas sintéticas</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusChip label={step.loopResult.status} />
                <StatusChip label={step.loopResult.finalStage} tone="slate" />
                <StatusChip label={step.loopResult.outbox.workerResult?.status ?? "no outbox"} tone="gray" />
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-2xl bg-white p-3">
                <p className="text-label-sm uppercase text-slate-500">Decision</p>
                <p className="mt-1 text-body-md text-on-surface">{step.loopResult.decision ? String((step.loopResult.decision as { decision?: unknown; type?: unknown }).decision ?? (step.loopResult.decision as { decision?: unknown; type?: unknown }).type ?? "n/a") : "n/a"}</p>
              </div>
              <div className="rounded-2xl bg-white p-3">
                <p className="text-label-sm uppercase text-slate-500">Action</p>
                <p className="mt-1 text-body-md text-on-surface">{step.loopResult.action && typeof step.loopResult.action === "object" && "actionType" in step.loopResult.action ? String((step.loopResult.action as { actionType?: unknown }).actionType ?? "n/a") : "n/a"}</p>
              </div>
              <div className="rounded-2xl bg-white p-3">
                <p className="text-label-sm uppercase text-slate-500">Follow-up</p>
                <p className="mt-1 text-body-md text-on-surface">{step.loopResult.followUp.schedulingResult?.decision ?? step.followUpReplay?.schedulingResult?.decision ?? "n/a"}</p>
              </div>
              <div className="rounded-2xl bg-white p-3">
                <p className="text-label-sm uppercase text-slate-500">Outbox</p>
                <p className="mt-1 text-body-md text-on-surface">{step.loopResult.outbox.workerResult?.status ?? "n/a"}</p>
              </div>
              <div className="rounded-2xl bg-white p-3">
                <p className="text-label-sm uppercase text-slate-500">Delivery</p>
                <p className="mt-1 text-body-md text-on-surface">{step.loopResult.reconciliation.deliveryStatus ?? "n/a"}</p>
              </div>
              <div className="rounded-2xl bg-white p-3">
                <p className="text-label-sm uppercase text-slate-500">State diff</p>
                <p className="mt-1 text-body-md text-on-surface">
                  +{step.stateDiff.actions.added.length} actions / +{step.stateDiff.outbox.added.length} outbox / +{step.stateDiff.audit.addedCount} audit
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
