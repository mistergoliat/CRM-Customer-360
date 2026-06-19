import React from "react";
import type { DbRow } from "@/lib/db";
import type { TimelineEntry } from "@/lib/cases";
import { CaseConversationPanel } from "../CaseConversationPanel";

export function CaseChatPanel({
  caseId,
  row,
  messages,
  source,
  writeEnabled,
  closed
}: {
  caseId: string;
  row: DbRow;
  messages: TimelineEntry[];
  source: string;
  writeEnabled: boolean;
  closed: boolean;
}) {
  void React;

  return <CaseConversationPanel caseId={caseId} row={row} messages={messages} source={source} writeEnabled={writeEnabled} closed={closed} />;
}
