"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = LoginPage;
const react_1 = require("react");
const LoginForm_1 = require("@/components/LoginForm");
function LoginPage() {
    return (<main className="flex min-h-screen items-center justify-center bg-hub-canvas p-6">
      <react_1.Suspense fallback={<div className="hub-card w-full max-w-md p-6 text-body-md text-slate-600">Cargando login...</div>}>
        <LoginForm_1.LoginForm />
      </react_1.Suspense>
    </main>);
}
