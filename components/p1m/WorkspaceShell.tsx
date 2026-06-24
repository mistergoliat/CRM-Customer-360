import type { ReactNode } from "react";
import clsx from "clsx";

type WorkspaceShellProps = {
  sidebar: ReactNode;
  main: ReactNode;
  rail: ReactNode;
  className?: string;
};

export function WorkspaceShell({ sidebar, main, rail, className }: WorkspaceShellProps) {
  return (
    <div className={clsx("grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)_360px] xl:items-start", className)}>
      <aside className="min-h-0 xl:sticky xl:top-24 xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto">{sidebar}</aside>
      <div className="min-h-0">{main}</div>
      <aside className="min-h-0 xl:sticky xl:top-24 xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto">{rail}</aside>
    </div>
  );
}
