// Cadence des compteurs live de la collection (tout look qui affiche un compteur à la seconde).
// L'horloge et les minuteurs sont injectés : testable avec vi.useFakeTimers, et aucun Date.now()
// caché dans la logique.

/** Le résumé accessible d'un compteur live change au plus toutes les 30 s (CLAUDE.md). */
export const SUMMARY_INTERVAL_MS = 30_000;

export function summaryDue(lastUpdateMs: number | null, nowMs: number): boolean {
  return lastUpdateMs === null || nowMs - lastUpdateMs >= SUMMARY_INTERVAL_MS;
}

/** Délai jusqu'au prochain changement de seconde, dans ]0, 1000]. */
export function msToNextSecond(nowMs: number): number {
  return 1000 - (((nowMs % 1000) + 1000) % 1000);
}

export type Timers<Handle> = {
  readonly set: (callback: () => void, delayMs: number) => Handle;
  readonly clear: (handle: Handle) => void;
};

/**
 * Appelle `callback` à chaque changement de seconde de `clock`, recalé à chaque tour : deux
 * appareils à l'heure changent d'affichage au même moment, et un battement en retard ne décale
 * pas les suivants. Renvoie la fonction d'arrêt.
 */
export function everySecond<Handle>(
  callback: () => void,
  clock: () => number,
  timers: Timers<Handle>,
): () => void {
  let handle: Handle | null = null;
  let stopped = false;
  const schedule = () => {
    handle = timers.set(() => {
      callback();
      // Le callback peut arrêter le compteur (fin du compteur) : on ne relance pas.
      if (!stopped) schedule();
    }, msToNextSecond(clock()));
  };
  schedule();
  return () => {
    stopped = true;
    if (handle !== null) timers.clear(handle);
    handle = null;
  };
}
