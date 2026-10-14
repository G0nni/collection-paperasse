// Modèle d'une réunion (specs/reunion-metre.md, « Format d'URL » et « Calcul »). Aucune
// dépendance au DOM : tout ce qui suit est importable par les tests unitaires.
import { NBSP } from "@paperasse/shared/typography";

export const TARIFF_CODES = ["A", "B", "C"] as const;
export type TariffCode = (typeof TARIFF_CODES)[number];

export type Tariff = {
  readonly code: TariffCode;
  readonly name: string;
  /**
   * Multiplicateur en demis (×1 → 2, ×1,5 → 3, ×2 → 4) : le calcul reste en entiers, sans
   * erreur d'arrondi binaire sur 1,5.
   */
  readonly halves: number;
  /** « ×1,5 », pour l'affichage. */
  readonly factor: string;
};

export const TARIFFS: Readonly<Record<TariffCode, Tariff>> = {
  A: { code: "A", name: "Point rapide", halves: 2, factor: "×1" },
  B: { code: "B", name: "Sans ordre du jour", halves: 3, factor: "×1,5" },
  C: { code: "C", name: "Aurait pu être un mail", halves: 4, factor: "×2" },
};

/** Tarif appliqué quand `t` est absent ou invalide dans un lien. */
export const LINK_DEFAULT_TARIFF: TariffCode = "A";
/** Tarif présélectionné sur l'écran Configuration sans paramètre (CA-1). */
export const SETUP_DEFAULT_TARIFF: TariffCode = "B";

export type Participant = { readonly rate: number; readonly label: string };

export const LIMITS = {
  maxParticipants: 30,
  minRate: 0,
  maxRate: 1000,
  labelMin: 1,
  labelMax: 40,
  titleMax: 60,
  /** Durée maximale d'une réunion, en secondes (CL-2 et borne de `e`). */
  maxDuration: 86_400,
  /** Plus petit `s` accepté : 2020-01-01T00:00:00Z. */
  earliestStart: 1_577_836_800,
  /** Tolérance d'horloge entre appareils pour un `s` dans le futur. */
  futureTolerance: 60,
} as const;

export type Role = { readonly label: string; readonly rate: number };

/**
 * Suggestions du formulaire (un `<datalist>`). Jamais référencées dans l'URL : un participant
 * choisi depuis cette liste y est écrit en clair, libellé et taux.
 */
export const ROLES: readonly Role[] = [
  { label: "Cheffe de projet", rate: 68 },
  { label: "Dev qui code sous la table", rate: 48 },
  { label: `Responsable «${NBSP}transverse${NBSP}»`, rate: 72 },
  { label: "Celui qui a la caméra coupée", rate: 51 },
  { label: "Stagiaire qui prend les notes", rate: 6 },
  { label: "Quelqu'un du juridique, au cas où", rate: 80 },
  { label: `Le N+2 qui «${NBSP}passe juste${NBSP}»`, rate: 95 },
  { label: "Consultant externe", rate: 120 },
  { label: "Patrick", rate: 55 },
];

export type Meeting = {
  readonly tariff: TariffCode;
  readonly participants: readonly Participant[];
  /** `n` : titre libre, déjà nettoyé. Chaîne vide si absent. */
  readonly title: string;
  /** `s` : début, timestamp Unix en secondes. `null` tant que la réunion n'est pas lancée. */
  readonly start: number | null;
  /** `e` : fin, timestamp Unix en secondes. `null` tant que la réunion tourne. */
  readonly end: number | null;
};

export type Screen = "setup" | "meter" | "ticket";

/** Réunion de l'écran Configuration sans paramètre (CA-1) : 5 suggestions, tarif B. */
export function defaultMeeting(): Meeting {
  return {
    tariff: SETUP_DEFAULT_TARIFF,
    participants: ROLES.slice(0, 5).map((role) => ({ rate: role.rate, label: role.label })),
    title: "",
    start: null,
    end: null,
  };
}

/** L'écran découle de l'état, jamais l'inverse (specs, « Écrans »). */
export function screenOf(meeting: Meeting): Screen {
  if (meeting.start === null || meeting.participants.length === 0) return "setup";
  return meeting.end === null ? "meter" : "ticket";
}
