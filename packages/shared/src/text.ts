/**
 * Caractères retirés de tout texte venant de l'utilisateur :
 * - contrôles C0/C1 (`\p{Cc}`, dont le caractère nul) ;
 * - tous les contrôles bidirectionnels (`\p{Bidi_Control}` : U+061C, U+200E, U+200F,
 *   U+202A à U+202E, U+2066 à U+2069), qui servent à retourner visuellement un texte. Une liste
 *   écrite à la main en oubliait (U+061C) : la propriété Unicode suit les versions du standard.
 */
const FORBIDDEN_CHARS = /[\p{Cc}\p{Bidi_Control}]/gu;

/**
 * Un caractère visible : lettre, chiffre, ponctuation ou symbole, à condition de ne pas être
 * ignorable par défaut (U+200B, U+3164, U+FFA0, sélecteurs de variation, étiquettes…) ni un
 * glyphe dessiné vide (U+2800 braille vierge, U+1D159 tête de note nulle). Les espaces, les
 * marques combinantes seules et les caractères de format ne comptent pas non plus.
 */
const VISIBLE_CHAR =
  /(?![\p{Default_Ignorable_Code_Point}\u{2800}\u{1D159}])[\p{L}\p{N}\p{P}\p{S}]/u;

export type TextBounds = { min: number; max: number };

export type TextResult =
  { ok: true; value: string } | { ok: false; reason: "type" | "too-short" | "too-long" };

/** Longueur en points de code, pas en unités UTF-16 (un emoji compte pour 1). */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/** Vrai si le texte contient au moins un caractère qui s'affiche (voir `VISIBLE_CHAR`). */
export function hasVisibleChar(value: string): boolean {
  return VISIBLE_CHAR.test(value);
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
  const cleaned = input.normalize("NFC").replace(FORBIDDEN_CHARS, "").trim();
  // Un texte sans rien de visible (que des U+200B, U+3164…) est un texte vide : sinon, un lien
  // forgé fait asseoir un « participant fantôme ». Les invisibles mêlés à du visible restent,
  // à commencer par U+200D qui compose les emoji (famille, métiers…).
  const value = hasVisibleChar(cleaned) ? cleaned : "";
  const length = codePointLength(value);
  if (length < bounds.min) {
    return { ok: false, reason: "too-short" };
  }
  if (length > bounds.max) {
    return { ok: false, reason: "too-long" };
  }
  return { ok: true, value };
}
