// Le copieur commun, avec des doublures d'éléments : pas de DOM dans les tests unitaires. Le
// comportement dans un vrai navigateur est couvert par les e2e de chaque look (CA-7).
import { describe, expect, it } from "vitest";
import { createCopier, type CopyOpener, type WriteText } from "./copy";

function fakeView() {
  const listeners: (() => void)[] = [];
  const events: string[] = [];
  const status: { textContent: string | null } = { textContent: "" };
  const dialog = {
    open: false,
    showModal() {
      dialog.open = true;
      events.push("showModal");
    },
    close() {
      dialog.open = false;
      events.push("close");
      // Comme le navigateur : l'événement close suit la fermeture.
      for (const listener of listeners) listener();
    },
    addEventListener(_type: "close", listener: () => void) {
      listeners.push(listener);
    },
  };
  const field = {
    value: "",
    focus: () => events.push("field.focus"),
    select: () => events.push("field.select"),
  };
  return { view: { status, dialog, field }, events };
}

function fakeOpener(events: string[], state: Partial<CopyOpener> = {}): CopyOpener {
  return {
    isConnected: state.isConnected ?? true,
    hidden: state.hidden ?? false,
    focus: () => events.push("opener.focus"),
  };
}

const LINK = "https://g0nni.github.io/collection-paperasse/jure-crache/#1.abc";

describe("createCopier", () => {
  it("presse-papiers accepté : copie le lien et écrit la confirmation", async () => {
    const { view, events } = fakeView();
    const written: string[] = [];
    const writeText: WriteText = async (text) => {
      written.push(text);
    };
    const copier = createCopier(view, "Lien copié.", () => writeText);
    await copier.copy(LINK, fakeOpener(events));
    expect(written).toEqual([LINK]);
    expect(view.status.textContent).toBe("Lien copié.");
    expect(view.dialog.open).toBe(false);
  });

  it("presse-papiers refusé : repli modal, champ rempli, focus et sélection", async () => {
    const { view, events } = fakeView();
    const copier = createCopier(view, "Lien copié.", () => () => Promise.reject(new Error("non")));
    await copier.copy(LINK, fakeOpener(events));
    expect(view.dialog.open).toBe(true);
    expect(view.field.value).toBe(LINK);
    expect(events).toEqual(["showModal", "field.focus", "field.select"]);
    expect(view.status.textContent).toBe("");
  });

  it("presse-papiers absent (hors contexte sécurisé) : même repli", async () => {
    const { view } = fakeView();
    const copier = createCopier(view, "Lien copié.", () => undefined);
    await copier.copy(LINK, fakeOpener([]));
    expect(view.dialog.open).toBe(true);
  });

  it("fermer le repli vide le champ et rend le focus au bouton", async () => {
    const { view, events } = fakeView();
    const copier = createCopier(view, "Lien copié.", () => undefined);
    await copier.copy(LINK, fakeOpener(events));
    view.dialog.close();
    expect(view.field.value).toBe("");
    expect(events.at(-1)).toBe("opener.focus");
  });

  it("bouton masqué ou retiré entre-temps : le focus n'est pas forcé", async () => {
    for (const state of [{ hidden: true }, { isConnected: false }]) {
      const { view, events } = fakeView();
      const copier = createCopier(view, "Lien copié.", () => undefined);
      await copier.copy(LINK, fakeOpener(events, state));
      view.dialog.close();
      expect(events).not.toContain("opener.focus");
    }
  });

  it("clear efface la confirmation et referme le repli ; clearStatus ne touche qu'au texte", async () => {
    const { view } = fakeView();
    const writeText: WriteText = async () => undefined;
    const copier = createCopier(view, "Lien copié.", () => writeText);
    await copier.copy(LINK, fakeOpener([]));
    copier.clearStatus();
    expect(view.status.textContent).toBe("");

    const refused = fakeView();
    const fallback = createCopier(refused.view, "Lien copié.", () => undefined);
    await fallback.copy(LINK, fakeOpener([]));
    fallback.clearStatus();
    expect(refused.view.dialog.open).toBe(true);
    fallback.clear();
    expect(refused.view.dialog.open).toBe(false);
  });

  it("un second clic vide d'abord la confirmation (la région live réannonce)", async () => {
    const { view } = fakeView();
    const seen: (string | null)[] = [];
    const writeText: WriteText = async () => {
      seen.push(view.status.textContent);
    };
    const copier = createCopier(view, "Lien copié.", () => writeText);
    await copier.copy(LINK, fakeOpener([]));
    await copier.copy(LINK, fakeOpener([]));
    expect(seen).toEqual(["", ""]);
    expect(view.status.textContent).toBe("Lien copié.");
  });
});
