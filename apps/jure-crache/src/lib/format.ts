// Dates de l'acte, en fr-FR, dans le fuseau de l'appareil qui regarde (spec, « Décisions
// prises »). `timeZone` n'est passé que par les tests, pour ne pas dépendre de la machine.

/** « 14 octobre 2026 ». */
export function formatDate(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(ms);
}

/** « 17 octobre 2026 à 20:00 ». */
export function formatDateTime(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(ms);
}
