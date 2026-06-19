import React from "react";
import type { DbRow } from "@/lib/db";
import type { SourceQueueDetail, CaseCompatibilityNote } from "@/lib/case-detail";
import { CaseActionsPanel } from "../CaseActionsPanel";
import { CaseLegacyCompatibilityNotes } from "../CaseLegacyCompatibilityNotes";
import { CaseOperationalSidebar } from "../CaseOperationalSidebar";
import { CaseTechnicalPanel } from "../CaseTechnicalPanel";

export function CaseContextSidebar({
  caseId,
  row,
  sourceQueue,
  messageCount,
  writeEnabled,
  closed,
  notes
}: {
  caseId: string;
  row: DbRow;
  sourceQueue: SourceQueueDetail | null;
  messageCount: number;
  writeEnabled: boolean;
  closed: boolean;
  notes: CaseCompatibilityNote[];
}) {
  void React;

  return (
    <div className="space-y-5">
      <CaseOperationalSidebar row={row} sourceQueue={sourceQueue} messageCount={messageCount} />
      <CaseActionsPanel caseId={caseId} closed={closed} writeEnabled={writeEnabled} />
      <CaseTechnicalPanel row={row} sourceQueue={sourceQueue} />
      <CaseLegacyCompatibilityNotes notes={notes} />
    </div>
  );
}
