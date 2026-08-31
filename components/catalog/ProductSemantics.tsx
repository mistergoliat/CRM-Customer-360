import { ErrorState } from "@/components/ui/ErrorState";
import type { CatalogSemanticsBlock } from "@/lib/catalog/consoleService";
import { errorMessage } from "./catalogDisplay";

function TagList({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="mt-1 text-body-md text-slate-400">—</p>;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className="rounded-full bg-slate-100 px-2.5 py-1 text-label-sm font-semibold text-slate-700">
          {item}
        </span>
      ))}
    </div>
  );
}

export function ProductSemantics({ block }: { block: CatalogSemanticsBlock }) {
  return (
    <section className="hub-card p-5">
      <p className="text-label-bold uppercase text-primary">Semantica del producto</p>

      {block.status === "error" ? (
        <div className="mt-3">
          <ErrorState title="Semantica no disponible" message={errorMessage(block.error)} />
        </div>
      ) : null}

      {block.status === "not_available" ? (
        <p className="mt-3 text-body-md text-slate-500">Este producto aun no tiene semantica publicada en el snapshot activo.</p>
      ) : null}

      {block.status === "available" ? (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-label-bold uppercase text-slate-500">Estado</p>
              <p className="mt-1 text-body-md font-semibold text-on-surface">{block.semantics.classificationStatus}</p>
            </div>
            <div>
              <p className="text-label-bold uppercase text-slate-500">Familia principal</p>
              <p className="mt-1 text-body-md text-on-surface">{block.semantics.primaryProductFamily ?? "—"}</p>
            </div>
            <div>
              <p className="text-label-bold uppercase text-slate-500">Familias secundarias</p>
              <TagList items={block.semantics.secondaryProductFamilies} />
            </div>
            <div>
              <p className="text-label-bold uppercase text-slate-500">Disciplinas</p>
              <TagList items={block.semantics.disciplines} />
            </div>
            <div className="sm:col-span-2">
              <p className="text-label-bold uppercase text-slate-500">Contextos de uso</p>
              <TagList items={block.semantics.useContexts} />
            </div>
          </div>

          {block.semantics.classificationStatus === "EXCLUDED_NON_PRODUCT" && block.semantics.exclusion ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-body-md text-amber-800">
              Excluido del universo comercial: {block.semantics.exclusion.reason} ({block.semantics.exclusion.ruleId})
            </div>
          ) : null}

          <div className="mt-5 grid gap-2 border-t border-slate-200 pt-4 text-label-sm text-slate-500 sm:grid-cols-3">
            <span>Ontology: {block.semantics.ontologyVersion}</span>
            <span>Classifier: {block.semantics.classifierVersion}</span>
            <span className="truncate" title={block.semantics.snapshotId}>
              Snapshot: {block.semantics.snapshotId}
            </span>
          </div>
        </>
      ) : null}
    </section>
  );
}
