// Tous les textes d'interface du look, au même endroit pour que l'oracle typographique les
// vérifie un par un (messages.test.ts). Insécable U+00A0 avant « : ; ! ? » et dans « », jamais
// de tiret cadratin (CLAUDE.md).
import { NBSP } from "@paperasse/shared/typography";
import { LIMITS, type Deed } from "./deed";
import type { FieldError, TextField } from "./draft";
import type { Notice, UnreadableReason, Verdict } from "./link";

export const TEXT = {
  pageTitle: "Juré Craché · Collection Paperasse",
  description:
    "Étude notariale fondée dans la cour de récré. Un pari entre potes, un acte officiel (sans aucune valeur), un lien à envoyer.",
  heading: "Juré Craché",
  tagline: "Étude notariale fondée dans la cour de récré.",
  newDeed: "Nouvel acte",
  noScript: "Juré Craché a besoin de JavaScript pour rédiger et lire les actes.",

  // Rédaction
  draftHeading: "Rédiger un acte de pari",
  draftIntro: `Remplissez l'acte, scellez-le, envoyez le lien${NBSP}: tout tient dedans, rien n'est gardé ailleurs.`,
  bettorLabel: "Le parieur",
  opponentLabel: "Le contre-parieur",
  subjectLabel: "Objet du pari",
  stakeLabel: "Enjeu",
  bettorPlaceholder: "ex. Théo",
  opponentPlaceholder: "ex. Sam",
  subjectPlaceholder: "ex. Kevin arrivera en retard à la soirée de samedi.",
  stakePlaceholder: "ex. Un (1) kebab, sauce au choix du gagnant, frites incluses.",
  articlesLegend: "Articles",
  articlesHint: `De 0 à ${LIMITS.articlesMax}, modifiables.`,
  addArticle: "Ajouter un article",
  articlesFull: `${LIMITS.articlesMax} articles au maximum. Le tribunal des potes a autre chose à faire.`,
  remove: "Retirer",
  deadlineLabel: "Échéance du pari",
  deadlineHint: "Date et heure de votre appareil.",
  seal: "Sceller l'acte",
  linkTooLong: `Acte trop long pour tenir dans un lien${NBSP}: raccourcissez le texte signalé.`,
  clock: `L'horloge de cet appareil indique une date antérieure à 2026${NBSP}: réglez-la avant de sceller.`,

  // Acte
  republic: "République des Potes",
  deedTitle: "Acte de pari",
  registered: "enregistré le",
  bettorRole: "Le parieur",
  opponentRole: "Le contre-parieur",
  subjectHeading: "Objet du pari",
  stakeHeading: "Enjeu",
  articlesHeading: "Articles",
  noArticles: "Aucun article particulier. Le tribunal des potes jugera au bon sens.",
  deadlineHeading: "Échéance du pari",
  passed: "Échéance passée. Le tribunal des potes attend votre verdict.",
  winnerStamp: "VAINQUEUR",
  drawStamp: "MATCH NUL",
  verdictNote:
    "Verdict déclaré par la personne qui a envoyé ce lien. En cas de litige, le tribunal des potes statue en dernier ressort.",
  signatureBettor: "Signature du parieur",
  signatureOpponent: "Signature du contre-parieur",
  sealLabel: `Sceau de cire${NBSP}: pas du tout légal mais très sérieux`,
  sealRing: "PAS DU TOUT LÉGAL · MAIS TRÈS SÉRIEUX ·",
  sealMark: "§",
  footer: "Acte sans aucune valeur juridique. Juré, craché.",
  unsealed: `Numéro non scellé${NBSP}: ce navigateur ne peut pas calculer l'empreinte de l'acte ici (page ouverte hors connexion sécurisée). L'acte reste lisible, mais son numéro ne prouve rien.`,

  // Actions
  copy: "Copier le lien de l'acte",
  copied: "Lien copié.",
  print: "Imprimer",
  declare: "Déclarer le vainqueur",
  changeVerdict: "Modifier le verdict",

  // Repli de copie (CA-7)
  copyDialogTitle: "Copiez le lien à la main",
  copyRefused: `Le navigateur refuse la copie${NBSP}: le lien est sélectionné ci-dessous. Copiez-le (Ctrl+C, ou appui long sur mobile), puis envoyez-le à l'autre partie.`,
  linkField: "Lien à copier",
  close: "Fermer",

  // Verdict (CA-5)
  verdictDialogTitle: "Déclarer le vainqueur",
  verdictDialogText: `Qui a gagné${NBSP}? Le verdict s'ajoute au lien de l'acte. Il ne change pas son numéro${NBSP}: il est déclaratif.`,
  draw: "Match nul",
  cancel: "Annuler",

  // Liens refusés
  unreadableTitle: "Acte illisible",
  unreadableText:
    "Ce lien ne contient pas un acte lisible. Il a pu être coupé en route, ou trafiqué.",
  unknownVersionTitle: "Acte d'une version inconnue",
  unknownVersionText:
    "Ce lien vient peut-être d'une version plus récente de Juré Craché. L'adresse n'a pas été modifiée.",
  restart: "Rédiger un nouvel acte",
  dismiss: "Fermer",
  dismissContext: "les messages du lien",
} as const;

/** « Article 3 », libellé du champ et du groupe. */
export function articleLabel(position: number): string {
  return `Article ${position}`;
}

/** Fin cachée du bouton « Retirer » : « Retirer l'article 3 » pour un lecteur d'écran. */
export function removeArticleContext(position: number): string {
  return `l'article ${position}`;
}

/** « Art. 3. » devant chaque article de l'acte. */
export function articlePrefix(position: number): string {
  return `Art.${NBSP}${position}.`;
}

/** Résumé en tête du formulaire : « 2 champs à corriger. » */
export function errorSummary(count: number): string {
  return count >= 2 ? `${count} champs à corriger.` : "1 champ à corriger.";
}

const EMPTY: Readonly<Record<TextField, string>> = {
  bettor: "Indiquez qui parie.",
  opponent: "Indiquez contre qui.",
  subject: "Dites sur quoi porte le pari.",
  stake: "Dites ce qui est en jeu.",
  article: `Article vide${NBSP}: écrivez-le ou retirez-le.`,
};

/** Borne de chaque texte libre, en caractères (points de code). */
const MAX: Readonly<Record<TextField, number>> = {
  bettor: LIMITS.nameMax,
  opponent: LIMITS.nameMax,
  subject: LIMITS.subjectMax,
  stake: LIMITS.stakeMax,
  article: LIMITS.articleMax,
};

/** Message d'erreur d'un champ du formulaire (CA-1). */
export function fieldErrorText(error: FieldError): string {
  if (error.field === "deadline") {
    switch (error.code) {
      case "missing-date":
        return "Indiquez la date et l'heure de l'échéance.";
      case "nonexistent-time":
        return `Cette heure n'existe pas sur cet appareil${NBSP}: les horloges la sautent au passage à l'heure d'été. Choisissez-en une autre.`;
      case "past-date":
        return "Cette échéance est déjà passée. On ne parie pas sur le passé.";
      case "too-far":
        return `L'échéance doit tomber dans les ${LIMITS.maxYears} ans. Au-delà, plus personne ne s'en souviendra.`;
    }
  }
  switch (error.code) {
    case "empty":
      return EMPTY[error.field];
    case "too-long":
      return `${MAX[error.field]} caractères au maximum.`;
    case "same-names":
      return "Le contre-parieur doit être une autre personne que le parieur. On ne parie pas contre soi-même.";
    case "link-too-long":
      return `Ce texte prend trop de place dans le lien de l'acte${NBSP}: raccourcissez-le.`;
  }
}

/** Résumé en tête du bouton « Sceller l'acte » : nombre de champs, ou acte trop long. */
export function formErrorText(errors: readonly FieldError[]): string {
  if (errors.length === 1 && errors[0]?.code === "link-too-long") return TEXT.linkTooLong;
  return errorSummary(errors.length);
}

/** Ce qui ne va pas dans un lien refusé, sous le titre « Acte illisible ». */
export function unreadableDetail(reason: UnreadableReason): string {
  switch (reason) {
    case "too-long":
      return "Lien trop long (plus de 4 Ko).";
    case "decoded-too-long":
      return "Acte trop long une fois décodé (plus de 4 Ko).";
    case "format":
    case "decompress":
    case "json":
      return `Le lien est abîmé${NBSP}: son contenu ne se décode pas.`;
    case "not-object":
    case "unknown-key":
    case "missing-key":
      return "Le contenu du lien n'a pas la forme d'un acte.";
    case "bad-text":
      return "Un nom, l'objet ou l'enjeu est vide ou trop long.";
    case "same-names":
      return "Le parieur et le contre-parieur portent le même nom. On ne parie pas contre soi-même.";
    case "bad-articles":
      return `Les articles sont illisibles${NBSP}: ${LIMITS.articlesMax} au maximum, de 1 à ${LIMITS.articleMax} caractères chacun.`;
    case "bad-draft-date":
      return "La date de rédaction est impossible (avant 2026, ou dans le futur).";
    case "bad-deadline":
      return `L'échéance est impossible${NBSP}: avant la rédaction, ou plus de ${LIMITS.maxYears} ans après.`;
  }
}

/** Texte d'un message issu de la lecture du lien. */
export function noticeText(notice: Notice): string {
  switch (notice) {
    case "unknown-verdict":
      return `Verdict inconnu dans le lien${NBSP}: il est ignoré.`;
  }
}

/**
 * Suite du numéro dans l'en-tête de l'acte : «  · enregistré le 14 octobre 2026 ». L'espace de
 * tête est sécable : la ligne peut se couper entre le numéro (insécable) et la date.
 */
export function registeredLine(registeredOn: string): string {
  return ` · ${TEXT.registered} ${registeredOn}`;
}

/** Ligne de l'échéance : « Le 17 octobre 2026 à 20:00 ». */
export function deadlineLine(when: string): string {
  return `Le ${when}`;
}

/**
 * Ligne qui remplace le compte à rebours d'un acte jugé : « Verdict déclaré. Échéance du pari :
 * 17 octobre 2026. » Le lien ne dit pas quand le verdict a été déclaré : aucune date de jugement
 * n'est affichée (spec, écran 3).
 */
export function judgedLine(deadlineDate: string): string {
  return `Verdict déclaré. ${TEXT.deadlineHeading}${NBSP}: ${deadlineDate}.`;
}

/** « Vainqueur déclaré : Théo. » ou « Match nul déclaré. » */
export function verdictLine(verdict: Verdict, deed: Deed): string {
  switch (verdict) {
    case "p":
      return `Vainqueur déclaré${NBSP}: ${deed.bettor}.`;
    case "c":
      return `Vainqueur déclaré${NBSP}: ${deed.opponent}.`;
    case "n":
      return "Match nul déclaré.";
  }
}
