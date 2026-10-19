/**
 * Caractères retirés de tout texte venant de l'utilisateur :
 * - contrôles C0/C1 (`\p{Cc}`, dont le caractère nul) ;
 * - tous les contrôles bidirectionnels (`\p{Bidi_Control}` : U+061C, U+200E, U+200F,
 *   U+202A à U+202E, U+2066 à U+2069), qui servent à retourner visuellement un texte. Une liste
 *   écrite à la main en oubliait (U+061C) : la propriété Unicode suit les versions du standard ;
 * - les demi-surrogates isolés (`\p{Cs}`, U+D800 à U+DFFF hors paire) : ils ne sont pas de
 *   l'Unicode valide et `encodeURIComponent` lève « URI malformed » dessus. Un champ de saisie
 *   peut en recevoir (collage, saisie par script) ; une paire valide (emoji) n'est pas touchée,
 *   le drapeau `u` la lit comme un seul point de code.
 */
const FORBIDDEN_CHARS = /[\p{Cc}\p{Cs}\p{Bidi_Control}]/gu;

/**
 * Un caractère visible : lettre, chiffre, ponctuation ou symbole, à condition de ne pas être
 * ignorable par défaut (U+200B, U+3164, U+FFA0, sélecteurs de variation, étiquettes…) ni un
 * glyphe dessiné vide (U+2800 braille vierge, U+1D159 tête de note nulle, U+FFFC caractère de
 * remplacement d'objet, que Chromium n'affiche pas). Les espaces, les marques combinantes seules
 * et les caractères de format ne comptent pas non plus.
 */
const VISIBLE_CHAR =
  /(?![\p{Default_Ignorable_Code_Point}\u{2800}\u{1D159}\u{FFFC}])[\p{L}\p{N}\p{P}\p{S}]/u;

/**
 * Nombre maximal de marques combinantes (`\p{M}`) consécutives. Les écritures réelles en
 * empilent rarement plus de 3 (vietnamien décomposé, hébreu vocalisé et cantillé, devanagari,
 * emoji keycap) ; au-delà, c'est du texte « zalgo » qui déborde sur les lignes voisines.
 */
export const MAX_COMBINING_MARKS = 4;

const COMBINING_RUN = new RegExp(`(\\p{M}{${MAX_COMBINING_MARKS}})\\p{M}+`, "gu");

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

/** Réduit chaque suite de marques combinantes à `MAX_COMBINING_MARKS`, en gardant les premières. */
export function capCombiningMarks(value: string): string {
  return value.replace(COMBINING_RUN, "$1");
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
  // Retrait d'abord, NFC ensuite : un caractère retiré entre une lettre et sa marque laisserait
  // sinon une paire que la normalisation suivante composerait, et la forme propre ne serait pas
  // stable (nettoyer deux fois donnerait deux résultats). Les marques sont plafonnées après NFC,
  // qui en compose déjà une partie ; garder un préfixe d'une suite déjà normalisée la laisse
  // normalisée.
  const cleaned = capCombiningMarks(input.replace(FORBIDDEN_CHARS, "").normalize("NFC")).trim();
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
