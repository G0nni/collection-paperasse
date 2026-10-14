// Calcul du compteur (specs/reunion-metre.md, « Calcul »). Toujours depuis l'heure, jamais par
// incrément (CL-9) : deux appareils qui ouvrent le même lien au même instant calculent le même
// montant (CA-3). Tout est en centimes entiers.
import { NBSP } from "@paperasse/shared/typography";
import { LIMITS, TARIFFS, type Meeting, type Participant, type TariffCode } from "./meeting";

export type Elapsed = {
  /** Secondes écoulées, bornées à [0, 24 h]. */
  readonly seconds: number;
  /** Vrai si la réunion tourne depuis plus de 24 h et que le compteur est arrêté (CL-2). */
  readonly capped: boolean;
};

/**
 * Durée de la réunion à l'instant `nowMs`. Seconde entière : tous les appareils changent de
 * montant au même moment (le compteur est calé sur le changement de seconde).
 */
export function elapsed(meeting: Meeting, nowMs: number): Elapsed {
  if (meeting.start === null) return { seconds: 0, capped: false };
  const end = meeting.end ?? Math.floor(nowMs / 1000);
  const raw = end - meeting.start;
  return {
    seconds: Math.min(Math.max(raw, 0), LIMITS.maxDuration),
    capped: meeting.end === null && raw > LIMITS.maxDuration,
  };
}

export function rateSum(participants: readonly Participant[]): number {
  return participants.reduce((sum, participant) => sum + participant.rate, 0);
}

/** Coût horaire de la réunion, en centimes (Σ taux × multiplicateur). */
export function hourlyCents(participants: readonly Participant[], tariff: TariffCode): number {
  return (rateSum(participants) * TARIFFS[tariff].halves * 100) / 2;
}

/**
 * coût = durée / 3600 × Σ taux × multiplicateur, arrondi au centime (demi vers le haut).
 * En centimes : durée × Σ × demis × 100 / (3600 × 2) = durée × Σ × demis / 72. Au pire
 * 86 400 × 30 000 × 4 ≈ 1e10 : très loin de la limite des entiers exacts.
 */
export function costCents(
  seconds: number,
  participants: readonly Participant[],
  tariff: TariffCode,
): number {
  return Math.round((seconds * rateSum(participants) * TARIFFS[tariff].halves) / 72);
}

/** Répartition du coût sur le ticket ; les pourcentages font 100. */
export const SPLIT = [
  { label: "Tour de table", percent: 32 },
  { label: `«${NBSP}Tu m'entends, là${NBSP}?${NBSP}»`, percent: 14 },
  { label: "Digression sur le parking", percent: 28 },
  { label: "Récap de ce qui vient d'être dit", percent: 26 },
] as const;

export type ReceiptLine = { readonly label: string; readonly cents: number };

/**
 * Lignes facturées du ticket. Chaque part est arrondie à l'inférieur, le reste d'arrondi va sur
 * la dernière : la somme des lignes affichées est exactement le total affiché, et aucune ligne
 * n'est négative.
 */
export function splitCost(totalCents: number): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  let remaining = totalCents;
  SPLIT.forEach((part, index) => {
    const cents =
      index === SPLIT.length - 1 ? remaining : Math.floor((totalCents * part.percent) / 100);
    remaining -= cents;
    lines.push({ label: part.label, cents });
  });
  return lines;
}

/** « Café tiède × N » à 0,00 €, puis la répartition. */
export function receiptLines(participantCount: number, totalCents: number): ReceiptLine[] {
  return [{ label: `Café tiède ×${NBSP}${participantCount}`, cents: 0 }, ...splitCost(totalCents)];
}

/** « Aurait pu être un mail » : OUI au tarif C, PEUT-ÊTRE sinon. */
export function mailVerdict(tariff: TariffCode): "OUI" | "PEUT-ÊTRE" {
  return tariff === "C" ? "OUI" : "PEUT-ÊTRE";
}

/** Fin à écrire dans `e` quand on clique « Terminer » : toujours dans ]s, s + 24 h]. */
export function endFor(start: number, nowMs: number): number {
  const now = Math.floor(nowMs / 1000);
  return Math.min(Math.max(now, start + 1), start + LIMITS.maxDuration);
}
