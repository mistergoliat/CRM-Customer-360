"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = CaseDetailPage;
const navigation_1 = require("next/navigation");
const case_detail_1 = require("@/lib/case-detail");
const write_access_1 = require("@/lib/write-access");
const ErrorState_1 = require("@/components/ui/ErrorState");
const CaseConsoleHeader_1 = require("@/components/cases/CaseConsoleHeader");
const case_detail_layout_1 = require("@/components/cases/case-detail-layout");
async function CaseDetailPage({ params }) {
    const { id } = await params;
    const result = await (0, case_detail_1.getCaseDetailData)(id);
    if (!result.ok) {
        return <ErrorState_1.ErrorState title={`Caso #${id}`} message={result.error}/>;
    }
    if (!result.data)
        (0, navigation_1.notFound)();
    const { caseRow, timeline, sourceQueue, notes, commercialShadowReview, commercialOperatorPilot, commercialActionQueue } = result.data;
    const closed = ["closed", "resolved", "done"].includes(String(caseRow.status ?? "").toLowerCase());
    const writeEnabled = (0, write_access_1.isDbWriteEnabled)();
    return (<div className="space-y-6">
      <CaseConsoleHeader_1.CaseConsoleHeader caseId={id} serviceCode={caseRow.service_code} department={caseRow.department} updatedAt={caseRow.updated_at || caseRow.last_message_at}/>

      <case_detail_layout_1.CaseDetailShell sidebar={<case_detail_layout_1.CaseContextSidebar caseId={id} row={caseRow} sourceQueue={sourceQueue} messageCount={timeline.ok ? timeline.rows.length : 0} writeEnabled={writeEnabled} closed={closed} notes={notes}/>} main={timeline.ok ? (<case_detail_layout_1.CaseChatPanel caseId={id} row={caseRow} messages={timeline.rows} source={timeline.source} writeEnabled={writeEnabled} closed={closed}/>) : (<ErrorState_1.ErrorState title="Timeline fallo" message={timeline.error}/>)} copilot={<case_detail_layout_1.AiSdrCopilotPanel caseId={id} pilot={commercialOperatorPilot} actionQueue={commercialActionQueue} review={commercialShadowReview}/>}/>
    </div>);
}
