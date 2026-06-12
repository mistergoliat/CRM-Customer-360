"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token })
    });
    setLoading(false);
    if (!response.ok) {
      setError("No se pudo iniciar sesión con el token entregado.");
      return;
    }
    router.push(params.get("next") || "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="hub-card w-full max-w-md overflow-hidden">
      <div className="border-l-4 border-primary-container p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-fixed text-primary">
            <Icon name="lock" />
          </div>
          <div>
            <h1 className="text-headline-lg text-on-surface">PesasChile HUB</h1>
            <p className="text-body-md text-slate-500">AI Operations</p>
          </div>
        </div>
        <label className="text-label-bold uppercase text-slate-500" htmlFor="token">
          ADMIN_BYPASS_TOKEN
        </label>
        <input
          id="token"
          className="hub-input mt-2 w-full"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoFocus
        />
        {error ? <p className="mt-3 text-body-md text-red-700">{error}</p> : null}
        <button className="hub-button-primary mt-5 w-full" disabled={loading}>
          <Icon name="login" />
          {loading ? "Validando" : "Entrar"}
        </button>
      </div>
    </form>
  );
}
