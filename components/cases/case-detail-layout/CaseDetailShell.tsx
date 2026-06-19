import React from "react";
import type { ReactNode } from "react";
import clsx from "clsx";

export function CaseDetailShell({
  sidebar,
  main,
  copilot,
  className
}: {
  sidebar: ReactNode;
  main: ReactNode;
  copilot: ReactNode;
  className?: string;
}) {
  void React;

  return (
    <div className={clsx("grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_420px] xl:items-start", className)}>
      <aside className="min-h-0 xl:sticky xl:top-24 xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto">{sidebar}</aside>
      <div className="min-h-0">{main}</div>
      <aside className="min-h-0 xl:sticky xl:top-24 xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto">{copilot}</aside>
    </div>
  );
}
