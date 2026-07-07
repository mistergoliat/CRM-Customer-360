import { notFound } from "next/navigation";
import { getCaseDetailData } from "@/lib/case-detail";
import { isDbWriteEnabled } from "@/lib/write-access";
import { ErrorState } from "@/components/ui/ErrorState";
import { CaseConsoleHeader } from "@/components/cases/CaseConsoleHeader";
import { AiSdrCopilotPanel, CaseChatPanel, CaseContextSidebar, CaseDetailShell } from "@/components/cases/case-detail-layout";
import { SurfaceBadge } from "@/components/p1m/SurfaceBadge";

type CaseDetailProps = {
  params: Promise<{ id: string }>;
};

export default async function CaseDetailPage({ params }: CaseDetailProps) {
  const { id } = await params;
  const result = await getCaseDetailData(id);
  if (!result.ok) {
    return <ErrorState title={`Caso #${id}`} message={result.error} />;
  }
  if (!result.data) notFound();

  const { caseRow, timeline, sourceQueue, notes, commercialShadowReview, commercialOperatorPilot, commercialActionQueue } = result.data;
  const closed = ["closed", "resolved", "done"].includes(String(caseRow.status ?? "").toLowerCase());
  const writeEnabled = isDbWriteEnabled();
  const badgeKind = timeline.ok ? "real" : "preview";

  return (
    <div className="space-y-6">
      <CaseConsoleHeader caseId={id} serviceCode={caseRow.service_code} department={caseRow.department} updatedAt={caseRow.updated_at || caseRow.last_message_at} />

      <div className="flex flex-wrap items-center gap-2">
        <SurfaceBadge kind={badgeKind} />
      </div>

      <CaseDetailShell
        sidebar={
          <CaseContextSidebar
            caseId={id}
            row={caseRow}
            sourceQueue={sourceQueue}
            messageCount={timeline.ok ? timeline.rows.length : 0}
            writeEnabled={writeEnabled}
            closed={closed}
            notes={notes}
          />
        }
        main={
          timeline.ok ? (
            <CaseChatPanel caseId={id} row={caseRow} messages={timeline.rows} source={timeline.source} writeEnabled={writeEnabled} closed={closed} />
          ) : (
            <ErrorState title="Timeline fallo" message={timeline.error} />
          )
        }
        copilot={<AiSdrCopilotPanel caseId={id} pilot={commercialOperatorPilot} actionQueue={commercialActionQueue} review={commercialShadowReview} />}
      />
    </div>
  );
}
