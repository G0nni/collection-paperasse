// Lignes « participant » du formulaire, telles que tapées. Le formulaire garde le brouillon ;
// seules les lignes valides entrent dans la réunion, donc dans le lien (CA-5).
import { sanitizeText } from "@paperasse/shared/text";
import { parseStrictInt } from "@paperasse/shared/url";
import { LIMITS, ROLES, type Participant, type Role } from "./meeting";

export type DraftRow = { readonly id: number; readonly label: string; readonly rate: string };

export type RowCheck = {
  readonly participant: Participant | null;
  readonly labelError: boolean;
  readonly rateError: boolean;
};

/** Valide une ligne avec les mêmes règles qu'un paramètre `p` du lien. */
export function checkRow(row: DraftRow): RowCheck {
  const rate = parseStrictInt(row.rate.trim(), LIMITS.minRate, LIMITS.maxRate);
  const label = sanitizeText(row.label, { min: LIMITS.labelMin, max: LIMITS.labelMax });
  return {
    participant: rate !== null && label.ok ? { rate, label: label.value } : null,
    labelError: !label.ok,
    rateError: rate === null,
  };
}

export function validParticipants(checks: readonly RowCheck[]): Participant[] {
  return checks.map((check) => check.participant).filter((participant) => participant !== null);
}

/** Taux suggéré pour un libellé qui correspond exactement à une suggestion, sinon `null`. */
export function suggestedRate(label: string): number | null {
  const wanted = label.trim();
  return ROLES.find((role) => role.label === wanted)?.rate ?? null;
}

/** Prochaine personne ajoutée : la première suggestion pas encore à table, sinon on recycle. */
export function nextSuggestion(labels: readonly string[]): Role {
  const unused = ROLES.find((role) => !labels.includes(role.label));
  return unused ?? ROLES[labels.length % ROLES.length] ?? { label: "Patrick", rate: 55 };
}

/**
 * Une ligne se retire s'il en reste une autre et que la réunion garde au moins un participant
 * valide : on ne peut pas vider la table pendant le compteur.
 */
export function canRemove(checks: readonly RowCheck[], index: number): boolean {
  if (checks.length <= 1) return false;
  const validCount = validParticipants(checks).length;
  return validCount > 1 || checks[index]?.participant === null;
}

/** Lignes de départ du formulaire, depuis les participants d'une réunion. */
export function rowsFrom(participants: readonly Participant[], firstId = 1): DraftRow[] {
  return participants.map((participant, index) => ({
    id: firstId + index,
    label: participant.label,
    rate: String(participant.rate),
  }));
}
