import { describe, expect, expectTypeOf, it } from "vitest";
import { COLLECTION_BASE } from "./config";
import {
  COLLECTION_LABEL,
  LOOKS,
  TAG_SEPARATOR,
  formatLookNumber,
  tagFor,
  type LookSlug,
} from "./looks";
import { findTypographyIssues, formatTypographyIssue } from "./typography";

const NBSP = String.fromCodePoint(0xa0);

describe("LOOKS", () => {
  it("garde 3 looks par collection, dans l'ordre du défilé", () => {
    expect(LOOKS.map((look) => [look.number, look.slug])).toEqual([
      [1, "reunion-metre"],
      [2, "jure-crache"],
      [3, "sav-de-ta-vie"],
    ]);
  });

  it("expose les slugs comme un type fermé", () => {
    expectTypeOf<LookSlug>().toEqualTypeOf<"reunion-metre" | "jure-crache" | "sav-de-ta-vie">();
  });
});

describe("formatLookNumber", () => {
  it("écrit le numéro sur deux chiffres", () => {
    expect(formatLookNumber(1)).toBe("01");
    expect(formatLookNumber(3)).toBe("03");
    expect(formatLookNumber(12)).toBe("12");
  });
});

// specs/lookbook.md, « Le CollectionTag » :
//   looks 01 et 02 : COLLECTION PAPERASSE · AH26 · LOOK 01/03 · Suivant : Juré Craché →
//   look 03 : COLLECTION PAPERASSE · AH26 · LOOK 03/03 · Retour au lookbook →
// Les majuscules viennent du CSS du composant, la flèche et les « · » du gabarit.
describe("tagFor (CollectionTag)", () => {
  it("CA-5 · Look 01 : marque, position et « Suivant : Juré Craché » avec insécable", () => {
    expect(tagFor("reunion-metre")).toEqual({
      brand: { text: "Collection Paperasse · AH26", href: COLLECTION_BASE },
      position: "Look 01/03",
      next: { text: `Suivant${NBSP}: Juré Craché`, href: `${COLLECTION_BASE}jure-crache/` },
    });
  });

  it("CA-5 · Look 02 : « Suivant : Le SAV de ta vie »", () => {
    expect(tagFor("jure-crache")).toEqual({
      brand: { text: COLLECTION_LABEL, href: COLLECTION_BASE },
      position: "Look 02/03",
      next: { text: `Suivant${NBSP}: Le SAV de ta vie`, href: `${COLLECTION_BASE}sav-de-ta-vie/` },
    });
  });

  it("CA-5 · Look 03 : « Retour au lookbook », vers la racine de la collection", () => {
    expect(tagFor("sav-de-ta-vie")).toEqual({
      brand: { text: COLLECTION_LABEL, href: COLLECTION_BASE },
      position: "Look 03/03",
      next: { text: "Retour au lookbook", href: COLLECTION_BASE },
    });
  });

  it("CA-5 · numérote chaque look « Look 0N/03 » dans l'ordre du défilé", () => {
    expect(LOOKS.map((look) => tagFor(look.slug).position)).toEqual([
      "Look 01/03",
      "Look 02/03",
      "Look 03/03",
    ]);
  });

  it("CA-5 · le lien « suivant » va au look suivant, le dernier au lookbook", () => {
    expect(LOOKS.map((look) => tagFor(look.slug).next.href)).toEqual([
      `${COLLECTION_BASE}jure-crache/`,
      `${COLLECTION_BASE}sav-de-ta-vie/`,
      COLLECTION_BASE,
    ]);
    for (const look of LOOKS) {
      expect(tagFor(look.slug).brand.href).toBe(COLLECTION_BASE);
    }
  });

  it("CA-5 · les looks 01 et 02 affichent « suivant » comme dans la spec", () => {
    for (const look of LOOKS.slice(0, 2)) {
      expect(tagFor(look.slug).next.text).toMatch(/^suivant\b/iu);
    }
  });

  it("CA-5 · les textes de l'étiquette respectent la typographie française", () => {
    for (const look of LOOKS) {
      const tag = tagFor(look.slug);
      for (const text of [tag.brand.text, tag.position, tag.next.text]) {
        expect(findTypographyIssues(text).map(formatTypographyIssue), JSON.stringify(text)).toEqual(
          [],
        );
      }
    }
  });

  it("utilise le point médian comme séparateur visible", () => {
    expect(TAG_SEPARATOR).toBe("·");
  });
});
