// La cadence vit dans packages/shared (partagée avec Juré Craché, qui a aussi un compteur live).
// Ce module la réexporte pour que le Réunion-mètre et ses tests n'aient pas à changer d'import.
export {
  SUMMARY_INTERVAL_MS,
  everySecond,
  msToNextSecond,
  summaryDue,
} from "@paperasse/shared/ticker";
export type { Timers } from "@paperasse/shared/ticker";
