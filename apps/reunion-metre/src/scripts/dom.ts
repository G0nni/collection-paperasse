// Petits outils DOM du look. Texte toujours écrit en textContent (CLAUDE.md, Sécurité).

/** Élément de la page, du type attendu, sinon une erreur claire (la page est cassée). */
export function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) throw new Error(`Élément #${id} introuvable.`);
  return element;
}

/** Emplacement `data-slot` d'une ligne clonée depuis un <template>. */
export function slot<T extends HTMLElement>(root: ParentNode, name: string, type: new () => T): T {
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
