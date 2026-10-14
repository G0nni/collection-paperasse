import { baseFor } from "@paperasse/shared/config";
import { LOOKS, formatLookNumber, type Look, type LookSlug } from "@paperasse/shared/looks";

/** Espace insécable, à mettre avant « : ; ! ? » et à l'intérieur des guillemets. */
const NBSP = String.fromCodePoint(0xa0);

export type SheetTerm = "Matière" | "Coupe" | "Prix";

export type SheetEntry = { readonly term: SheetTerm; readonly value: string };

/** Quel document punaiser au-dessus de la fiche. */
export type PreviewKind = "ticket" | "acte" | "listing";

export type LookContent = {
  readonly tagline: string;
  readonly sheet: readonly SheetEntry[];
  readonly preview: PreviewKind;
  /** Nom accessible de l'aperçu, qui est une illustration et pas du contenu lisible. */
  readonly previewLabel: string;
};

export type LookCard = LookContent & {
  readonly slug: LookSlug;
  readonly name: string;
  /** « Look 01 » : le numéro de défilé, toujours sur deux chiffres. */
  readonly label: string;
  readonly href: string;
  /** Texte visible du lien. */
  readonly linkText: string;
  /** Nom accessible du lien : le texte visible, suivi du nom de l'app. */
  readonly linkLabel: string;
};

/**
 * Textes des fiches, indexés par slug : un look ajouté à la collection sans fiche est une
 * erreur de compilation. Les fiches défilé (Matière, Coupe, Prix) sont celles de
 * specs/lookbook.md, mot pour mot.
 */
export const LOOK_CONTENT: Readonly<Record<LookSlug, LookContent>> = {
  "reunion-metre": {
    tagline: "Ce que coûte votre réunion, en direct. Un lien, tout le monde voit l'argent partir.",
    sheet: [
      { term: "Matière", value: `papier thermique 80${NBSP}mm` },
      { term: "Coupe", value: "en temps réel" },
      { term: "Prix", value: `0${NBSP}€ (mais la réunion, elle, coûte cher)` },
    ],
    preview: "ticket",
    previewLabel: `Aperçu${NBSP}: un ticket de réunion qui affiche 247,80${NBSP}€, dont zéro décision prise.`,
  },
  "jure-crache": {
    tagline:
      "Étude notariale fondée dans la cour de récré. Si quelqu'un trafique le lien, le numéro d'acte change.",
    sheet: [
      { term: "Matière", value: "papier vergé, cire" },
      { term: "Coupe", value: "notariale" },
      { term: "Prix", value: "un kebab, selon l'issue" },
    ],
    preview: "acte",
    previewLabel: `Aperçu${NBSP}: un acte de pari scellé à la cire. Kevin arrivera en retard samedi, enjeu${NBSP}: un kebab.`,
  },
  "sav-de-ta-vie": {
    tagline: `Un helpdesk pour tes problèmes perso. Support niveau 1${NBSP}: toi. Niveau 2${NBSP}: toi, mais fatigué.`,
    sheet: [
      { term: "Matière", value: "papier listing 132 colonnes" },
      { term: "Coupe", value: "en file d'attente" },
      { term: "Prix", value: `0${NBSP}€, SLA non garanti` },
    ],
    preview: "listing",
    previewLabel: `Aperçu${NBSP}: un listing de tickets, dont «${NBSP}Frigo vide${NBSP}» en critique et «${NBSP}Rappeler mamie${NBSP}» rouvert trois fois.`,
  },
};

/** Assemble les cartes du lookbook, dans l'ordre du défilé. */
export function buildCatalog(looks: readonly Look[] = LOOKS): LookCard[] {
  return looks.map((look) => {
    const label = `Look ${formatLookNumber(look.number)}`;
    return {
      ...LOOK_CONTENT[look.slug],
      slug: look.slug,
      name: look.name,
      label,
      href: baseFor(look.slug),
      linkText: `Essayer le ${label}`,
      linkLabel: `Essayer le ${label}, ${look.name}`,
    };
  });
}
