import { baseFor } from "./config";

/** Espace insécable : avant « : ; ! ? » et à l'intérieur des guillemets (CLAUDE.md). */
const NBSP = String.fromCodePoint(0xa0);

/**
 * Ordre de défilé. Ne jamais réordonner : le numéro de look fait partie de l'identité.
 * `as const` pour que les slugs deviennent un type fermé (`LookSlug`) : un look oublié dans
 * une table indexée par slug devient une erreur de compilation.
 */
export const LOOKS = [
  { number: 1, slug: "reunion-metre", name: "Réunion-mètre" },
  { number: 2, slug: "jure-crache", name: "Juré Craché" },
  { number: 3, slug: "sav-de-ta-vie", name: "Le SAV de ta vie" },
] as const satisfies readonly { number: number; slug: string; name: string }[];

export type Look = (typeof LOOKS)[number];
export type LookSlug = Look["slug"];

/** Texte du lien vers le lookbook, identique sur toutes les étiquettes (specs/lookbook.md). */
export const COLLECTION_LABEL = "Collection Paperasse · AH26";

/** Séparateur visible entre les blocs de l'étiquette (specs/lookbook.md). */
export const TAG_SEPARATOR = "·";

/** « 1 » → « 01 ». */
export function formatLookNumber(lookNumber: number): string {
  return String(lookNumber).padStart(2, "0");
}

export type TagLink = { readonly text: string; readonly href: string };

export type TagInfo = {
  /** « Collection Paperasse · AH26 », lien vers le lookbook. */
  readonly brand: TagLink;
  /** « Look 01/03 ». */
  readonly position: string;
  /** « Suivant : Juré Craché » ou « Retour au lookbook », lien vers la suite du défilé. */
  readonly next: TagLink;
};

/** Contenu de l'étiquette de collection pour un look donné. */
export function tagFor(slug: LookSlug): TagInfo {
  const index = LOOKS.findIndex((look) => look.slug === slug);
  const current = LOOKS[index];
  if (current === undefined) {
    throw new Error(`Look inconnu : ${slug}`);
  }
  const next = LOOKS[index + 1];
  return {
    brand: { text: COLLECTION_LABEL, href: baseFor(null) },
    position: `Look ${formatLookNumber(current.number)}/${formatLookNumber(LOOKS.length)}`,
    next:
      next === undefined
        ? { text: "Retour au lookbook", href: baseFor(null) }
        : { text: `Suivant${NBSP}: ${next.name}`, href: baseFor(next.slug) },
  };
}
