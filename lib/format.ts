export function formatDateTime(value: unknown) {
  if (!value) return "sin datos";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Santiago"
  }).format(date);
}

export function formatNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return "0";
  const num = Number(value);
  if (Number.isNaN(num)) return "0";
  return new Intl.NumberFormat("es-CL").format(num);
}

export function asText(value: unknown, fallback = "sin datos") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function truncate(value: unknown, max = 120) {
  const text = asText(value, "");
  if (text.length <= max) return text || "sin datos";
  return `${text.slice(0, max - 3)}...`;
}
