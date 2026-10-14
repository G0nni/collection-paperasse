import { describe, expect, it } from "vitest";
import {
  COLLECTION_BASE,
  ORIGIN_ENV,
  SITE,
  baseFor,
  collectionSource,
  cspDirectives,
  siteOrigin,
} from "./config";

describe("baseFor", () => {
  it("met le lookbook à la racine et chaque look dans son sous-dossier", () => {
    expect(baseFor(null)).toBe("/collection-paperasse/");
    expect(baseFor("jure-crache")).toBe("/collection-paperasse/jure-crache/");
  });
});

describe("siteOrigin", () => {
  it("vaut l'origine de production quand la variable est absente ou vide", () => {
    expect(siteOrigin({})).toBe(SITE);
    expect(siteOrigin({ [ORIGIN_ENV]: "" })).toBe(SITE);
  });

  it("accepte une origine https ou une origine http locale (e2e)", () => {
    expect(siteOrigin({ [ORIGIN_ENV]: "https://exemple.fr" })).toBe("https://exemple.fr");
    expect(siteOrigin({ [ORIGIN_ENV]: "http://127.0.0.1:4321" })).toBe("http://127.0.0.1:4321");
    expect(siteOrigin({ [ORIGIN_ENV]: "http://localhost:4321" })).toBe("http://localhost:4321");
  });

  it("refuse le http distant : la CSP autoriserait des scripts interceptables", () => {
    expect(() => siteOrigin({ [ORIGIN_ENV]: "http://exemple.fr" })).toThrow(/https/u);
  });

  it("refuse tout ce qui n'est pas une origine nue", () => {
    for (const value of [
      "pas une url",
      "https://exemple.fr/",
      "https://exemple.fr/chemin",
      "https://exemple.fr?x=1",
      "https://moi:secret@exemple.fr",
      "https://exemple.fr; script-src *",
      // Assemblé en morceaux : no-script-url refuse le littéral, même dans un test.
      ["javascript", "alert(1)"].join(":"),
      "data:text/html,x",
    ]) {
      expect(() => siteOrigin({ [ORIGIN_ENV]: value }), value).toThrow();
    }
  });
});

describe("cspDirectives", () => {
  it("restreint polices et images au préfixe de la collection, sans data:", () => {
    const directives = cspDirectives(SITE);
    expect(directives).toContain("img-src https://g0nni.github.io/collection-paperasse/");
    expect(directives).toContain("font-src https://g0nni.github.io/collection-paperasse/");
    expect(directives.join(";")).not.toContain("data:");
  });

  it("garde les garde-fous de base", () => {
    expect(cspDirectives(SITE)).toEqual(
      expect.arrayContaining(["default-src 'self'", "object-src 'none'", "base-uri 'self'"]),
    );
  });

  it("n'autorise jamais d'inline ni d'eval", () => {
    expect(cspDirectives(SITE).join(";")).not.toMatch(/unsafe-/u);
  });
});

describe("collectionSource", () => {
  it("termine par le sous-chemin de la collection (correspondance par préfixe en CSP)", () => {
    expect(collectionSource("http://127.0.0.1:4321")).toBe(
      `http://127.0.0.1:4321${COLLECTION_BASE}`,
    );
  });
});
