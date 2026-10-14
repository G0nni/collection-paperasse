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

  it("accepte une origine http locale avec un port explicite (e2e)", () => {
    for (const origin of [
      "http://127.0.0.1:4321",
      "http://localhost:4321",
      "http://[::1]:4321",
      "http://127.0.0.1:1",
      "http://127.0.0.1:65535",
    ]) {
      expect(siteOrigin({ [ORIGIN_ENV]: origin }), origin).toBe(origin);
    }
  });

  // security, tour 2, M1 : la valeur est recopiée telle quelle dans la meta CSP, qu'Astro
  // n'échappe pas.
  it("refuse tout le reste, y compris https et les caractères qui cassent la meta CSP", () => {
    for (const value of [
      // https : la production n'a pas besoin de la variable, les e2e tournent en local.
      "https://exemple.fr",
      "https://g0nni.github.io",
      "https://*",
      'https://a"b',
      "https://x;script-src",
      "https://exemple.fr; script-src *",
      "http://*:4321",
      'http://127.0.0.1:4321"',
      'http://127.0.0.1:4321" onload="x',
      "http://127.0.0.1:4321;script-src *",
      "http://127.0.0.1:4321 'unsafe-inline'",
      "http://127.0.0.1:4321'",
      "'self'",
      "'",
      " http://127.0.0.1:4321",
      "http://127.0.0.1:4321 ",
      "http://127.0.0.1:4321\n",
      "http://127.0.0.1:4321\t",
      "http:// 127.0.0.1:4321",
      // Hôte distant ou déguisé.
      "http://exemple.fr:4321",
      "http://127.0.0.1.exemple.fr:4321",
      "http://localhost.exemple.fr:4321",
      "http://127.0.0.2:4321",
      "http://0.0.0.0:4321",
      "http://[::ffff:127.0.0.1]:4321",
      "http://moi:secret@127.0.0.1:4321",
      // Port absent, nul, non numérique, hors bornes ou avec zéro de tête.
      "http://127.0.0.1",
      "http://localhost",
      "http://127.0.0.1:",
      "http://127.0.0.1:0",
      "http://127.0.0.1:04321",
      "http://127.0.0.1:abc",
      "http://127.0.0.1:65536",
      "http://127.0.0.1:999999",
      // Pas une origine nue.
      "http://127.0.0.1:4321/",
      "http://127.0.0.1:4321/chemin",
      "http://127.0.0.1:4321?x=1",
      "http://127.0.0.1:4321#x",
      "HTTP://LOCALHOST:4321",
      "pas une url",
      // Assemblé en morceaux : no-script-url refuse le littéral, même dans un test.
      ["javascript", "alert(1)"].join(":"),
      "data:text/html,x",
    ]) {
      expect(() => siteOrigin({ [ORIGIN_ENV]: value }), value).toThrow(ORIGIN_ENV);
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

  // security, tour 2, M2 : 'self' couvrirait tout g0nni.github.io.
  it("ferme tout le reste, sans aucun 'self'", () => {
    expect(cspDirectives(SITE)).toEqual([
      "default-src 'none'",
      "img-src https://g0nni.github.io/collection-paperasse/",
      "font-src https://g0nni.github.io/collection-paperasse/",
      "connect-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ]);
    expect(cspDirectives(SITE).join(";")).not.toContain("'self'");
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
