import { baseFor } from "./config";

export type Look = {
  readonly number: number;
  readonly slug: string;
  readonly name: string;
};

/** Ordre de défilé. Ne jamais réordonner : le numéro de look fait partie de l'identité. */
export const LOOKS: readonly Look[] = [
  { number: 1, slug: "reunion-metre", name: "Réunion-mètre" },
  { number: 2, slug: "jure-crache", name: "Juré Craché" },
  { number: 3, slug: "sav-de-ta-vie", name: "Le SAV de ta vie" },
];

export type TagInfo = {
  label: string;
  nextHref: string;
  nextLabel: string;
  lookbookHref: string;
};

/** Contenu de l'étiquette de collection pour un look donné. */
export function tagFor(slug: string): TagInfo {
  const index = LOOKS.findIndex((look) => look.slug === slug);
  if (index === -1) {
    throw new Error(`Look inconnu : ${slug}`);
  }
  const current = LOOKS[index];
  const next = LOOKS[index + 1];
  if (current === undefined) {
    throw new Error(`Look inconnu : ${slug}`);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    label: `Look ${pad(current.number)}/${pad(LOOKS.length)}`,
    nextHref: next === undefined ? baseFor(null) : baseFor(next.slug),
    nextLabel: next === undefined ? "Retour au lookbook" : `Suivant : ${next.name}`,
    lookbookHref: baseFor(null),
  };
}
