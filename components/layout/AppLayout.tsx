"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-hub-canvas">
      <Sidebar />
      <div className="lg:pl-sidebar-width">
        <Topbar pathname={pathname} />
        <main className="px-4 py-6 lg:px-8 xl:px-10">{children}</main>
      </div>
    </div>
  );
}
