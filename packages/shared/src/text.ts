/**
 * Caractères retirés de tout texte venant de l'utilisateur :
 * - contrôles C0/C1 (dont le caractère nul) ;
 * - marques et surcharges bidirectionnelles, utilisées pour retourner visuellement un texte
 *   (U+200E, U+200F, U+202A à U+202E, U+2066 à U+2069).
 */
const FORBIDDEN_CHARS = new RegExp(
  String.raw`[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]`,
  "gu",
);

export type TextBounds = { min: number; max: number };

export type TextResult =
  { ok: true; value: string } | { ok: false; reason: "type" | "too-short" | "too-long" };

/** Longueur en points de code, pas en unités UTF-16 (un emoji compte pour 1). */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/** Nettoie puis valide un texte libre. Ne lève jamais d'exception. */
export function sanitizeText(input: unknown, bounds: TextBounds): TextResult {
  if (typeof input !== "string") {
    return { ok: false, reason: "type" };
  }
  // On borne avant de normaliser pour ne pas traiter une chaîne énorme.
  if (input.length > bounds.max * 4) {
    return { ok: false, reason: "too-long" };
  }
  const value = input.normalize("NFC").replace(FORBIDDEN_CHARS, "").trim();
  const length = codePointLength(value);
  if (length < bounds.min) {
    return { ok: false, reason: "too-short" };
  }
  if (length > bounds.max) {
    return { ok: false, reason: "too-long" };
  }
  return { ok: true, value };
}
