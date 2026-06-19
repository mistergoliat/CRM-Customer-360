import React from "react";
import { CaseInlineNote } from "../CaseDetailPrimitives";
import type { CommercialShadowReviewViewModel } from "@/lib/brain/commercial/review";

export function AiSdrEmptyState({ review }: { review: CommercialShadowReviewViewModel }) {
  void React;
  if (review.status === "disabled") {
    return <CaseInlineNote tone="warning" title="AI SDR deshabilitado" body="El shadow comercial estaba deshabilitado para esta corrida. No existe una observación inspectable." />;
  }

  if (review.status === "error") {
    return (
      <div className="grid gap-3">
        <CaseInlineNote tone="warning" title="AI SDR con error" body="La lectura comercial falló localmente. La conversación y el caso siguen disponibles." />
        {review.error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-body-md text-rose-900">
            <p className="text-label-bold uppercase">Error seguro</p>
            <p className="mt-1 break-words">{review.error.message}</p>
          </div>
        ) : null}
      </div>
    );
  }

  return <CaseInlineNote tone="info" title="No existe una observación AI SDR" body="No existe una observación comercial persistida o vinculable para este caso. Esto no es un error del caso." />;
}
