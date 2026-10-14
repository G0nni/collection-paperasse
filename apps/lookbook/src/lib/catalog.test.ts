import { COLLECTION_BASE } from "@paperasse/shared/config";
import { LOOKS } from "@paperasse/shared/looks";
import { describe, expect, it } from "vitest";
import { buildCatalog, formatLookNumber, LOOK_CONTENT, PAGE_TEXT } from "./catalog";
import { findTypographyIssues } from "./typography";

const NON_BREAKING_SPACES = new RegExp(
  `[${String.fromCodePoint(0xa0)}${String.fromCodePoint(0x202f)}]`,
  "gu",
);

/** Les espaces insécables comptent comme des espaces quand on compare au texte de la spec. */
function normalizeSpaces(text: string): string {
  return text.replace(NON_BREAKING_SPACES, " ");
}

describe("formatLookNumber", () => {
  it("écrit le numéro sur deux chiffres", () => {
    expect(formatLookNumber(1)).toBe("01");
    expect(formatLookNumber(3)).toBe("03");
    expect(formatLookNumber(12)).toBe("12");
  });
});

describe("buildCatalog", () => {
  const catalog = buildCatalog();

  it("contient les trois looks dans l'ordre du défilé", () => {
    expect(catalog.map((card) => card.label)).toEqual(["Look 01", "Look 02", "Look 03"]);
    expect(catalog.map((card) => card.name)).toEqual([
      "Réunion-mètre",
      "Juré Craché",
      "Le SAV de ta vie",
    ]);
  });

  // CA-1 : chaque lien mène à la bonne app, sous la base de la collection.
  it("fait pointer chaque lien vers son app, sous la base de la collection", () => {
    expect(catalog.map((card) => card.href)).toEqual([
      "/collection-paperasse/reunion-metre/",
      "/collection-paperasse/jure-crache/",
      "/collection-paperasse/sav-de-ta-vie/",
    ]);
    for (const card of catalog) {
      expect(card.href.startsWith(COLLECTION_BASE)).toBe(true);
      expect(card.href.endsWith(`/${card.slug}/`)).toBe(true);
    }
  });

  it("garde « Look 0X » dans le texte du lien (le test e2e commun le cherche)", () => {
    catalog.forEach((card, index) => {
      expect(card.linkText).toContain(`Look 0${index + 1}`);
      // Le nom accessible commence par le texte visible (WCAG 2.5.3, label dans le nom).
      expect(card.linkLabel.startsWith(card.linkText)).toBe(true);
      expect(card.linkLabel).toContain(card.name);
    });
  });

  it("reprend mot pour mot les fiches défilé de la spec", () => {
    const sheets = catalog.map((card) =>
      card.sheet.map((entry) => `${entry.term} : ${normalizeSpaces(entry.value)}`),
    );
    expect(sheets).toEqual([
      [
        "Matière : papier thermique 80 mm",
        "Coupe : en temps réel",
        "Prix : 0 € (mais la réunion, elle, coûte cher)",
      ],
      ["Matière : papier vergé, cire", "Coupe : notariale", "Prix : un kebab, selon l'issue"],
      [
        "Matière : papier listing 132 colonnes",
        "Coupe : en file d'attente",
        "Prix : 0 €, SLA non garanti",
      ],
    ]);
  });

  it("associe à chaque look l'aperçu de son document", () => {
    expect(catalog.map((card) => card.preview)).toEqual(["ticket", "acte", "listing"]);
    for (const card of catalog) {
      expect(card.previewLabel.length).toBeGreaterThan(10);
      expect(card.tagline.length).toBeGreaterThan(10);
    }
  });

  it("a une fiche pour chaque look de la collection", () => {
    for (const look of LOOKS) {
      expect(LOOK_CONTENT[look.slug]).toBeDefined();
    }
  });

  it("arrête le build si un look n'a pas de fiche", () => {
    expect(() => buildCatalog([{ number: 4, slug: "inconnu", name: "Inconnu" }])).toThrow(
      /inconnu/,
    );
  });
});

describe("textes de la page", () => {
  it("contient l'en-tête et le pied de page demandés par la spec", () => {
    expect(PAGE_TEXT.posterTitle.join(" ")).toBe("Collection Paperasse");
    expect(PAGE_TEXT.season).toContain("Automne-Hiver 2026");
    expect(PAGE_TEXT.rule).toBe("Trois documents officiels. Aucune valeur. Zéro inscription.");
    expect(PAGE_TEXT.privacy.join(" ")).toBe("Aucun cookie, aucun compte, aucun serveur.");
    expect(
      normalizeSpaces(`${PAGE_TEXT.nextCollection} ${PAGE_TEXT.nextCollectionDetail}`),
    ).toMatch(/^Prochaine collection : bientôt\./);
  });

  it("respecte la typographie française partout (insécables, pas de tiret cadratin)", () => {
    const texts: string[] = [
      ...Object.values(PAGE_TEXT).flat(),
      ...buildCatalog().flatMap((card) => [
        card.name,
        card.label,
        card.linkText,
        card.linkLabel,
        card.tagline,
        card.previewLabel,
        ...card.sheet.map((entry) => entry.value),
      ]),
    ];
    for (const text of texts) {
      expect(findTypographyIssues(text), text).toEqual([]);
    }
  });
});
