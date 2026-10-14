// Tests unitaires de l'agent tester (specs/lookbook.md). Ils complètent catalog.test.ts.
// Tour 2 : les tests de l'étiquette (tagFor) ont été déplacés dans
// packages/shared/src/looks.test.ts, et l'oracle typographique est désormais l'unique oracle
// partagé (packages/shared/src/typography.ts), à la demande du reviewer.
import { findTypographyIssues } from "@paperasse/shared/typography";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog";
import { PAGE_TEXT } from "./page-text";

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
    expect(findTypographyIssues(`un${EM_DASH}deux`).map((issue) => issue.kind)).toContain(
      "em-dash",
    );
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
