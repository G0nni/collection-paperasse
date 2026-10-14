import { describe, expect, it } from "vitest";
import { findTypographyIssues, formatTypographyIssue } from "./typography";

const NBSP = String.fromCodePoint(0xa0);
const NARROW_NBSP = String.fromCodePoint(0x202f);
const THIN_SPACE = String.fromCodePoint(0x2009);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const EM_DASH = String.fromCodePoint(0x2014);

const kinds = (text: string) => findTypographyIssues(text).map((issue) => issue.kind);

describe("findTypographyIssues · textes corrects", () => {
  it("accepte l'insécable avant « : ; ! ? » et dans les guillemets", () => {
    expect(
      findTypographyIssues(`Prix${NBSP}: un kebab${NBSP}! Ah${NBSP}; «${NBSP}Oui${NBSP}»${NBSP}?`),
    ).toEqual([]);
  });

  it("accepte l'espace fine insécable", () => {
    expect(findTypographyIssues(`Vraiment${NARROW_NBSP}?`)).toEqual([]);
    expect(findTypographyIssues(`«${NARROW_NBSP}Oui${NARROW_NBSP}»`)).toEqual([]);
  });

  it("accepte « ?! » quand seul le premier signe porte l'insécable", () => {
    expect(findTypographyIssues(`Quoi${NBSP}?!`)).toEqual([]);
    expect(findTypographyIssues(`Non${NBSP}!!!`)).toEqual([]);
  });

  it("tolère les deux-points d'une heure et la ponctuation d'une URL", () => {
    expect(findTypographyIssues("À 14:30 sur https://exemple.fr/?q=1!")).toEqual([]);
  });

  it("ignore un signe en tout début de texte (rien à vérifier avant)", () => {
    expect(findTypographyIssues(": suite")).toEqual([]);
  });

  it("accepte un texte sans ponctuation haute", () => {
    expect(findTypographyIssues("Collection Paperasse · AH26 · Look 01/03")).toEqual([]);
  });
});

describe("findTypographyIssues · espaces sécables refusées", () => {
  for (const mark of [":", ";", "!", "?", "»"]) {
    it(`refuse une espace normale avant « ${mark} »`, () => {
      expect(kinds(`Texte ${mark}`)).toEqual(["breaking-space"]);
    });
  }

  it("refuse l'espace fine sécable (U+2009) avant les deux-points", () => {
    expect(kinds(`Prix${THIN_SPACE}: rien`)).toEqual(["breaking-space"]);
  });

  it("refuse une tabulation ou un retour à la ligne avant la ponctuation haute", () => {
    expect(kinds("Vraiment\t!")).toEqual(["breaking-space"]);
    expect(kinds("Vraiment\n!")).toEqual(["breaking-space"]);
    expect(kinds("Prix\r\n: rien")).toEqual(["breaking-space"]);
  });

  it("refuse une espace sécable à l'intérieur des guillemets", () => {
    expect(kinds(`« Oui${NBSP}»`)).toEqual(["breaking-space"]);
    expect(kinds(`«${NBSP}Oui »`)).toEqual(["breaking-space"]);
    expect(kinds(`«${THIN_SPACE}Oui\t»`)).toEqual(["breaking-space", "breaking-space"]);
    expect(kinds(`«\nOui${NBSP}»`)).toEqual(["breaking-space"]);
  });
});

describe("findTypographyIssues · insécables manquantes", () => {
  it("refuse une ponctuation haute collée au mot", () => {
    expect(kinds("Prix: rien")).toEqual(["missing-nbsp"]);
    expect(kinds("Vraiment?")).toEqual(["missing-nbsp"]);
    expect(kinds("Ah; bon")).toEqual(["missing-nbsp"]);
  });

  it("refuse des guillemets collés au texte", () => {
    expect(kinds(`«Oui${NBSP}»`)).toEqual(["missing-nbsp"]);
    expect(kinds(`«${NBSP}Oui»`)).toEqual(["missing-nbsp"]);
  });

  it("refuse un guillemet ouvrant en fin de texte", () => {
    expect(kinds("Il a dit «")).toEqual(["missing-nbsp"]);
  });

  it("ne prend pas un caractère invisible pour une espace", () => {
    expect(kinds(`Prix${ZERO_WIDTH_SPACE}: rien`)).toEqual(["missing-nbsp"]);
  });
});

describe("findTypographyIssues · tiret cadratin", () => {
  it("refuse le tiret cadratin, entouré d'espaces ou collé aux mots", () => {
    expect(kinds(`Un look ${EM_DASH} deux looks`)).toEqual(["em-dash"]);
    expect(kinds(`un${EM_DASH}deux`)).toEqual(["em-dash"]);
  });
});

describe("findTypographyIssues · rapport", () => {
  it("donne le signe, sa position en points de code et un extrait lisible", () => {
    const [issue] = findTypographyIssues(`🧾 Prix : ${NBSP}rien`);
    expect(issue).toMatchObject({ kind: "breaking-space", mark: ":", index: 7 });
    expect(issue?.excerpt).toContain("Prix :");
    expect(issue?.excerpt).toContain("⍽");
  });

  it("trouve toutes les fautes d'un texte, dans l'ordre", () => {
    expect(findTypographyIssues("A: b ; c!").map((issue) => issue.mark)).toEqual([":", ";", "!"]);
  });

  it("formate un message en français", () => {
    const [issue] = findTypographyIssues("Prix: rien");
    expect(issue).toBeDefined();
    if (issue !== undefined) {
      expect(formatTypographyIssue(issue)).toBe(`insécable manquante près de « : » "Prix: rien"`);
    }
  });
});
