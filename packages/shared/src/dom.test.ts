// Seule la partie sans document se teste ici (pas d'environnement DOM dans Vitest) : byId, slot,
// fillList et trapFocus sont couverts par les e2e des looks (écrans, lignes clonées, focus
// piégé des boîtes de dialogue de Juré Craché).
import { describe, expect, it } from "vitest";
import { FOCUSABLE, setText } from "./dom";

describe("setText", () => {
  it("écrit le texte tel quel, sans l'interpréter", () => {
    const node = { textContent: "" };
    setText(node, "<img src=x onerror=alert(1)>");
    expect(node.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("n'écrit pas un texte identique (une région live ne le réannonce pas)", () => {
    let writes = 0;
    let value: string | null = "03";
    const node = {
      get textContent() {
        return value;
      },
      set textContent(text: string | null) {
        writes += 1;
        value = text;
      },
    };
    setText(node, "03");
    expect(writes).toBe(0);
    setText(node, "04");
    expect(writes).toBe(1);
    expect(value).toBe("04");
  });
});

describe("FOCUSABLE", () => {
  it("boutons, champs, liens réels et tabindex positifs ; jamais tabindex=-1", () => {
    for (const part of ["button", "input", "textarea", "select", "a[href]"]) {
      expect(FOCUSABLE).toContain(part);
    }
    expect(FOCUSABLE).toContain("[tabindex]:not([tabindex='-1'])");
  });
});
