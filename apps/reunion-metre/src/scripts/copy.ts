// « Copier le lien » (CA-7) : presse-papiers, sinon le lien dans un champ sélectionné.
import { TEXT } from "../lib/messages";

export type CopyView = {
  /** Région `aria-live="polite"` : confirmation ou refus. */
  readonly status: HTMLElement;
  readonly fallback: HTMLElement;
  readonly field: HTMLInputElement;
};

export function clearCopyFeedback(view: CopyView): void {
  view.status.textContent = "";
  view.fallback.hidden = true;
  view.field.value = "";
}

export async function copyLink(view: CopyView, link: string): Promise<void> {
  // Vidée avant l'attente du presse-papiers : un second clic écrit à nouveau la confirmation,
  // et la région live l'annonce à nouveau.
  clearCopyFeedback(view);
  try {
    // Absent hors contexte sécurisé : traité comme un refus.
    if (typeof navigator.clipboard?.writeText !== "function") {
      throw new Error("Presse-papiers absent");
    }
    await navigator.clipboard.writeText(link);
    view.status.textContent = TEXT.copied;
  } catch {
    view.field.value = link;
    view.fallback.hidden = false;
    view.status.textContent = TEXT.copyRefused;
    view.field.focus();
    view.field.select();
  }
}
