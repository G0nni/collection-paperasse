// Formatage des montants, durées et dates (CLAUDE.md : montants en Intl.NumberFormat fr-FR EUR).
// L'arrondi au centime est fait en amont (meter.ts) : on ne formate que des centimes entiers.
import { NBSP } from "@paperasse/shared/typography";

const EUROS = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const WHOLE_EUROS = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** « 1 247,80 € ». */
export function formatEuros(cents: number): string {
  return EUROS.format(cents / 100);
}

/** Coût horaire : « 245 € » s'il tombe rond, « 367,50 € » sinon. */
export function formatHourly(cents: number): string {
  return cents % 100 === 0 ? WHOLE_EUROS.format(cents / 100) : EUROS.format(cents / 100);
}

/**
 * Montant de l'afficheur LED, sans le symbole (affiché à part, en petit) : « 1 247,80 ».
 * Le séparateur de milliers d'Intl (U+202F) n'existe pas dans Doto : il est remplacé par
 * U+00A0, que Doto dessine à la même chasse que les chiffres. Les « 8 » fantômes restent ainsi
 * alignés sous le montant.
 */
export function ledAmount(cents: number): string {
  return EUROS.formatToParts(cents / 100)
    .filter((part) => part.type !== "currency" && part.type !== "literal")
    .map((part) => (part.type === "group" ? NBSP : part.value))
    .join("");
}

/** Les « 8 » fantômes de l'afficheur : même nombre de caractères que le montant (CA-9). */
export function ghostDigits(amount: string): string {
  return amount.replace(/\d/gu, "8");
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Durée de l'afficheur : « 00:42:05 », jusqu'à « 24:00:00 ». */
export function formatClock(seconds: number): string {
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

/** Nombre de personnes sur deux chiffres, comme sur un taximètre : « 05 ». */
export function formatCount(count: number): string {
  return pad(count);
}

const plural = (count: number, singular: string, pluralForm: string) =>
  `${count} ${count >= 2 ? pluralForm : singular}`;

/** « 247 euros et 80 centimes », « 1 euro », « 0 euro ». */
export function spokenAmount(cents: number): string {
  const euros = plural(Math.floor(cents / 100), "euro", "euros");
  const rest = cents % 100;
  return rest === 0 ? euros : `${euros} et ${plural(rest, "centime", "centimes")}`;
}

/** « 42 minutes », « 1 heure 5 minutes », « 2 heures », « 12 secondes ». */
export function spokenDuration(seconds: number): string {
  if (seconds < 60) return plural(seconds, "seconde", "secondes");
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const parts = [];
  if (hours > 0) parts.push(plural(hours, "heure", "heures"));
  if (minutes > 0) parts.push(plural(minutes, "minute", "minutes"));
  return parts.join(" ");
}

/** Résumé accessible du compteur (CA-8) : « 247 euros et 80 centimes, 42 minutes ». */
export function spokenSummary(cents: number, seconds: number): string {
  return `${spokenAmount(cents)}, ${spokenDuration(seconds)}`;
}

/**
 * Formats de date du ticket, à l'heure de l'appareil (CL-10). `timeZone` n'est passé que par
 * les tests ; absent, c'est le fuseau de l'appareil.
 */
function dateFormat(options: Intl.DateTimeFormatOptions, timeZone: string | undefined) {
  return new Intl.DateTimeFormat(
    "fr-FR",
    timeZone === undefined ? options : { ...options, timeZone },
  );
}

/** « 14/10/2026 ». */
export function formatDate(seconds: number, timeZone?: string): string {
  return dateFormat({ dateStyle: "short" }, timeZone).format(seconds * 1000);
}

/** « 09:05 ». */
export function formatTime(seconds: number, timeZone?: string): string {
  return dateFormat({ timeStyle: "short" }, timeZone).format(seconds * 1000);
}
