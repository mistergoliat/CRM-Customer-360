"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaseLegacyCompatibilityNotes = CaseLegacyCompatibilityNotes;
const CaseDetailPrimitives_1 = require("./CaseDetailPrimitives");
function CaseLegacyCompatibilityNotes({ notes }) {
    if (notes.length === 0)
        return null;
    return (<CaseDetailPrimitives_1.CasePanelFrame title="Compatibilidad legacy" description="Brechas temporales entre el detalle legacy y el schema actualmente conectado." accent="amber">
      <div className="space-y-3">
        {notes.map((note, index) => (<CaseDetailPrimitives_1.CaseInlineNote key={`${note.title}-${index}`} tone={note.tone} title={note.title} body={note.body}/>))}
      </div>
    </CaseDetailPrimitives_1.CasePanelFrame>);
}
