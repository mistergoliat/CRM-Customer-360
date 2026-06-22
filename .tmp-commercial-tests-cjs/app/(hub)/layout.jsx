"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamic = void 0;
exports.default = HubLayout;
const AppLayout_1 = require("@/components/layout/AppLayout");
exports.dynamic = "force-dynamic";
function HubLayout({ children }) {
    return <AppLayout_1.AppLayout>{children}</AppLayout_1.AppLayout>;
}
