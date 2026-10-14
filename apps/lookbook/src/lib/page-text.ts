import { NBSP } from "@paperasse/shared/typography";

/**
 * Textes fixes de la page (affiche et post-its). Regroupés ici pour que les tests vérifient
 * leur typographie et leur conformité à la spec. Les tableaux sont des lignes affichées
 * séparément ; jointes par une espace, elles redonnent la phrase de la spec.
 */
export const PAGE_TEXT = {
  title: "Collection Paperasse · Automne-Hiver 2026",
  description: "Trois documents officiels. Aucune valeur. Zéro inscription.",
  posterKicker: "Avis à la population",
  posterTitle: ["Collection", "Paperasse"],
  season: "Défilé Automne-Hiver 2026.",
  rule: "Trois documents officiels. Aucune valeur. Zéro inscription.",
  stamp: "Entrée libre",
  looksHeading: "Les trois looks de la saison",
  nextCollection: `Prochaine collection${NBSP}:`,
  nextCollectionDetail: "bientôt. Peut-être. On a des chaussettes et un pigeon.",
  privacy: ["Aucun cookie,", "aucun compte,", "aucun serveur."],
  repoLink: "Le code sur GitHub",
} as const;
