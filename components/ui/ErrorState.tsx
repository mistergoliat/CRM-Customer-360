type ErrorStateProps = {
  title?: string;
  message?: string;
};

export function ErrorState({ title = "No se pudo cargar", message = "La consulta falló sin interrumpir el HUB." }: ErrorStateProps) {
  return (
    <div className="hub-card border-primary-fixed bg-red-50/40 p-5">
      <p className="text-label-bold uppercase text-red-700">{title}</p>
      <p className="mt-2 text-body-md text-slate-700">{message}</p>
    </div>
  );
}
