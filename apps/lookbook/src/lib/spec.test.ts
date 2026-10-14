// Tests unitaires de l'agent tester (specs/lookbook.md). Ils complètent catalog.test.ts.
// Tour 2 : les tests de l'étiquette (tagFor) ont été déplacés dans
// packages/shared/src/looks.test.ts, et l'oracle typographique est désormais l'unique oracle
// partagé (packages/shared/src/typography.ts), à la demande du reviewer.
// Tour 3 (builder, à la demande du reviewer) : les tests de l'oracle qui doublaient
// packages/shared/src/typography.test.ts et typography.tester.test.ts ont été retirés.
import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog";
import { PAGE_TEXT } from "./page-text";

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

describe("textes du lookbook · caractères interdits", () => {
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
