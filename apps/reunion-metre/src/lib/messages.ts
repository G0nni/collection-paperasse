// Tous les textes d'interface du look, au même endroit pour que l'oracle typographique les
// vérifie un par un (messages.test.ts). Insécable U+00A0 avant « : ; ! ? » et dans « », jamais
// de tiret cadratin (CLAUDE.md).
import { NBSP } from "@paperasse/shared/typography";
import { LIMITS } from "./meeting";
import type { ProposalError } from "./drafts";
import type { Notice } from "./link";

export const TEXT = {
  pageTitle: "Réunion-mètre · Collection Paperasse",
  description:
    "Ce que coûte votre réunion, en direct. Un lien dans le chat, et tout le monde voit le même compteur.",
  heading: "Réunion-mètre",
  tagline: "Ce que coûte votre réunion, en direct.",

  setupHeading: "Préparer la réunion",
  titleLabel: "Titre de la réunion (facultatif)",
  titlePlaceholder: "Point rapide",
  tariffLegend: "Tarif",
  peopleLegend: "Autour de la table",
  whoLabel: "Qui",
  rateLabel: "€/heure",
  remove: "Retirer",
  addPerson: "+ quelqu'un qui n'a rien à faire là",
  peopleFull: `${LIMITS.maxParticipants} personnes au maximum. La salle est pleine.`,
  hourlyPreview: "Coût horaire",

  freeLamp: "LIBRE",
  busyLamp: "OCCUPÉ",
  launch: "Lancer le compteur",
  finish: "Terminer",

  amountHeading: "Montant facturé à l'entreprise",
  durationLabel: "Durée",
  countLabel: "Personnes",
  hourlyLabel: "€ / heure",
  copyMeter: "Copier le lien du compteur",
  ended: "Réunion terminée. Le compteur est figé, le ticket aussi.",

  receiptHeading: "Ticket de réunion",
  receiptCounter: `caisse n°${NBSP}3`,
  receiptRunning: "en cours",
  deviceTime: "Heure de votre appareil",
  receiptDuration: "Durée",
  receiptPeople: "Autour de la table",
  total: "Total",
  decisions: `Décisions prises${NBSP}:`,
  decisionsValue: "0",
  mail: `Aurait pu être un mail${NBSP}:`,
  receiptThanks: "Merci de votre non-visite. À la semaine prochaine.",

  copyTicket: "Copier le lien du ticket",
  newMeeting: "Nouvelle réunion",
  copied: "Lien copié.",
  copyDialogTitle: "Copiez le lien à la main",
  copyRefused: `Le navigateur refuse la copie${NBSP}: le lien est sélectionné ci-dessous. Copiez-le (Ctrl+C, ou appui long sur mobile), puis collez-le dans le chat de la réunion.`,
  linkField: "Lien à copier",
  dismiss: "Fermer",
  dismissContext: "les messages du lien",

  labelError: `Le libellé doit faire de ${LIMITS.labelMin} à ${LIMITS.labelMax} caractères.`,
  rateError: `Le taux doit être un nombre entier de ${LIMITS.minRate} à ${LIMITS.maxRate}.`,
  titleError: `Le titre fait ${LIMITS.titleMax} caractères au maximum.`,
  fixRows: "Corrigez les participants signalés avant de lancer le compteur.",
  noValidPeople: "Il faut au moins une personne valide autour de la table.",
  linkTooLong: `Lien trop long${NBSP}: raccourcissez un libellé ou retirez quelqu'un.`,

  noScript: "Le compteur a besoin de JavaScript pour tourner.",

  volunteer: "Réunion bénévole. Suspect.",
  capped: `Réunion de plus de 24${NBSP}h. Respirez.`,
} as const;

/** Libellé de groupe d'une ligne participant : « Participant 3 ». */
export function rowLegend(position: number): string {
  return `Participant ${position}`;
}

/** Fin cachée du bouton « Retirer » : « Retirer le participant 3 » pour un lecteur d'écran. */
export function removeContext(position: number): string {
  return `le participant ${position}`;
}

/** Ligne de taux d'un participant sur le ticket : « 68 €/h ». */
export function rateText(rate: number): string {
  return `${rate}${NBSP}€/h`;
}

/** Texte visible d'un message issu de la lecture du lien. */
export function noticeText(notice: Notice): string {
  switch (notice.code) {
    case "unknown-version":
      return "Lien d'une version inconnue. Voici une réunion vierge.";
    case "too-long":
      return "Lien trop long. Voici une réunion vierge.";
    case "future-start":
      return "Cette réunion n'a pas encore commencé. Profitez-en.";
    case "bad-start":
      return `Heure de début illisible${NBSP}: la réunion n'est pas lancée.`;
    case "bad-end":
      return `Heure de fin illisible${NBSP}: la réunion continue.`;
    case "future-end":
      return `Heure de fin dans le futur${NBSP}: la réunion continue.`;
    case "end-without-start":
      return `Heure de fin sans heure de début${NBSP}: elle est ignorée.`;
    case "bad-tariff":
      return `Tarif inconnu${NBSP}: tarif A appliqué.`;
    case "bad-title":
      return `Titre illisible ou trop long${NBSP}: il est ignoré.`;
    case "too-many-participants":
      return `Plus de ${LIMITS.maxParticipants} participants dans le lien${NBSP}: seuls les ${LIMITS.maxParticipants} premiers sont gardés.`;
    case "ignored-participants":
      return notice.count >= 2
        ? `${notice.count} participants illisibles ont été ignorés.`
        : "1 participant illisible a été ignoré.";
    case "no-participants":
      return "Aucun participant lisible dans le lien. Voici la configuration.";
  }
}

/** Pourquoi une modification du formulaire n'entre pas dans la réunion (donc dans le lien). */
export function proposalErrorText(error: ProposalError): string {
  switch (error) {
    case "no-valid-people":
      return TEXT.noValidPeople;
    case "link-too-long":
      return TEXT.linkTooLong;
  }
}
