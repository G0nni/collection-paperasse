// Tests de l'agent tester (tour 3) : PAPERASSE_ORIGIN, seule entrée du build, est recopiée telle
// quelle dans la meta CSP (CLAUDE.md, Sécurité : « Toute donnée venant de l'URL ou du
// localStorage est hostile » ; même traitement ici pour l'environnement du build). Liste de la
// méthode du tester : absente, vide, mauvais type, hors bornes, trop longue, HTML/JS, unicode
// exotique. Les cas déjà couverts par config.test.ts (builder) ne sont pas répétés.
// Tous les caractères spéciaux passent par String.fromCodePoint (pas de littéral invisible).
import { describe, expect, it } from "vitest";
import { ORIGIN_ENV, SITE, cspDirectives, siteOrigin } from "./config";
import { lookConfig } from "./look-config";

const cp = (code: number) => String.fromCodePoint(code);
const LOCAL = "http://127.0.0.1:4321";

describe("PAPERASSE_ORIGIN · absente ou vide : la production", () => {
  it("clé absente, clé présente mais undefined, chaîne vide", () => {
    expect(siteOrigin({})).toBe(SITE);
    expect(siteOrigin({ [ORIGIN_ENV]: undefined })).toBe(SITE);
    expect(siteOrigin({ [ORIGIN_ENV]: "" })).toBe(SITE);
  });

  it("une variable voisine au nom proche n'est pas lue", () => {
    expect(siteOrigin({ paperasse_origin: "https://*", PAPERASSE_ORIGIN_: "https://*" })).toBe(
      SITE,
    );
  });
});

describe("PAPERASSE_ORIGIN · valeurs refusées", () => {
  const refused: readonly { name: string; value: string }[] = [
    // Blancs seuls : ni vide (production) ni origine.
    { name: "espace seule", value: " " },
    { name: "tabulation seule", value: "\t" },
    // Mauvais type (tout arrive en chaîne dans l'environnement).
    { name: "nombre", value: "4321" },
    { name: "booléen", value: "true" },
    { name: "undefined en texte", value: "undefined" },
    { name: "JSON", value: JSON.stringify({ origin: LOCAL }) },
    // Hors bornes.
    { name: "port négatif", value: "http://127.0.0.1:-1" },
    { name: "port décimal", value: "http://127.0.0.1:4321.5" },
    { name: "port en exposant", value: "http://127.0.0.1:1e3" },
    { name: "port hexadécimal", value: "http://127.0.0.1:0x10e1" },
    { name: "port à 6 chiffres", value: "http://127.0.0.1:100000" },
    // Trop longue.
    { name: "port de 1000 chiffres", value: `http://127.0.0.1:${"4".repeat(1000)}` },
    { name: "suffixe de 10 000 caractères", value: `${LOCAL}${"a".repeat(10_000)}` },
    { name: "hôte de 10 000 caractères", value: `http://${"a".repeat(10_000)}:4321` },
    // HTML / JS.
    { name: "balise img", value: `${LOCAL}<img src=x onerror=alert(1)>` },
    { name: "fermeture de la meta", value: `${LOCAL}"><script>alert(1)</script>` },
    { name: "entité HTML", value: "http://127.0.0.1:4321&quot;" },
    { name: "schéma javascript", value: ["javascript", "//127.0.0.1:4321"].join(":") },
    { name: "schéma ws", value: "ws://127.0.0.1:4321" },
    { name: "schéma file", value: "file://127.0.0.1:4321" },
    { name: "deux origines", value: `${LOCAL} http://localhost:4321` },
    { name: "virgule", value: `${LOCAL},https://*` },
    // Unicode exotique.
    { name: "RTL override", value: `${LOCAL}${cp(0x202e)}` },
    { name: "RTL au milieu de l'hôte", value: `http://127.0.0.1${cp(0x202e)}:4321` },
    { name: "caractère nul final", value: `${LOCAL}${cp(0)}` },
    { name: "caractère nul initial", value: `${cp(0)}${LOCAL}` },
    { name: "espace zéro largeur", value: `http://local${cp(0x200b)}host:4321` },
    { name: "BOM initial", value: `${cp(0xfeff)}${LOCAL}` },
    { name: "séparateur de ligne", value: `${LOCAL}${cp(0x2028)}` },
    { name: "emoji", value: `${LOCAL}🧾` },
    { name: "chiffres pleine chasse", value: "http://127.0.0.1:４３２１" },
    {
      name: "chiffres arabo-indiens",
      value: `http://127.0.0.1:${[0x664, 0x663, 0x662, 0x661].map(cp).join("")}`,
    },
    { name: "deux-points pleine chasse", value: "http://127.0.0.1：4321" },
    { name: "o cyrillique dans localhost", value: `http://l${cp(0x43e)}calhost:4321` },
    { name: "point idéographique", value: "http://127。0。0。1:4321" },
    { name: "IDN localhost en punycode", value: "http://xn--localhost-:4321" },
  ];

  for (const { name, value } of refused) {
    it(`refuse ${name}`, () => {
      expect(() => siteOrigin({ [ORIGIN_ENV]: value })).toThrow(ORIGIN_ENV);
    });
  }

  // Le message cite la valeur : elle doit y apparaître échappée (pas de retour à la ligne ni de
  // caractère nul brut dans le journal du build).
  it("le message d'erreur échappe les caractères de contrôle de la valeur", () => {
    let message = "";
    try {
      siteOrigin({ [ORIGIN_ENV]: `${LOCAL}\n${cp(0)}` });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(ORIGIN_ENV);
    expect(message).not.toContain("\n");
    expect(message).not.toContain(cp(0));
  });
});

describe("PAPERASSE_ORIGIN · branchée sur la config Astro des quatre apps", () => {
  // Une valeur hostile doit arrêter le build (lookConfig est appelé par chaque astro.config.mjs),
  // pas produire une CSP élargie.
  for (const value of ["https://*", 'http://127.0.0.1:4321"', "http://127.0.0.1:4321;x"]) {
    it(`lookConfig refuse ${JSON.stringify(value)} pour chaque app`, () => {
      for (const slug of [null, "reunion-metre", "jure-crache", "sav-de-ta-vie"] as const) {
        expect(() => lookConfig(slug, { [ORIGIN_ENV]: value }), String(slug)).toThrow(ORIGIN_ENV);
      }
    });
  }

  it("une origine locale acceptée donne la même CSP que la production, préfixe mis à part", () => {
    const local = cspDirectives(siteOrigin({ [ORIGIN_ENV]: LOCAL })).map((directive) =>
      directive.replace(`${LOCAL}/`, "PREFIX/"),
    );
    const production = cspDirectives(SITE).map((directive) =>
      directive.replace(`${SITE}/`, "PREFIX/"),
    );
    expect(local).toEqual(production);
  });
});
