"use client";

import dynamic from "next/dynamic";
import "swagger-ui-react/swagger-ui.css";
import { PageHeader } from "@/components/ui/PageHeader";
import { OPENAPI_SPEC } from "@/lib/openapi/spec";

// swagger-ui-react touches `document`/`window` at import time - it can only
// ever run in the browser.
const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

export default function ApiDocsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="API interna"
        description="Endpoints reales de app/api/**. 'Try it out' usa la sesion de operador ya activa en este navegador."
      />
      <div className="rounded-lg border border-slate-200 bg-white p-2">
        <SwaggerUI spec={OPENAPI_SPEC} />
      </div>
    </div>
  );
}
