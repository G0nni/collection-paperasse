// « Copier le lien » (CA-7, spec « Écrans ») : presse-papiers, sinon un <dialog> modal avec le
// lien sélectionné. La confirmation s'écrit dans une région polie à côté du bouton, jamais
// par-dessus le ticket.
import { TEXT } from "../lib/messages";

export type CopyView = {
  /** Région `aria-live="polite"` à côté des boutons de copie. */
  readonly status: HTMLElement;
  readonly dialog: HTMLDialogElement;
  readonly field: HTMLInputElement;
};

export type Copier = {
  /** Efface la confirmation et referme le repli (changement d'écran). */
  readonly clear: () => void;
  /**
   * Efface la seule confirmation : le lien a changé, le presse-papiers contient l'ancien (spec,
   * « Écrans »). Le repli, modal, ne peut pas être ouvert pendant une modification.
   */
  readonly clearStatus: () => void;
  readonly copy: (link: string, opener: HTMLElement) => Promise<void>;
};

export function createCopier(view: CopyView): Copier {
  /** Bouton qui a ouvert le repli : il reprend le focus à la fermeture. */
  let opener: HTMLElement | null = null;

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

  const copy = async (link: string, from: HTMLElement) => {
    // Vidée avant l'attente du presse-papiers : un second clic écrit à nouveau la confirmation,
    // et la région live l'annonce à nouveau.
    clear();
    try {
      // Absent hors contexte sécurisé : traité comme un refus.
      if (typeof navigator.clipboard?.writeText !== "function") {
        throw new Error("Presse-papiers absent");
      }
      await navigator.clipboard.writeText(link);
      view.status.textContent = TEXT.copied;
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
