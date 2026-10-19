// Petits outils DOM du look (mêmes que ceux du Réunion-mètre). Texte toujours écrit en
// textContent (CLAUDE.md, Sécurité).

/** Élément de la page, du type attendu, sinon une erreur claire (la page est cassée). */
export function byId<T extends Element>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Élément #${id} introuvable.`);
  return element;
}

/** Emplacement `data-slot` d'une ligne clonée depuis un <template>. */
export function slot<T extends Element>(root: ParentNode, name: string, type: new () => T): T {
  const element = root.querySelector(`[data-slot="${name}"]`);
  if (!(element instanceof type)) throw new Error(`Emplacement ${name} introuvable.`);
  return element;
}

/**
 * N'écrit que si le texte change : chaque seconde, seuls les chiffres qui bougent touchent le
 * DOM, et une région live ne réannonce pas un message identique.
 */
export function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

/** Remplace le contenu d'une liste par un <li> par texte. */
export function fillList(list: HTMLElement, texts: readonly string[]): void {
  list.replaceChildren(
    ...texts.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }),
  );
}

const FOCUSABLE = "button, input, textarea, select, a[href], [tabindex]:not([tabindex='-1'])";

/**
 * Garde Tab et Maj+Tab dans un <dialog> modal. Chromium rend le reste de la page inerte mais
 * laisse le focus sortir vers la barre d'adresse après le dernier bouton : on boucle plutôt.
 */
export function trapFocus(dialog: HTMLDialogElement): void {
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll(FOCUSABLE)].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        !element.matches(":disabled") &&
        element.getClientRects().length > 0,
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  });
}
