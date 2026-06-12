import type { CaseCompatibilityNote } from "@/lib/case-detail";
import { CaseInlineNote, CasePanelFrame } from "./CaseDetailPrimitives";

export function CaseLegacyCompatibilityNotes({ notes }: { notes: CaseCompatibilityNote[] }) {
  if (notes.length === 0) return null;

  return (
    <CasePanelFrame title="Compatibilidad legacy" description="Brechas temporales entre el detalle legacy y el schema actualmente conectado." accent="amber">
      <div className="space-y-3">
        {notes.map((note, index) => (
          <CaseInlineNote key={`${note.title}-${index}`} tone={note.tone} title={note.title} body={note.body} />
        ))}
      </div>
    </CasePanelFrame>
  );
}
