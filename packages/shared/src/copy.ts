// « Copier le lien », commun aux looks (Réunion-mètre CA-7, Juré Craché CA-7) : presse-papiers,
// sinon un <dialog> modal avec le lien sélectionné. La confirmation s'écrit dans une région
// polie à côté du bouton, jamais par-dessus le document.
//
// Les types ne retiennent que ce que le copieur utilise des éléments : un HTMLElement, un
// HTMLDialogElement et un HTMLInputElement conviennent, et les tests unitaires passent des
// doublures sans DOM.

/** Région `aria-live="polite"` à côté des boutons de copie. */
export type CopyStatus = { textContent: string | null };

export type CopyDialog = {
  readonly open: boolean;
  showModal(): void;
  close(): void;
  addEventListener(type: "close", listener: () => void): void;
};

export type CopyField = { value: string; focus(): void; select(): void };

/** Bouton qui a demandé la copie : il reprend le focus quand le repli se ferme. */
export type CopyOpener = {
  readonly isConnected: boolean;
  /** `boolean`, ou « until-found » (masqué aussi) dans les DOM récents. */
  readonly hidden: boolean | string;
  focus(): void;
};

export type CopyView = {
  readonly status: CopyStatus;
  readonly dialog: CopyDialog;
  readonly field: CopyField;
};

/** Presse-papiers, injecté pour les tests ; par défaut celui du navigateur. */
export type WriteText = ((text: string) => Promise<void>) | undefined;

export type Copier = {
  /** Efface la confirmation et referme le repli (changement d'écran). */
  readonly clear: () => void;
  /**
   * Efface la seule confirmation : le lien a changé, le presse-papiers contient l'ancien. Le
   * repli, modal, ne peut pas être ouvert pendant une modification.
   */
  readonly clearStatus: () => void;
  readonly copy: (link: string, opener: CopyOpener) => Promise<void>;
};

/** `writeText` du navigateur, lié à son objet, ou `undefined` hors contexte sécurisé. */
function browserWriteText(): WriteText {
  // Absent hors contexte sécurisé (http://, certains navigateurs intégrés) malgré le typage.
  const clipboard: Clipboard | undefined = globalThis.navigator?.clipboard;
  if (typeof clipboard?.writeText !== "function") return undefined;
  return (text) => clipboard.writeText(text);
}

export function createCopier(
  view: CopyView,
  copiedText: string,
  writeText: () => WriteText = browserWriteText,
): Copier {
  /** Bouton qui a ouvert le repli : il reprend le focus à la fermeture. */
  let opener: CopyOpener | null = null;

  // « Fermer » (formulaire method="dialog") et Échap passent tous deux par `close`.
  view.dialog.addEventListener("close", () => {
    view.field.value = "";
    const target = opener;
    opener = null;
    // Le bouton a pu disparaître entre-temps (changement d'écran) : on ne force rien.
    if (target !== null && target.isConnected && !target.hidden) target.focus();
  });

  const clearStatus = () => {
    view.status.textContent = "";
  };

  const clear = () => {
    clearStatus();
    if (view.dialog.open) view.dialog.close();
  };

  const copy = async (link: string, from: CopyOpener) => {
    // Vidée avant l'attente du presse-papiers : un second clic écrit à nouveau la confirmation,
    // et la région live l'annonce à nouveau.
    clear();
    try {
      const write = writeText();
      // Absent hors contexte sécurisé : traité comme un refus.
      if (write === undefined) throw new Error("Presse-papiers absent");
      await write(link);
      view.status.textContent = copiedText;
    } catch {
      opener = from;
      view.field.value = link;
      view.dialog.showModal();
      view.field.focus();
      view.field.select();
    }
  };

  return { clear, clearStatus, copy };
}
