"use client";

import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PLATFORM_ORIGIN_OPTIONS, platformOriginLabel, type PlatformOrigin } from "@/lib/domains/customers/platform-origin";

type Props = {
  redirectTo?: string;
};

function mapCreateError(code: string | undefined, status: number) {
  switch (code) {
    case "platform_origin_required":
      return "Selecciona un origen de cuenta.";
    case "invalid_platform_origin":
      return "Origen de cuenta inválido.";
    case "customer_email_duplicate":
      return "Ya existe un cliente con ese email.";
    case "DB_WRITE_DISABLED":
      return "Las escrituras están deshabilitadas.";
    case "master_customer_unavailable":
      return "La tabla master_customer no está disponible.";
    case "invalid_email":
      return "Email inválido.";
    case "firstname_required":
      return "Firstname es obligatorio.";
    case "lastname_required":
      return "Lastname es obligatorio.";
    default:
      return status >= 500 ? "Error de base de datos al crear el cliente." : code ?? "create_failed";
  }
}

export function CustomerCreateForm({ redirectTo }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [firstname, setFirstname] = useState("");
  const [lastname, setLastname] = useState("");
  const [email, setEmail] = useState("");
  const [platformOrigin, setPlatformOrigin] = useState<PlatformOrigin>("hub");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const response = await fetch("/api/customers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID()
      },
      body: JSON.stringify({ firstname, lastname, email, platformOrigin })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(mapCreateError(payload?.error, response.status));
      return;
    }

    const createdId = payload?.customer?.id;
    setMessage(`Cliente creado: ${payload?.customer?.firstname} ${payload?.customer?.lastname}`);
    setFirstname("");
    setLastname("");
    setEmail("");
    setPlatformOrigin("hub");

    startTransition(() => {
      router.refresh();
      if (createdId && redirectTo) {
        router.push(redirectTo.replace(":id", String(createdId)));
      }
    });
  }

  return (
    <form className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4" onSubmit={onSubmit}>
      <div>
        <p className="text-label-bold uppercase text-slate-500">Crear cliente real</p>
        <p className="mt-1 text-body-md text-slate-600">Escritura directa sobre `master_customer` con validación mínima.</p>
      </div>
      <div className="grid gap-3">
        <input className="hub-input" value={firstname} onChange={(event) => setFirstname(event.target.value)} placeholder="Firstname" required />
        <input className="hub-input" value={lastname} onChange={(event) => setLastname(event.target.value)} placeholder="Lastname" required />
        <input className="hub-input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" required />
        <label className="grid gap-1">
          <span className="text-label-sm uppercase text-slate-500">Origen de la cuenta</span>
          <select className="hub-input" value={platformOrigin} onChange={(event) => setPlatformOrigin(event.target.value as PlatformOrigin)} required>
            {PLATFORM_ORIGIN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="hub-button-primary w-full" type="submit" disabled={pending}>
        {pending ? "Creando..." : "Crear cliente"}
      </button>
      <p className="text-label-sm text-slate-500">Origen seleccionado: {platformOriginLabel(platformOrigin)}</p>
      {message ? <p className="text-body-md text-emerald-700">{message}</p> : null}
      {error ? <p className="text-body-md text-red-700">Error: {error}</p> : null}
    </form>
  );
}
