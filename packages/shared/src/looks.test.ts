import { describe, expect, it } from "vitest";
import { COLLECTION_BASE } from "./config";
import { LOOKS, tagFor } from "./looks";

describe("tagFor", () => {
  it("numérote les looks et pointe vers le suivant", () => {
    expect(tagFor("reunion-metre")).toEqual({
      label: "Look 01/03",
      nextHref: `${COLLECTION_BASE}jure-crache/`,
      nextLabel: "Suivant : Juré Craché",
      lookbookHref: COLLECTION_BASE,
    });
  });

  it("renvoie le dernier look vers le lookbook", () => {
    const last = LOOKS[LOOKS.length - 1];
    expect(last).toBeDefined();
    if (last !== undefined) {
      expect(tagFor(last.slug).nextHref).toBe(COLLECTION_BASE);
    }
  });

  it("refuse un look inconnu", () => {
    expect(() => tagFor("inconnu")).toThrow();
  });

  it("garde 3 looks par collection", () => {
    expect(LOOKS).toHaveLength(3);
  });
});
