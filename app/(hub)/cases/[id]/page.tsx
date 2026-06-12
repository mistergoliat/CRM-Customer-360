import { notFound } from "next/navigation";
import { getCaseDetailData } from "@/lib/case-detail";
import { isDbWriteEnabled } from "@/lib/write-access";
import { ErrorState } from "@/components/ui/ErrorState";
import { CaseConsoleHeader } from "@/components/cases/CaseConsoleHeader";
import { CaseOperationalSidebar } from "@/components/cases/CaseOperationalSidebar";
import { CaseConversationPanel } from "@/components/cases/CaseConversationPanel";
import { CaseActionsPanel } from "@/components/cases/CaseActionsPanel";
import { CaseTechnicalPanel } from "@/components/cases/CaseTechnicalPanel";
import { CaseLegacyCompatibilityNotes } from "@/components/cases/CaseLegacyCompatibilityNotes";

type CaseDetailProps = {
  params: Promise<{ id: string }>;
};

export default async function CaseDetailPage({ params }: CaseDetailProps) {
  const { id } = await params;
  const result = await getCaseDetailData(id);
  if (!result.ok) {
    return (
      <ErrorState title={`Caso #${id}`} message={result.error} />
    );
  }
  if (!result.data) notFound();

  const { caseRow, timeline, sourceQueue, notes } = result.data;
  const closed = ["closed", "resolved", "done"].includes(String(caseRow.status ?? "").toLowerCase());
  const writeEnabled = isDbWriteEnabled();

  return (
    <div className="space-y-6">
      <CaseConsoleHeader
        caseId={id}
        serviceCode={caseRow.service_code}
        department={caseRow.department}
        updatedAt={caseRow.updated_at || caseRow.last_message_at}
      />

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-6">
          <CaseOperationalSidebar row={caseRow} sourceQueue={sourceQueue} messageCount={timeline.ok ? timeline.rows.length : 0} />
          <CaseActionsPanel caseId={id} closed={closed} writeEnabled={writeEnabled} />
          <CaseTechnicalPanel row={caseRow} sourceQueue={sourceQueue} />
          <CaseLegacyCompatibilityNotes notes={notes} />
        </div>

        <div className="space-y-6">
          {timeline.ok ? (
            <CaseConversationPanel
              caseId={id}
              row={caseRow}
              messages={timeline.rows}
              source={timeline.source}
              writeEnabled={writeEnabled}
              closed={closed}
            />
          ) : (
            <ErrorState title="Timeline fallo" message={timeline.error} />
          )}
        </div>
      </div>
    </div>
  );
}
