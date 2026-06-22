"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorState = ErrorState;
function ErrorState({ title = "No se pudo cargar", message = "La consulta falló sin interrumpir el HUB." }) {
    return (<div className="hub-card border-primary-fixed bg-red-50/40 p-5">
      <p className="text-label-bold uppercase text-red-700">{title}</p>
      <p className="mt-2 text-body-md text-slate-700">{message}</p>
    </div>);
}
