import { describe, expect, it } from "vitest";
import { findTypographyIssues } from "./typography";

const NBSP = String.fromCodePoint(0xa0);
const NARROW_NBSP = String.fromCodePoint(0x202f);

describe("findTypographyIssues", () => {
  it("accepte un texte correct", () => {
    expect(findTypographyIssues(`Prix${NBSP}: un kebab${NBSP}! «${NBSP}Oui${NBSP}»`)).toEqual([]);
  });

  it("accepte l'espace fine insécable", () => {
    expect(findTypographyIssues(`Vraiment${NARROW_NBSP}?`)).toEqual([]);
  });

  it("refuse le tiret cadratin", () => {
    expect(findTypographyIssues(`Un look ${String.fromCodePoint(0x2014)} deux looks`)).toContain(
      "em-dash",
    );
  });

  it("refuse une espace sécable avant la ponctuation haute", () => {
    for (const mark of [":", ";", "!", "?", "»"]) {
      expect(findTypographyIssues(`Texte ${mark}`)).toContain("space-before-high-punctuation");
    }
  });

  it("refuse une ponctuation haute collée au mot", () => {
    expect(findTypographyIssues("Prix: rien")).toContain("missing-space-before-high-punctuation");
    expect(findTypographyIssues("Vraiment?")).toContain("missing-space-before-high-punctuation");
  });

  it("tolère les deux-points d'une heure ou d'une URL", () => {
    expect(findTypographyIssues("À 14:30 sur https://exemple.fr")).toEqual([]);
  });

  it("refuse les guillemets sans espace insécable à l'intérieur", () => {
    expect(findTypographyIssues(`«Oui${NBSP}»`)).toContain("missing-space-inside-quotes");
    expect(findTypographyIssues(`« Oui${NBSP}»`)).toContain("space-inside-quotes");
  });
});
