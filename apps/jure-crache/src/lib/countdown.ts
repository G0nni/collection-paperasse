// Compte à rebours jusqu'à l'échéance (CA-4). Toujours recalculé depuis l'heure, jamais par
// décrément : un onglet resté en arrière-plan affiche juste dès son retour.

export type Countdown =
  | { readonly passed: true }
  | {
      readonly passed: false;
      readonly days: number;
      readonly hours: number;
      readonly minutes: number;
      readonly seconds: number;
    };

/**
 * Temps restant entre `nowMs` et `deadlineMs`, arrondi à la seconde supérieure : le compteur
 * affiche « 00 sec » jamais avant l'échéance, et bascule pile à l'échéance (`passed`).
 */
export function countdown(deadlineMs: number, nowMs: number): Countdown {
  const remaining = deadlineMs - nowMs;
  if (!(remaining > 0)) return { passed: true };
  const total = Math.ceil(remaining / 1000);
  return {
    passed: false,
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

export type Stub = { readonly value: string; readonly unit: string };

/** Les quatre souches perforées : « 03 jours », « 11 heures », « 42 min », « 09 sec ». */
export function stubs(remaining: Exclude<Countdown, { passed: true }>): readonly Stub[] {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    { value: pad(remaining.days), unit: "jours" },
    { value: pad(remaining.hours), unit: "heures" },
    { value: pad(remaining.minutes), unit: "min" },
    { value: pad(remaining.seconds), unit: "sec" },
  ];
}

function unit(count: number, singular: string, plural: string): string {
  return `${count} ${count >= 2 ? plural : singular}`;
}

/**
 * Résumé accessible du compte à rebours, mis à jour au plus toutes les 30 s (CLAUDE.md) : à la
 * minute près, les secondes changeraient trop vite pour être lues.
 */
export function spokenCountdown(remaining: Countdown, passedText: string): string {
  if (remaining.passed) return passedText;
  const parts = [
    remaining.days > 0 ? unit(remaining.days, "jour", "jours") : null,
    remaining.hours > 0 ? unit(remaining.hours, "heure", "heures") : null,
    remaining.minutes > 0 ? unit(remaining.minutes, "minute", "minutes") : null,
  ].filter((part) => part !== null);
  if (parts.length === 0) return "Échéance dans moins d'une minute.";
  const last = parts.pop();
  const list = parts.length === 0 ? last : `${parts.join(", ")} et ${last}`;
  return `Échéance dans ${list}.`;
}
