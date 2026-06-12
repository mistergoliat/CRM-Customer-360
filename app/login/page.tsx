import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-hub-canvas p-6">
      <Suspense fallback={<div className="hub-card w-full max-w-md p-6 text-body-md text-slate-600">Cargando login...</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
