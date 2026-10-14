import { COLLECTION_BASE } from "@paperasse/shared/config";
import { LOOKS, type LookSlug } from "@paperasse/shared/looks";
import { NBSP, findTypographyIssues, formatTypographyIssue } from "@paperasse/shared/typography";
import { describe, expect, expectTypeOf, it } from "vitest";
import { buildCatalog, LOOK_CONTENT } from "./catalog";
import { PAGE_TEXT } from "./page-text";

/**
 * L'insécable compte comme une espace quand on compare au texte de la spec. U+00A0 seule
 * (specs/lookbook.md) : une U+202F ferait échouer la comparaison.
 */
function normalizeSpaces(text: string): string {
  return text.replaceAll(NBSP, " ");
}

/** Fautes typographiques d'un texte, sous forme de messages lisibles. */
function typographyErrors(text: string): string[] {
  return findTypographyIssues(text).map(formatTypographyIssue);
}

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
  it("CA-1 · fait pointer chaque lien vers son app, sous la base de la collection", () => {
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

  it("donne au lien un nom accessible qui commence par son texte visible (WCAG 2.5.3)", () => {
    for (const card of catalog) {
      expect(card.linkLabel.startsWith(card.linkText)).toBe(true);
      expect(card.linkLabel).toContain(card.name);
    }
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

  it("associe à chaque look l'aperçu de son document, nommé pour les lecteurs d'écran", () => {
    expect(catalog.map((card) => card.preview)).toEqual(["ticket", "acte", "listing"]);
    for (const card of catalog) {
      expect(card.previewLabel).toMatch(/^Aperçu\s?: /u);
    }
  });

  it("donne à chaque look une accroche propre : des phrases complètes, courtes, distinctes", () => {
    const taglines = catalog.map((card) => card.tagline);
    expect(new Set(taglines).size).toBe(taglines.length);
    for (const card of catalog) {
      expect(card.tagline).toMatch(/^\p{Lu}.*\.$/u);
      expect(card.tagline).not.toContain(card.name);
      expect(card.tagline.length).toBeGreaterThanOrEqual(40);
      expect(card.tagline.length).toBeLessThanOrEqual(120);
    }
  });

  it("a une fiche pour chaque look de la collection, garantie par le type", () => {
    expectTypeOf<keyof typeof LOOK_CONTENT>().toEqualTypeOf<LookSlug>();
    for (const look of LOOKS) {
      expect(LOOK_CONTENT[look.slug].sheet).toHaveLength(3);
    }
  });
});

describe("textes de la page", () => {
  it("contient l'en-tête et le pied de page demandés par la spec", () => {
    expect(PAGE_TEXT.posterTitle.join(" ")).toBe("Collection Paperasse");
    expect(PAGE_TEXT.season).toBe("Défilé Automne-Hiver 2026.");
    expect(PAGE_TEXT.rule).toBe("Trois documents officiels. Aucune valeur. Zéro inscription.");
    expect(PAGE_TEXT.privacy.join(" ")).toBe("Aucun cookie, aucun compte, aucun serveur.");
    expect(
      normalizeSpaces(`${PAGE_TEXT.nextCollection} ${PAGE_TEXT.nextCollectionDetail}`),
    ).toMatch(/^Prochaine collection : bientôt\./u);
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
      expect(typographyErrors(text), text).toEqual([]);
    }
  });
});
