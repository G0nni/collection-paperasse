// Dates de l'acte, en fr-FR, dans le fuseau de l'appareil qui regarde (spec, « Décisions
// prises »). `timeZone` n'est passé que par les tests, pour ne pas dépendre de la machine.

/**
 * Assemble les morceaux d'`Intl` en écrivant « 1er » pour le premier du mois : `Intl` écrit
 * « 1 janvier », que l'usage français refuse (spec, « Décisions prises »).
 */
function joinParts(parts: readonly Intl.DateTimeFormatPart[]): string {
  return parts
    .map((part) => (part.type === "day" && part.value === "1" ? "1er" : part.value))
    .join("");
}

/** « 14 octobre 2026 », « 1er janvier 2027 ». */
export function formatDate(ms: number, timeZone?: string): string {
  return joinParts(
    new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      ...(timeZone === undefined ? {} : { timeZone }),
    }).formatToParts(ms),
  );
}

/** « 17 octobre 2026 à 20:00 », « 1er novembre 2026 à 20:00 ». */
export function formatDateTime(ms: number, timeZone?: string): string {
  return joinParts(
    new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      ...(timeZone === undefined ? {} : { timeZone }),
    }).formatToParts(ms),
  );
}
