// Tests unitaires de l'agent tester (specs/lookbook.md). Ils complètent catalog.test.ts et
// typography.test.ts : étiquette de collection et solidité du vérificateur typographique.
import { COLLECTION_BASE } from "@paperasse/shared/config";
import { LOOKS, tagFor } from "@paperasse/shared/looks";
import { describe, expect, it } from "vitest";
import { buildCatalog, PAGE_TEXT } from "./catalog";
import { findTypographyIssues } from "./typography";

const NBSP = String.fromCodePoint(0xa0);
const NARROW_NBSP = String.fromCodePoint(0x202f);
const THIN_SPACE = String.fromCodePoint(0x2009);
const EM_DASH = String.fromCodePoint(0x2014);

/** Contrôles C0/C1, zéro-largeur et marques bidirectionnelles (CLAUDE.md, Sécurité). */
const FORBIDDEN = new RegExp(
  `[${[
    [0x00, 0x1f],
    [0x7f, 0x9f],
    [0x200b, 0x200f],
    [0x202a, 0x202e],
    [0x2066, 0x2069],
  ]
    .map(([from = 0, to = 0]) => `\\u{${from.toString(16)}}-\\u{${to.toString(16)}}`)
    .join("")}]`,
  "u",
);

describe("CollectionTag (tagFor)", () => {
  it("CA-5 · numérote chaque look « Look 0N/03 » dans l'ordre du défilé", () => {
    expect(LOOKS.map((look) => tagFor(look.slug).label)).toEqual([
      "Look 01/03",
      "Look 02/03",
      "Look 03/03",
    ]);
  });

  it("CA-5 · le lien « suivant » va au look suivant, le dernier au lookbook", () => {
    expect(LOOKS.map((look) => tagFor(look.slug).nextHref)).toEqual([
      `${COLLECTION_BASE}jure-crache/`,
      `${COLLECTION_BASE}sav-de-ta-vie/`,
      COLLECTION_BASE,
    ]);
    for (const look of LOOKS) {
      expect(tagFor(look.slug).lookbookHref).toBe(COLLECTION_BASE);
    }
  });

  it("CA-5 · les looks 01 et 02 affichent « suivant » comme dans la spec", () => {
    for (const look of LOOKS.slice(0, 2)) {
      expect(tagFor(look.slug).nextLabel).toMatch(/^suivant\b/iu);
    }
  });

  it("CA-5 · les textes de l'étiquette respectent la typographie française", () => {
    for (const look of LOOKS) {
      const tag = tagFor(look.slug);
      for (const text of [tag.label, tag.nextLabel]) {
        expect(findTypographyIssues(text), JSON.stringify(text)).toEqual([]);
      }
    }
  });
});

describe("findTypographyIssues : ce qu'un oracle typographique doit attraper", () => {
  it("refuse une espace fine sécable (U+2009) avant les deux-points", () => {
    expect(findTypographyIssues(`Prix${THIN_SPACE}: rien`)).not.toEqual([]);
  });

  it("refuse une tabulation ou un retour à la ligne avant un point d'exclamation", () => {
    expect(findTypographyIssues("Vraiment\t!")).not.toEqual([]);
    expect(findTypographyIssues("Vraiment\n!")).not.toEqual([]);
  });

  it("accepte « ?! » quand seul le premier signe porte l'insécable", () => {
    expect(findTypographyIssues(`Quoi${NBSP}?!`)).toEqual([]);
  });

  it("accepte l'espace fine insécable dans les guillemets", () => {
    expect(findTypographyIssues(`«${NARROW_NBSP}Oui${NARROW_NBSP}»`)).toEqual([]);
  });

  it("refuse le tiret cadratin même collé aux mots", () => {
    expect(findTypographyIssues(`un${EM_DASH}deux`)).toContain("em-dash");
  });

  it("refuse un « » ouvrant suivi d'une espace sécable", () => {
    expect(findTypographyIssues(`« Oui${NBSP}»`)).not.toEqual([]);
  });
});

describe("textes du lookbook face à l'oracle", () => {
  it("aucun texte ne contient de caractère de contrôle ou bidirectionnel", () => {
    const texts = [
      ...Object.values(PAGE_TEXT).flat(),
      ...buildCatalog().flatMap((card) => [
        card.tagline,
        card.previewLabel,
        card.linkLabel,
        ...card.sheet.map((entry) => entry.value),
      ]),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(FORBIDDEN);
    }
  });
});
