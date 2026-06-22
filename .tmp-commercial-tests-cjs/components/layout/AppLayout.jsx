"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppLayout = AppLayout;
const navigation_1 = require("next/navigation");
const Sidebar_1 = require("./Sidebar");
const Topbar_1 = require("./Topbar");
function AppLayout({ children }) {
    const pathname = (0, navigation_1.usePathname)();
    return (<div className="min-h-screen bg-hub-canvas">
      <Sidebar_1.Sidebar />
      <div className="lg:pl-sidebar-width">
        <Topbar_1.Topbar pathname={pathname}/>
        <main className="px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>);
}
